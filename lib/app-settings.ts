import type { SupabaseClient } from "@supabase/supabase-js";

/** Dashboard settings that are not part of the rubric (table app_settings, server side only). */
export async function getSetting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data ? (data.value as T) : fallback;
}

export async function setSetting(db: SupabaseClient, key: string, value: unknown): Promise<void> {
  const { error } = await db.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(`saving ${key} failed: ${error.message}`);
}

export async function deleteSetting(db: SupabaseClient, key: string): Promise<void> {
  await db.from("app_settings").delete().eq("key", key);
}
