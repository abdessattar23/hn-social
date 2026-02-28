import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createClient } from "@supabase/supabase-js";
import { loginSchema } from "../lib/validation";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY!;

const auth = new Hono();

auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  return c.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: {
      id: data.user.id,
      email: data.user.email,
    },
  });
});

auth.post("/refresh", async (c) => {
  const body = await c.req.json<{ refreshToken: string }>();
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: body.refreshToken,
  });

  if (error || !data.session) {
    return c.json({ error: "Invalid refresh token" }, 401);
  }

  return c.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
  });
});

auth.get("/password-reset", (c) => {
  return c.json({
    redirectUrl: "https://projects.hack-nation.ai/#/auth",
  });
});

export default auth;
