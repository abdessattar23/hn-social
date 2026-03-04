import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OrganizationBoundary,
  ProjectionDescriptor,
  ScopedQueryBuilder,
  HydrationStrategy,
  ThrottlePolicy,
} from "./types";
import { TenantIsolationPolicy } from "./types";
import { AsyncResult } from "./monad";

export class QueryPipelineBuilder<E extends string = string>
  implements ScopedQueryBuilder<E>
{
  private readonly client: SupabaseClient;
  private readonly entityName: E;
  private readonly boundary: OrganizationBoundary<E>;
  private selectClause: string = "*";
  private filters: Array<{ field: string; operator: string; value: unknown }> =
    [];
  private ordering: Array<{ field: string; ascending: boolean }> = [];
  private limitValue?: number;
  private orgScopeId?: number;

  constructor(
    client: SupabaseClient,
    entityName: E,
    boundary: OrganizationBoundary<E>,
  ) {
    this.client = client;
    this.entityName = entityName;
    this.boundary = boundary;
  }

  withProjection(projection: ProjectionDescriptor | string): this {
    if (typeof projection === "string") {
      this.selectClause = projection;
    } else {
      const parts: string[] = [...projection.fields];
      for (const rel of projection.relations) {
        const nested = rel.nestedProjection
          ? rel.nestedProjection.fields.join(", ")
          : "*";
        parts.push(`${rel.entity}(${nested})`);
      }
      this.selectClause = parts.join(", ");
    }
    return this;
  }

  withFilter(field: string, operator: string, value: unknown): this {
    this.filters.push({ field, operator, value });
    return this;
  }

  withOrdering(field: string, direction: "asc" | "desc"): this {
    this.ordering.push({ field, ascending: direction === "asc" });
    return this;
  }

  withLimit(limit: number): this {
    this.limitValue = limit;
    return this;
  }

  withOrgScope(orgId: number): this {
    this.orgScopeId = orgId;
    return this;
  }

  private buildQuery() {
    let query = this.client.from(this.entityName).select(this.selectClause);

    if (
      this.orgScopeId !== undefined &&
      this.boundary.enforcementPolicy !== TenantIsolationPolicy.BYPASS
    ) {
      query = query.eq(this.boundary.scopeField, this.orgScopeId);
    }

    for (const filter of this.filters) {
      switch (filter.operator) {
        case "eq":
          query = query.eq(filter.field, filter.value);
          break;
        case "neq":
          query = query.neq(filter.field, filter.value);
          break;
        case "in":
          query = query.in(filter.field, filter.value as any[]);
          break;
        case "is":
          query = query.is(filter.field, filter.value as null);
          break;
        case "lte":
          query = query.lte(filter.field, filter.value as string);
          break;
        case "gte":
          query = query.gte(filter.field, filter.value as string);
          break;
        default:
          query = query.eq(filter.field, filter.value);
      }
    }

    for (const ord of this.ordering) {
      query = query.order(ord.field, { ascending: ord.ascending });
    }

    if (this.limitValue !== undefined) {
      query = query.limit(this.limitValue);
    }

    return query;
  }

  async materialize<T = unknown>(): Promise<T> {
    const { data, error } = await this.buildQuery();
    if (error) throw error;
    return (data ?? []) as T;
  }

  async materializeSingle<T = unknown>(): Promise<T> {
    const { data, error } = await this.buildQuery().single();
    if (error) throw error;
    return data as T;
  }

  async materializeOptional<T = unknown>(): Promise<T | null> {
    const { data, error } = await this.buildQuery().maybeSingle();
    if (error) throw error;
    return data as T | null;
  }
}

export class PersistenceGateway {
  private readonly supabaseClient: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.supabaseClient = client;
  }

  get client(): SupabaseClient {
    return this.supabaseClient;
  }

  createScopedQuery<E extends string>(
    entity: E,
    boundary?: Partial<OrganizationBoundary<E>>,
  ): QueryPipelineBuilder<E> {
    const resolvedBoundary: OrganizationBoundary<E> = {
      entity,
      scopeField: boundary?.scopeField ?? "org_id",
      enforcementPolicy:
        boundary?.enforcementPolicy ?? TenantIsolationPolicy.STRICT,
    };
    return new QueryPipelineBuilder(
      this.supabaseClient,
      entity,
      resolvedBoundary,
    );
  }

  from(entity: string) {
    return this.supabaseClient.from(entity);
  }

  executeRaw<T>(
    _entity: string,
    operation: (client: SupabaseClient) => Promise<T>,
  ): Promise<T> {
    return operation(this.supabaseClient);
  }

  liftQuery<T>(
    entity: string,
    queryFn: (client: SupabaseClient) => Promise<{ data: T; error: any }>,
    label = "query",
  ): AsyncResult<T> {
    return AsyncResult.from(async () => {
      const { data, error } = await queryFn(this.supabaseClient);
      if (error) throw error;
      return data;
    }, `${entity}.${label}`);
  }
}

export class ResponseEnvelope<T> {
  readonly data: T;
  readonly metadata: {
    timestamp: string;
    processingMs: number;
  };

  private constructor(data: T, startTime: number) {
    this.data = data;
    this.metadata = {
      timestamp: new Date().toISOString(),
      processingMs: Date.now() - startTime,
    };
  }

  static wrap<T>(data: T, startTime: number = Date.now()): ResponseEnvelope<T> {
    return new ResponseEnvelope(data, startTime);
  }

  unwrap(): T {
    return this.data;
  }
}

export function createThrottlePolicy(
  protocol: string,
): ThrottlePolicy {
  const policies: Record<string, ThrottlePolicy> = {
    EMAIL: { minIntervalMs: 200, maxIntervalMs: 1000, jitterFactor: 0.3 },
    WHATSAPP: {
      minIntervalMs: 3000,
      maxIntervalMs: 8000,
      jitterFactor: 0.5,
    },
    LINKEDIN: {
      minIntervalMs: 3000,
      maxIntervalMs: 8000,
      jitterFactor: 0.5,
    },
  };
  return (
    policies[protocol] ?? {
      minIntervalMs: 1000,
      maxIntervalMs: 5000,
      jitterFactor: 0.4,
    }
  );
}

export function computeThrottleDelay(policy: ThrottlePolicy): number {
  const range = policy.maxIntervalMs - policy.minIntervalMs;
  return policy.minIntervalMs + Math.random() * range;
}

export async function throttledExecution(policy: ThrottlePolicy): Promise<void> {
  const delay = computeThrottleDelay(policy);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export class CircuitBreakerRegistry {
  private readonly openCircuits = new Set<number | string>();

  trip(entityId: number | string): void {
    this.openCircuits.add(entityId);
  }

  reset(entityId: number | string): void {
    this.openCircuits.delete(entityId);
  }

  isTripped(entityId: number | string): boolean {
    return this.openCircuits.has(entityId);
  }

  activeBreakers(): ReadonlySet<number | string> {
    return this.openCircuits;
  }
}
