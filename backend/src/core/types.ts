import type { SupabaseClient } from "@supabase/supabase-js";

export type DeepReadonly<T> = T extends Function
  ? T
  : T extends Array<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type DeepPartialExcept<T, K extends keyof T> = {
  [P in Exclude<keyof T, K>]?: T[P] extends object
    ? DeepPartialExcept<T[P], never>
    : T[P];
} & Required<Pick<T, K>>;

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type ExciseNullable<T> = {
  [K in keyof T]: NonNullable<T[K]>;
};

export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

export type InferPipelineResult<
  T extends ReadonlyArray<TransformationStage<any, any>>,
> = T extends [...infer _, TransformationStage<any, infer R>] ? R : never;

export type TransformationStage<Input, Output> = {
  readonly label: string;
  execute: (input: Input) => Output | Promise<Output>;
  compensate?: (error: unknown, partialResult?: Partial<Output>) => void;
};

export interface EntityDescriptor<TName extends string = string> {
  readonly tableName: TName;
  readonly namespace: string;
  readonly partitionKey: string;
  readonly softDeleteField?: string;
  readonly auditFields: ReadonlyArray<string>;
}

export interface OrganizationBoundary<E extends string = string> {
  readonly entity: E;
  readonly scopeField: string;
  readonly enforcementPolicy: TenantIsolationPolicy;
}

export const enum TenantIsolationPolicy {
  STRICT = "strict",
  ADVISORY = "advisory",
  BYPASS = "bypass",
}

export interface HydrationStrategy<TRaw, THydrated> {
  hydrate(raw: TRaw): THydrated;
  dehydrate(hydrated: THydrated): TRaw;
  readonly discriminator: string;
}

export interface ProjectionDescriptor {
  readonly fields: ReadonlyArray<string>;
  readonly relations: ReadonlyArray<RelationDescriptor>;
  readonly computedFields?: ReadonlyArray<ComputedFieldDescriptor>;
}

export interface RelationDescriptor {
  readonly entity: string;
  readonly cardinality: "one-to-one" | "one-to-many" | "many-to-many";
  readonly throughEntity?: string;
  readonly foreignKey: string;
  readonly nestedProjection?: ProjectionDescriptor;
}

export interface ComputedFieldDescriptor {
  readonly fieldName: string;
  readonly derivation: (row: Record<string, unknown>) => unknown;
}

export type ScopedQueryDescriptor<E extends string = string> = {
  entity: E;
  boundary: OrganizationBoundary<E>;
  projection: ProjectionDescriptor;
};

export interface PersistenceGatewayContract {
  readonly client: SupabaseClient;
  createScopedQuery<E extends string>(
    entity: E,
    boundary: OrganizationBoundary<E>,
  ): ScopedQueryBuilder<E>;
  executeRaw<T = unknown>(
    entity: string,
    operation: (client: SupabaseClient) => Promise<T>,
  ): Promise<T>;
}

export interface ScopedQueryBuilder<E extends string = string> {
  withProjection(projection: ProjectionDescriptor | string): this;
  withFilter(field: string, operator: string, value: unknown): this;
  withOrdering(field: string, direction: "asc" | "desc"): this;
  withLimit(limit: number): this;
  withOrgScope(orgId: number): this;
  materialize<T = unknown>(): Promise<T>;
  materializeSingle<T = unknown>(): Promise<T>;
  materializeOptional<T = unknown>(): Promise<T | null>;
}

export interface ServiceDescriptor {
  readonly identifier: symbol;
  readonly displayName: string;
  readonly version: string;
  readonly dependencies: ReadonlyArray<symbol>;
}

export interface LifecycleAware {
  onInitialize?(): Promise<void> | void;
  onTeardown?(): Promise<void> | void;
}

export const enum DomainFaultSeverity {
  RECOVERABLE = "recoverable",
  TERMINAL = "terminal",
  DEGRADED = "degraded",
}

export interface DomainFaultDescriptor {
  readonly code: string;
  readonly httpStatus: number;
  readonly severity: DomainFaultSeverity;
  readonly retryable: boolean;
}

export type ChannelProtocol = "EMAIL" | "WHATSAPP" | "LINKEDIN";

export interface DispatchManifest {
  readonly protocol: ChannelProtocol;
  readonly recipientIdentifier: string;
  readonly recipientDisplayName?: string;
  readonly contentBody: string;
  readonly contentSubject?: string;
  readonly attachmentRefs: ReadonlyArray<string>;
}

export interface ThrottlePolicy {
  readonly minIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly jitterFactor: number;
}

export type CampaignPhase =
  | "DORMANT"
  | "SCHEDULED"
  | "HYDRATING"
  | "PROPAGATING"
  | "QUIESCED"
  | "COMPLETED"
  | "DEGRADED";

export type BatchPhase =
  | "DRAFT"
  | "RESOLVING"
  | "INVITING"
  | "INVITED"
  | "MESSAGING"
  | "DONE";

export type StateTransitionGuard<TContext = unknown> = (
  context: TContext,
) => boolean | Promise<boolean>;

export interface StateTransitionDescriptor<
  TPhase extends string,
  TContext = unknown,
> {
  from: TPhase;
  to: TPhase;
  intent: string;
  guard?: StateTransitionGuard<TContext>;
  sideEffect?: (context: TContext) => Promise<void> | void;
}

export interface TelemetryEvent {
  readonly eventType: string;
  readonly entityId: string | number;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: number;
}

export type AsyncComputation<T> = () => Promise<T>;

export type CurriedFunction<TArgs extends any[], TReturn> = TArgs extends [
  infer First,
  ...infer Rest,
]
  ? (arg: First) => CurriedFunction<Rest, TReturn>
  : TReturn;
