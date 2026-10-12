import { serverDb } from "./supabase";
import { lockState } from "./lock";
import { hunterAccount } from "./contacts";

export const IST = "Asia/Kolkata";
export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: IST, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "-");
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });
export const hoursAgo = (iso: string | null | undefined) => {
  if (!iso) return null;
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? "less than an hour ago" : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`;
};

export async function sidebarCounts() {
  const db = serverDb();
  const [d, r] = await Promise.all([
    db.from("drafts").select("id", { count: "exact", head: true }).in("status", ["new", "pending_gmail"]),
    db.from("startups").select("id", { count: "exact", head: true }).eq("status", "rejected"),
  ]);
  return { drafts: d.count ?? 0, rejected: r.count ?? 0 };
}

export async function runBanner() {
  const db = serverDb();
  const [lock, { data }] = await Promise.all([lockState(db), db.from("runs").select("*").order("id", { ascending: false }).limit(1)]);
  const last = data?.[0] ?? null;
  // each stage renews the lock lease, so "unfinished and locked" = still running; "unfinished and the lease ran out" = the chain broke
  const running = !!last && !last.finished_at && lock.locked;
  const failed = !!last && !last.finished_at && !lock.locked;
  return { lock, last, running, failed };
}

export async function reviewData() {
  const db = serverDb();
  const [{ data: drafts }, { data: runs }] = await Promise.all([
    db.from("drafts").select("*, startups(*)").order("created_at", { ascending: false }).limit(200),
    db.from("runs").select("*").order("id", { ascending: false }).limit(60),
  ]);
  const rows = (drafts ?? []).filter((d: any) => d.startups);
  const rank = (s: string) => (s === "sent" || s === "skipped" ? 1 : 0);
  rows.sort((a: any, b: any) => rank(a.status) - rank(b.status) || (b.startups.score ?? b.startups.marks?.score_if_scored ?? 0) - (a.startups.score ?? a.startups.marks?.score_if_scored ?? 0));
  const finished = (runs ?? []).filter((r: any) => r.finished_at && r.status !== "skipped");
  const last = finished[0] ?? null;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const hunterUsed = (runs ?? []).filter((r: any) => new Date(r.started_at) >= monthStart).reduce((a: number, r: any) => a + (r.counts?.hunter_lookups ?? 0), 0);
  return { rows, last, hunterUsed, runs: runs ?? [] };
}

export function avgDelay(sourceDelays: Record<string, { avg_hours: number; n: number }> | null | undefined): number | null {
  const v = Object.values(sourceDelays ?? {});
  const n = v.reduce((a, x) => a + x.n, 0);
  return n ? v.reduce((a, x) => a + x.avg_hours * x.n, 0) / n : null;
}

export const score = (s: any): number | null => (s?.score ?? s?.marks?.score_if_scored ?? null);

export type FunnelData = { feeds: number; articlesRead: number; announcements: number; startups: number; rejected: number; fit: number; drafts: number; verified: number; unverified: number; none: number };

/** Live totals straight from the tables, so the picture never goes blank after a run that found nothing new. */
export async function funnelData(): Promise<FunnelData> {
  const db = serverDb();
  const n = async (table: string, f?: (q: any) => any): Promise<number> => {
    let q: any = db.from(table).select("id", { count: "exact", head: true });
    if (f) q = f(q);
    return (await q).count ?? 0;
  };
  const real = (q: any) => q.neq("status", "draft_failed");
  const [feeds, articlesRead, announcements, startups, rejected, drafts, verified, unverified, none] = await Promise.all([
    n("feeds", (q) => q.eq("active", true)),
    n("articles", (q) => q.eq("status", "processed")),
    n("articles", (q) => q.not("startup_id", "is", null)),
    n("startups"),
    n("startups", (q) => q.eq("status", "rejected")),
    n("drafts", real),
    n("drafts", (q) => real(q).eq("email_source", "verified")),
    n("drafts", (q) => real(q).eq("email_source", "unverified")),
    n("drafts", (q) => real(q).eq("email_source", "none")),
  ]);
  return { feeds, articlesRead, announcements, startups, rejected, fit: startups - rejected, drafts, verified, unverified, none };
}

/** Hunter's own usage figure (covers lookups made outside runs too); falls back to the count kept per run. */
export async function hunterUsage(fallbackUsed: number): Promise<{ used: number; total: number }> {
  const acct = await Promise.race([hunterAccount().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  return acct ? { used: acct.used, total: acct.available } : { used: fallbackUsed, total: 50 };
}
