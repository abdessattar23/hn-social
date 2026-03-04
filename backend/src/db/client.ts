import { createClient } from "@supabase/supabase-js";
import { PersistenceGateway } from "../core/pipeline";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
}

const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const persistenceGateway = new PersistenceGateway(supabaseClient);

export const db = persistenceGateway.client;
