import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createClient } from "@supabase/supabase-js";
import { db } from "../db/client";

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

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing or invalid Authorization header" });
  }

  const token = header.slice(7);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }

  const { data: membership, error: memErr } = await db
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (memErr || !membership) {
    throw new HTTPException(403, { message: "No organization membership found" });
  }

  c.set("user", {
    id: user.id,
    email: user.email!,
    orgId: membership.org_id,
    role: membership.role,
  });

  await next();
});

export const ownerOnly = createMiddleware(async (c, next) => {
  const user = c.get("user");
  if (user.role !== "owner") {
    throw new HTTPException(403, { message: "Owner access required" });
  }
  await next();
});

export { supabase };
