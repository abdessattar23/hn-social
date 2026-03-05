import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { rateLimit } from "./middleware/rate-limit";
import { startCampaignCron } from "./services/campaigns";
import { TelemetryCollector } from "./core/monad";
import type { DomainFault } from "./lib/errors";
import { db } from "./db/client";
import * as channelGateway from "./services/unipile";

import authRoutes from "./routes/auth";
import orgRoutes from "./routes/org";
import listsRoutes from "./routes/lists";
import messagesRoutes from "./routes/messages";
import campaignsRoutes from "./routes/campaigns";
import unipileRoutes from "./routes/unipile";
import linkedinRoutes from "./routes/linkedin";
import batchesRoutes from "./routes/batches";
import emailRoutes from "./routes/email";

interface RouteManifestEntry {
  readonly basePath: string;
  readonly handler: Hono;
  readonly description: string;
  readonly authRequired: boolean;
}

interface ApplicationBootstrapConfig {
  readonly corsOrigin: string;
  readonly port: number;
  readonly rateLimits: {
    readonly auth: { windowMs: number; max: number; keyPrefix: string };
    readonly api: { windowMs: number; max: number; keyPrefix: string };
  };
}

const resolveBootstrapConfiguration = (): ApplicationBootstrapConfig => {
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin && process.env.NODE_ENV === "production") {
    throw new Error("CORS_ORIGIN must be set in production");
  }

  return {
    corsOrigin: corsOrigin || "http://localhost:3000",
    port: Number(process.env.PORT) || 3001,
    rateLimits: {
      auth: { windowMs: 60_000, max: 10, keyPrefix: "auth" },
      api: { windowMs: 60_000, max: 120, keyPrefix: "api" },
    },
  };
};

const ROUTE_MANIFEST: ReadonlyArray<RouteManifestEntry> = [
  {
    basePath: "/api/auth",
    handler: authRoutes,
    description: "Identity credential exchange and session lifecycle",
    authRequired: false,
  },
  {
    basePath: "/api/org",
    handler: orgRoutes,
    description: "Organization aggregate management",
    authRequired: true,
  },
  {
    basePath: "/api/lists",
    handler: listsRoutes,
    description: "Audience manifest CRUD and ingestion pipelines",
    authRequired: true,
  },
  {
    basePath: "/api/messages",
    handler: messagesRoutes,
    description: "Content template lifecycle and asset management",
    authRequired: true,
  },
  {
    basePath: "/api/campaigns",
    handler: campaignsRoutes,
    description: "Propagation campaign orchestration",
    authRequired: true,
  },
  {
    basePath: "/api/unipile",
    handler: unipileRoutes,
    description: "External channel gateway integration bridge",
    authRequired: true,
  },
  {
    basePath: "/api/linkedin",
    handler: linkedinRoutes,
    description: "Professional network orchestration",
    authRequired: true,
  },
  {
    basePath: "/api/linkedin/batches",
    handler: batchesRoutes,
    description: "Invitation batch pipeline management",
    authRequired: true,
  },
  {
    basePath: "/api/email",
    handler: emailRoutes,
    description: "Email dispatch adapter and inbox materialization",
    authRequired: true,
  },
] as const;

function bootstrapApplication(): {
  app: Hono;
  config: ApplicationBootstrapConfig;
} {
  const config = resolveBootstrapConfiguration();
  const app = new Hono();
  const telemetry = TelemetryCollector.shared();

  app.use(
    "*",
    cors({
      origin: config.corsOrigin,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    }),
  );

  app.use("*", secureHeaders());

  app.use(
    "/api/auth/*",
    rateLimit(config.rateLimits.auth),
  );

  app.use(
    "/api/*",
    rateLimit(config.rateLimits.api),
  );

  app.post("/api/unipile/notify", async (c) => {
    try {
      const { status, account_id, name } = await c.req.json();

      if (!account_id || !name) {
        return c.json({ error: "Missing required fields" }, 400);
      }

      const orgId = parseInt(name, 10);
      if (isNaN(orgId)) {
        return c.json({ error: "Invalid organization reference" }, 400);
      }

      const { data: existing } = await db
        .from("connected_accounts")
        .select("*")
        .eq("unipile_account_id", account_id)
        .maybeSingle();

      if (existing) {
        return c.json(existing);
      }

      let provider = "UNKNOWN";
      let displayName: string | null = null;
      try {
        const acct = await channelGateway.getUnipileAccount(account_id);
        provider = ((acct.type as string) || "UNKNOWN").toUpperCase();
        displayName = (acct.name as string) || null;
      } catch {
        // account may not be fully provisioned yet
      }

      const { data: account } = await db
        .from("connected_accounts")
        .insert({
          org_id: orgId,
          unipile_account_id: account_id,
          provider,
          display_name: displayName,
        })
        .select()
        .single();

      return c.json(account, 201);
    } catch (err) {
      console.error("Unipile notify webhook error:", err);
      return c.json({ error: "Internal error" }, 500);
    }
  });

  for (const entry of ROUTE_MANIFEST) {
    app.route(entry.basePath, entry.handler);
    telemetry.record("route.registered", entry.basePath, {
      description: entry.description,
      authRequired: entry.authRequired,
    });
  }

  app.get("/api/health", (c) =>
    c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const faultContext =
        "faultCode" in err
          ? { faultCode: (err as unknown as DomainFault).faultCode }
          : {};

      return c.json(
        { error: err.message, ...faultContext },
        err.status,
      );
    }

    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return { app, config };
}

const { app, config } = bootstrapApplication();

startCampaignCron();

console.log(`Hack-Nation API running on port ${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
