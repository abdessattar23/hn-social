import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { rateLimit } from "./middleware/rate-limit";
import { startCampaignCron } from "./services/campaigns";

import authRoutes from "./routes/auth";
import orgRoutes from "./routes/org";
import listsRoutes from "./routes/lists";
import messagesRoutes from "./routes/messages";
import campaignsRoutes from "./routes/campaigns";
import unipileRoutes from "./routes/unipile";
import linkedinRoutes from "./routes/linkedin";

const app = new Hono();

// ─── Global middleware ───────────────────────────────────────

const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin && process.env.NODE_ENV === "production") {
  throw new Error("CORS_ORIGIN must be set in production");
}

app.use(
  "*",
  cors({
    origin: corsOrigin || "http://localhost:3000",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

app.use("*", secureHeaders());

app.use(
  "/api/auth/*",
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "auth" })
);

app.use(
  "/api/*",
  rateLimit({ windowMs: 60_000, max: 120, keyPrefix: "api" })
);

// ─── Routes ──────────────────────────────────────────────────

app.route("/api/auth", authRoutes);
app.route("/api/org", orgRoutes);
app.route("/api/lists", listsRoutes);
app.route("/api/messages", messagesRoutes);
app.route("/api/campaigns", campaignsRoutes);
app.route("/api/unipile", unipileRoutes);
app.route("/api/linkedin", linkedinRoutes);

// ─── Health check ────────────────────────────────────────────

app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// ─── Error handler ───────────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// ─── Start ───────────────────────────────────────────────────

const port = Number(process.env.PORT) || 3001;

startCampaignCron();
console.log(`Hack-Nation API running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
