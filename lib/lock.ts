import type { SupabaseClient } from "@supabase/supabase-js";

/** Lease = Hobby max duration (300 s) plus a margin, so a crashed run frees itself. */
export const LEASE_SECONDS = 360;

/**
 * Atomic lease: one conditional UPDATE. It matches only if the lease has expired, so of two concurrent callers
 * exactly one gets a row back.
 */
export async function acquireLock(db: SupabaseClient, holder: string, seconds = LEASE_SECONDS): Promise<boolean> {
  const now = new Date();
  const { data, error } = await db
    .from("run_lock")
    .update({ locked_until: new Date(now.getTime() + seconds * 1000).toISOString(), holder })
    .eq("id", 1)
    .lt("locked_until", now.toISOString())
    .select("id");
  if (error) throw new Error(`lock: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

/** Each stage renews the lease, so a long chain keeps the lock while a crashed chain still frees itself. */
export async function extendLock(db: SupabaseClient, holder: string, seconds = LEASE_SECONDS): Promise<void> {
  await db.from("run_lock").update({ locked_until: new Date(Date.now() + seconds * 1000).toISOString() }).eq("id", 1).eq("holder", holder);
}

export async function releaseLock(db: SupabaseClient, holder: string): Promise<void> {
  await db.from("run_lock").update({ locked_until: "-infinity", holder: null }).eq("id", 1).eq("holder", holder);
}

export async function lockState(db: SupabaseClient): Promise<{ locked: boolean; until: string | null; holder: string | null }> {
  const { data } = await db.from("run_lock").select("locked_until,holder").eq("id", 1).single();
  const until = data?.locked_until && data.locked_until !== "-infinity" ? data.locked_until : null;
  return { locked: !!until && new Date(until).getTime() > Date.now(), until, holder: data?.holder ?? null };
}
