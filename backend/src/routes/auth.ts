import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createClient } from "@supabase/supabase-js";
import { loginSchema } from "../lib/validation";
import { AsyncResult } from "../core/monad";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY!;

const PASSWORD_RESET_REDIRECT_ENDPOINT =
  "https://projects.hack-nation.ai/#/auth";

const createSessionBoundClient = () =>
  createClient(supabaseUrl, supabaseAnonKey);

interface CredentialExchangeResult {
  token: string;
  refreshToken: string;
  user: { id: string; email: string | undefined };
}

interface TokenRefreshResult {
  token: string;
  refreshToken: string;
}

const exchangeCredentialsForSession = (
  email: string,
  password: string,
): AsyncResult<CredentialExchangeResult> =>
  AsyncResult.from(async () => {
    const supabase = createSessionBoundClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error("Invalid credentials");
    }

    return {
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user: { id: data.user.id, email: data.user.email },
    };
  }, "auth.credentialExchange");

const refreshSessionToken = (
  refreshToken: string,
): AsyncResult<TokenRefreshResult> =>
  AsyncResult.from(async () => {
    const supabase = createSessionBoundClient();
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new Error("Invalid refresh token");
    }

    return {
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }, "auth.tokenRefresh");

const auth = new Hono();

auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");

  try {
    const session = await exchangeCredentialsForSession(email, password).resolve();
    return c.json(session);
  } catch {
    return c.json({ error: "Invalid credentials" }, 401);
  }
});

auth.post("/refresh", async (c) => {
  const body = await c.req.json<{ refreshToken: string }>();

  try {
    const tokens = await refreshSessionToken(body.refreshToken).resolve();
    return c.json(tokens);
  } catch {
    return c.json({ error: "Invalid refresh token" }, 401);
  }
});

auth.get("/password-reset", (c) => {
  return c.json({ redirectUrl: PASSWORD_RESET_REDIRECT_ENDPOINT });
});

export default auth;
