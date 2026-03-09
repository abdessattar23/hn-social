import type { Context } from "hono";
import type { AuthUser } from "../middleware/auth";

export function resolveUserContext(c: Context): AuthUser {
    return c.get("user");
}

export function extractNumericParam(c: Context, key = "id"): number {
    return Number(c.req.param(key));
}
