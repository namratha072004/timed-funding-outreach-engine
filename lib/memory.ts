import type { SupabaseClient } from "@supabase/supabase-js";

export interface StartupRow {
  id: number;
  name: string;
  name_key: string;
  domain: string | null;
  status: "rejected" | "drafted" | "pending_gmail" | "queued_overrule";
  rubric_version: number | null;
  [k: string]: any;
}

export interface Candidate {
  name_key: string;
  domain: string | null;
}

/** Pure: is this candidate a startup we already know? Domain first (strongest), then cleaned name. */
export function matchExisting<T extends { name_key: string; domain: string | null }>(existing: T[], c: Candidate): T | undefined {
  if (c.domain) {
    const byDomain = existing.find((s) => s.domain === c.domain);
    if (byDomain) return byDomain;
  }
  const byName = existing.filter((s) => s.name_key === c.name_key);
  // a name match only counts when the domains do not contradict each other
  return byName.find((s) => !s.domain || !c.domain || s.domain === c.domain);
}

export async function findStartup(db: SupabaseClient, c: Candidate): Promise<StartupRow | undefined> {
  const ors = [`name_key.eq.${c.name_key.replace(/[,()]/g, " ")}`];
  if (c.domain) ors.push(`domain.eq.${c.domain}`);
  const { data, error } = await db.from("startups").select("*").or(ors.join(","));
  if (error) throw new Error(`memory: ${error.message}`);
  return matchExisting((data ?? []) as StartupRow[], c);
}

/**
 * Insert a new startup, or return the one that already exists.
 * The unique index on domain is partial, so ON CONFLICT cannot target it through the API; we insert, and on a
 * unique violation (23505) we read back the row that won. Concurrent runs therefore converge on one row.
 */
export async function claimStartup(db: SupabaseClient, row: Record<string, any> & Candidate): Promise<{ startup: StartupRow; created: boolean }> {
  const existing = await findStartup(db, row);
  if (existing) return { startup: existing, created: false };
  const { data, error } = await db.from("startups").insert(row).select("*").single();
  if (!error && data) return { startup: data as StartupRow, created: true };
  if (error?.code === "23505") {
    const won = await findStartup(db, row);
    if (won) return { startup: won, created: false };
  }
  throw new Error(`memory: could not save startup: ${error?.message}`);
}

/** Insert the draft row for a startup, or read back the existing one (drafts.startup_id is unique). */
export async function claimDraft(db: SupabaseClient, startupId: number): Promise<{ draft: Record<string, any>; created: boolean }> {
  const ins = await db.from("drafts").upsert({ startup_id: startupId, status: "draft_failed" }, { onConflict: "startup_id", ignoreDuplicates: true }).select("*");
  if (ins.error) throw new Error(`memory: ${ins.error.message}`);
  if (ins.data?.length) return { draft: ins.data[0], created: true };
  const { data, error } = await db.from("drafts").select("*").eq("startup_id", startupId).single();
  if (error) throw new Error(`memory: ${error.message}`);
  return { draft: data, created: false };
}

/** Run `fn` over `items` with at most `n` in flight; stops taking new items when `stop()` is true. */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>, stop: () => boolean = () => false): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length && !stop()) await fn(items[i++]!);
    }),
  );
}
