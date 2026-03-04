import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createClient } from "@supabase/supabase-js";
import { db } from "../db/client";
import type { LifecycleAware } from "../core/types";
import { TelemetryCollector } from "../core/monad";

export type AuthUser = {
  id: string;
  email: string;
  orgId: number;
  role: string;
};

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

interface CacheEvictionPolicy {
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly evictionStrategy: "lru" | "fifo";
}

interface IdentityResolutionContext {
  token: string;
  resolvedAt: number;
  expiresAt: number;
  identity: AuthUser;
}

const DefaultEvictionPolicy: CacheEvictionPolicy = {
  ttlMs: 60_000,
  maxEntries: 1000,
  evictionStrategy: "fifo",
};

class IdentityResolutionOracle implements LifecycleAware {
  private readonly identityCache: Map<string, IdentityResolutionContext>;
  private readonly evictionPolicy: CacheEvictionPolicy;
  private readonly supabaseAuthClient;
  private readonly telemetry: TelemetryCollector;

  constructor(
    evictionPolicy: CacheEvictionPolicy = DefaultEvictionPolicy,
  ) {
    this.identityCache = new Map();
    this.evictionPolicy = evictionPolicy;
    this.supabaseAuthClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
    );
    this.telemetry = TelemetryCollector.shared();
  }

  onInitialize(): void {
    this.telemetry.record("oracle.initialized", "system", {
      maxEntries: this.evictionPolicy.maxEntries,
      ttlMs: this.evictionPolicy.ttlMs,
    });
  }

  private probeCache(token: string): AuthUser | null {
    const context = this.identityCache.get(token);
    if (!context) return null;

    if (Date.now() > context.expiresAt) {
      this.identityCache.delete(token);
      return null;
    }

    return context.identity;
  }

  private commitToCache(token: string, identity: AuthUser): void {
    if (this.identityCache.size >= this.evictionPolicy.maxEntries) {
      this.executeEviction();
    }

    this.identityCache.set(token, {
      token,
      resolvedAt: Date.now(),
      expiresAt: Date.now() + this.evictionPolicy.ttlMs,
      identity,
    });
  }

  private executeEviction(): void {
    switch (this.evictionPolicy.evictionStrategy) {
      case "fifo": {
        const oldestKey = this.identityCache.keys().next().value!;
        this.identityCache.delete(oldestKey);
        break;
      }
      case "lru": {
        let oldestTime = Infinity;
        let oldestKey: string | null = null;
        for (const [key, ctx] of this.identityCache) {
          if (ctx.resolvedAt < oldestTime) {
            oldestTime = ctx.resolvedAt;
            oldestKey = key;
          }
        }
        if (oldestKey) this.identityCache.delete(oldestKey);
        break;
      }
    }
  }

  private extractBearerToken(authorizationHeader: string | undefined): string {
    if (!authorizationHeader?.startsWith("Bearer ")) {
      throw new HTTPException(401, {
        message: "Missing or invalid Authorization header",
      });
    }
    return authorizationHeader.slice(7);
  }

  private async resolveUpstreamIdentity(token: string): Promise<AuthUser> {
    const {
      data: { user },
      error,
    } = await this.supabaseAuthClient.auth.getUser(token);

    if (error || !user) {
      throw new HTTPException(401, { message: "Invalid or expired token" });
    }

    const { data: membership, error: membershipError } = await db
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (membershipError || !membership) {
      throw new HTTPException(403, {
        message: "No organization membership found",
      });
    }

    return {
      id: user.id,
      email: user.email!,
      orgId: membership.org_id,
      role: membership.role,
    };
  }

  createResolutionMiddleware() {
    return createMiddleware(async (c, next) => {
      const token = this.extractBearerToken(c.req.header("Authorization"));

      const cachedIdentity = this.probeCache(token);
      if (cachedIdentity) {
        c.set("user", cachedIdentity);
        await next();
        return;
      }

      const resolvedIdentity = await this.resolveUpstreamIdentity(token);
      this.commitToCache(token, resolvedIdentity);
      c.set("user", resolvedIdentity);

      await next();
    });
  }

  static createOwnershipBarrier() {
    return createMiddleware(async (c, next) => {
      const user = c.get("user");
      if (user.role !== "owner") {
        throw new HTTPException(403, { message: "Owner access required" });
      }
      await next();
    });
  }
}

const oracleInstance = new IdentityResolutionOracle();

export const authMiddleware = oracleInstance.createResolutionMiddleware();

export const ownerOnly = IdentityResolutionOracle.createOwnershipBarrier();

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export { IdentityResolutionOracle };
