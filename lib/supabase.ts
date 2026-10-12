import { createClient } from "@supabase/supabase-js";

/** Server-side only: uses the service-role key. Never import from client components. */
export function serverDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
