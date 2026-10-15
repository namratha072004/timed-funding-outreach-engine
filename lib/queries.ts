import { hunterAccount } from "./contacts";
import { keywordMatcher } from "./filter";
import { lockState } from "./lock";
import { articleOutcome, plainReason, primaryArticles, type Outcome } from "./outcomes";
import { serverDb } from "./supabase";
import { ago, median } from "./time";

type Row = Record<string, any>;
type ArtRow = Row & { id: number; startup_id: number | null; published_at: string | null };
export type Tone = "ok" | "warn" | "bad" | "neutral";

export const score = (s: any): number | null => s?.score ?? s?.marks?.score_if_scored ?? null;

const count = async (table: string, f?: (q: any) => any): Promise<number> => {
  let q: any = serverDb().from(table).select("id", { count: "exact", head: true });
  if (f) q = f(q);
  return (await q).count ?? 0;
};

// ---------------------------------------------------------------------------------------------------- runs
/** Display status of a run row. `locked` = the run lock is held, so an unfinished run is still going. */
export function runStatus(r: Row, locked: boolean): { label: string; tone: Tone } {
  if (r.status === "skipped") return { label: "Skipped", tone: "neutral" };
  if (!r.finished_at) return locked ? { label: "Running", tone: "neutral" } : { label: "Failed", tone: "bad" };
  if (r.status === "error") return { label: "Failed", tone: "bad" };
  if ((r.counts?.errors ?? 0) > 0) return { label: "Partial", tone: "warn" };
  return { label: "OK", tone: "ok" };
}

export async function topStatus(): Promise<{ text: string; tone: Tone }> {
  const db = serverDb();
  const [lock, { data }] = await Promise.all([lockState(db), db.from("runs").select("*").neq("status", "skipped").order("id", { ascending: false }).limit(1)]);
  const r = data?.[0];
  if (!r) return { text: "No run yet", tone: "neutral" };
  const st = runStatus(r, lock.locked);
  const c = r.counts ?? {};
  return { text: `Last run ${ago(r.started_at)} · ${st.label} · ${c.startups_new ?? 0} new, ${c.drafted ?? 0} drafted`, tone: st.tone };
}

const HUNTER_TTL = 5 * 60_000;
let hunterCache: { at: number; v: { used: number; total: number } } | null = null;
/** Hunter's own usage figure (covers lookups made outside runs); cached, because this page is public. Falls back to the per-run count. */
export async function hunterUsage(fallbackUsed: number): Promise<{ used: number; total: number }> {
  if (hunterCache && Date.now() - hunterCache.at < HUNTER_TTL) return hunterCache.v;
  const acct = await Promise.race([hunterAccount().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  if (!acct) return { used: fallbackUsed, total: 50 };
  hunterCache = { at: Date.now(), v: { used: acct.used, total: acct.available } };
  return hunterCache.v;
}

export async function runsData() {
  const db = serverDb();
  const [{ data: runs }, lock] = await Promise.all([db.from("runs").select("*").order("id", { ascending: false }).limit(60), lockState(db)]);
  const all = runs ?? [];
  const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const today = dayKey(new Date().toISOString());
  const todays = all.filter((r) => r.status !== "skipped" && dayKey(r.started_at) === today);
  const sum = (k: string) => todays.reduce((a, r) => a + (r.counts?.[k] ?? 0), 0);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  // drafts written today that still stand (the run counters also count drafts that were later moved to Rejected as older than 24 h)
  const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
  const standing = (await db.from("drafts").select("id, startups!inner(status)", { count: "exact", head: true }).gte("created_at", dayStart).neq("startups.status", "rejected")).count ?? 0;
  const hunterRuns = all.filter((r) => new Date(r.started_at) >= monthStart).reduce((a, r) => a + (r.counts?.hunter_lookups ?? 0), 0);
  return {
    runs: all.slice(0, 20).map((r) => ({ ...r, view: runStatus(r, lock.locked) })),
    today: { newStartups: sum("startups_new"), drafted: standing, rejected: sum("rejected") },
    hunter: await hunterUsage(hunterRuns),
    lock,
  };
}

/** Number in the Drafts nav item: drafts waiting in To review. */
export const tabCountsForNav = () => liveDraftCount(["new", "pending_gmail", "draft_failed"]);

/** Startups (of the given ids) whose first report was published more than the look-back window ago, judged on the article publish date only. No date, or no window: not old. */
async function olderStartups(ids: number[]): Promise<Set<number>> {
  const old = new Set<number>();
  if (!ids.length) return old;
  const db = serverDb();
  const { data: setting } = await db.from("rubric_settings").select("value").eq("key", "lookback_hours").maybeSingle();
  const hours = typeof setting?.value === "number" ? setting.value : null;
  if (hours == null) return old;
  const first = new Map<number, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from("articles").select("startup_id,published_at").in("startup_id", ids.slice(i, i + 100)).not("published_at", "is", null);
    for (const a of data ?? []) {
      const t = new Date(a.published_at).getTime();
      if (t < (first.get(a.startup_id) ?? Infinity)) first.set(a.startup_id, t);
    }
  }
  const cutoff = Date.now() - hours * 3_600_000;
  for (const [id, t] of first) if (t < cutoff) old.add(id);
  return old;
}

/** Drafts in the given statuses whose startup is not rejected and whose article was published inside the window (older ones live in the "Older than 24 h" folder). */
const liveDraftCount = async (statuses: string[]): Promise<number> => {
  const { data } = await serverDb().from("drafts").select("startup_id, startups!inner(status)").in("status", statuses).neq("startups.status", "rejected");
  const rows = data ?? [];
  const old = await olderStartups(rows.map((d: Row) => d.startup_id));
  return rows.filter((d: Row) => !old.has(d.startup_id)).length;
};

// ---------------------------------------------------------------------------------------------------- today
export async function todayData() {
  const [drafts, rejected, articlesRead, sources] = await Promise.all([
    liveDraftCount(["new", "pending_gmail"]),
    count("startups", (q) => q.eq("status", "rejected")),
    count("articles", (q) => q.eq("status", "processed")),
    count("feeds", (q) => q.eq("active", true)),
  ]);
  return { drafts, rejected, articlesRead, sources };
}

// ---------------------------------------------------------------------------------------------------- drafts
export type Tab = "review" | "approved" | "done" | "older";
export const tabOf = (status: string): Exclude<Tab, "older"> => (status === "approved" ? "approved" : ["done", "sent", "skipped"].includes(status) ? "done" : "review");

const criteriaNames = async (): Promise<{ order: string[]; names: Record<string, string> }> => {
  const { data } = await serverDb().from("rubric_criteria").select("key,name,sort_order").order("sort_order");
  return { order: (data ?? []).map((c: Row) => c.key), names: Object.fromEntries((data ?? []).map((c: Row) => [c.key, c.name])) };
};

export type Kind = "verified" | "unverified" | "none";
export const KINDS: { key: Kind; label: string }[] = [{ key: "verified", label: "Verified" }, { key: "unverified", label: "Unverified" }, { key: "none", label: "No address" }];
export const kindOf = (emailSource: string): Kind => (emailSource === "verified" ? "verified" : emailSource === "unverified" ? "unverified" : "none");

/** `kind` = which email group to show inside the tab; when not given, the first group that has drafts. */
export async function draftsData(tab: Tab, kind?: Kind) {
  const db = serverDb();
  const [{ data: drafts }, crit] = await Promise.all([db.from("drafts").select("*, startups(*)").order("created_at", { ascending: false }).limit(300), criteriaNames()]);
  // a startup that is (now) rejected, for example "older than 24 hours", keeps its draft but does not show in Drafts
  const rows = (drafts ?? []).filter((d: Row) => d.startups && d.startups.status !== "rejected");
  // the Older folder holds every draft whose article was published before the look-back window; the other tabs hold only fresh ones
  const old = await olderStartups(rows.map((d: Row) => d.startup_id));
  const counts: Record<Tab, number> = { review: 0, approved: 0, done: 0, older: 0 };
  for (const d of rows) counts[old.has(d.startup_id) ? "older" : tabOf(d.status)]++;
  const inTab = rows.filter((d: Row) => (tab === "older" ? old.has(d.startup_id) : !old.has(d.startup_id) && tabOf(d.status) === tab));
  const kindCounts: Record<Kind, number> = { verified: 0, unverified: 0, none: 0 };
  for (const d of inTab) kindCounts[kindOf(d.email_source)]++;
  const shownKind: Kind = kind && KINDS.some((k) => k.key === kind) ? kind : (KINDS.find((k) => kindCounts[k.key] > 0)?.key ?? "verified");
  const mine = inTab.filter((d: Row) => kindOf(d.email_source) === shownKind);
  const ids = mine.map((d: Row) => d.startup_id);
  const { data: arts } = ids.length ? await db.from("articles").select("id,title,source,published_at,canonical_url,startup_id").in("startup_id", ids) : { data: [] as Row[] };
  const byStartup = new Map<number, Row[]>();
  for (const a of arts ?? []) byStartup.set(a.startup_id, [...(byStartup.get(a.startup_id) ?? []), a]);
  const t = (iso: string | null) => (iso ? new Date(iso).getTime() : Infinity);
  const cards = mine.map((d: Row) => {
    const s = d.startups;
    const list = (byStartup.get(s.id) ?? []).sort((a, b) => t(a.published_at) - t(b.published_at) || a.id - b.id);
    const marks = s.marks?.criteria ?? {};
    const why = crit.order.filter((k) => marks[k]).map((k) => ({ name: crit.names[k] ?? k, mark: String(marks[k].mark), quote: (marks[k].quote as string | null) ?? null }));
    if (s.marks?.stage?.label) why.unshift({ name: "Stage", mark: String(s.marks.stage.label), quote: s.marks.stage.quote ?? null });
    const contact = (d.contacts ?? [])[0] ?? null;
    return {
      id: d.id as number,
      status: d.status as string,
      startup: { name: s.name as string, stage: s.stage_label as string | null, amount: s.amount_text as string | null, sector: s.sector as string | null, location: s.location as string | null, score: score(s) as number | null },
      announced: list[0]?.published_at ?? s.first_seen_at ?? null,
      to: d.to_email as string | null,
      toName: ((d.contacts ?? []).find((x: Row) => x.email === d.to_email)?.name as string | null | undefined) ?? null,
      emailSource: d.email_source as string,
      contact: contact ? { source: contact.source as string, verified: !!contact.verified, domain: (s.domain as string | null) ?? ((d.to_email as string | null)?.split("@")[1] ?? null) } : null,
      subject: d.subject as string | null,
      body: d.body as string | null,
      firstReportedBy: list[0]?.source ?? null,
      articles: list.map((a) => ({ id: a.id as number, source: a.source as string, title: a.title as string, url: a.canonical_url as string, published: a.published_at as string | null })),
      why,
      gmail: d.gmail_draft_id as string | null,
      createdAt: d.created_at as string,
    };
  });
  // To review (and the other tabs): best fit first, then newest
  cards.sort((a, b) => (b.startup.score ?? -1) - (a.startup.score ?? -1) || b.createdAt.localeCompare(a.createdAt));
  return { cards, counts, kindCounts, shownKind };
}

// ---------------------------------------------------------------------------------------------------- rejected
export async function rejectedData(f: { sector?: string; announced?: string; source?: string; reason?: string }) {
  const db = serverDb();
  const [{ data: sts }, crit] = await Promise.all([db.from("startups").select("*").eq("status", "rejected").order("decided_at", { ascending: false }).limit(500), criteriaNames()]);
  const ids = (sts ?? []).map((s: Row) => s.id);
  const arts: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from("articles").select("id,title,source,published_at,canonical_url,startup_id").in("startup_id", ids.slice(i, i + 100));
    arts.push(...(data ?? []));
  }
  const first = primaryArticles(arts as ArtRow[]);
  const now = Date.now();
  const maxAge = f.announced === "24h" ? 24 * 3_600_000 : f.announced === "7d" ? 7 * 24 * 3_600_000 : null;
  const all = (sts ?? []).map((s: Row) => {
    const a = first.get(s.id);
    return {
      id: s.id as number,
      name: s.name as string,
      stage: s.stage_label as string | null,
      sector: s.sector as string | null,
      source: (a?.source as string | undefined) ?? null,
      url: (a?.canonical_url as string | undefined) ?? null,
      announced: (a?.published_at as string | undefined) ?? (s.first_seen_at as string),
      reason: plainReason(s.reject_reason, crit.names),
      quote: s.reject_quote as string | null,
      score: s.score as number | null,
    };
  });
  const filtered = all.filter((r) => (!f.sector || r.sector === f.sector) && (!f.source || r.source === f.source) && (maxAge == null || now - new Date(r.announced).getTime() <= maxAge));
  // the reason groups ("Older than 24 hours", "Stage is other"…) count what the other filters leave, biggest first
  const tally = new Map<string, number>();
  for (const r of filtered) tally.set(r.reason, (tally.get(r.reason) ?? 0) + 1);
  const reasons = [...tally].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const rows = f.reason ? filtered.filter((r) => r.reason === f.reason) : filtered;
  return {
    reasons,
    inScope: filtered.length,
    rows,
    total: all.length,
    sectors: [...new Set(all.map((r) => r.sector).filter(Boolean) as string[])].sort(),
    sources: [...new Set(all.map((r) => r.source).filter(Boolean) as string[])].sort(),
  };
}

// ---------------------------------------------------------------------------------------------------- sources
export async function sourcesData(f: { source?: string; outcome?: string }) {
  const db = serverDb();
  const [{ data: feeds }, { data: arts }, { data: sts }, crit, { data: kw }] = await Promise.all([
    db.from("feeds").select("*").order("id"),
    db.from("articles").select("id,title,source,published_at,first_seen_at,canonical_url,status,error,startup_id").order("first_seen_at", { ascending: false }).limit(1500),
    db.from("startups").select("id,name,status,reject_reason"),
    criteriaNames(),
    db.from("rubric_settings").select("value").eq("key", "funding_keywords").maybeSingle(),
  ]);
  const articles = arts ?? [];
  const startups = new Map((sts ?? []).map((s: Row) => [s.id as number, s]));
  const primary = primaryArticles(articles as ArtRow[]);
  const match = keywordMatcher(Array.isArray(kw?.value) ? (kw!.value as string[]) : []);

  const items = articles.map((a: Row) => {
    const p = a.startup_id != null ? primary.get(a.startup_id) : undefined;
    const o = articleOutcome(a as any, startups.get(a.startup_id) as any, !p || p.id === a.id, p?.source ?? null, crit.names);
    return { id: a.id as number, title: (a.title as string) || a.canonical_url, url: a.canonical_url as string, source: a.source as string, published: (a.published_at as string | null) ?? null, seen: a.first_seen_at as string, ...o };
  });
  items.sort((x, y) => new Date(y.published ?? y.seen).getTime() - new Date(x.published ?? x.seen).getTime());

  const recent = Date.now() - 3 * 24 * 3_600_000;
  const feedRows = (feeds ?? []).map((fd: Row) => {
    const mine = articles.filter((a: Row) => a.source === fd.name);
    const delays = mine.filter((a: Row) => a.published_at).map((a: Row) => Math.max(0, (new Date(a.first_seen_at).getTime() - new Date(a.published_at).getTime()) / 3_600_000));
    const status: { label: string; tone: Tone } = !fd.active ? { label: "Paused", tone: "neutral" } : mine.length === 0 ? { label: "Not read yet", tone: "neutral" } : mine.some((a: Row) => new Date(a.first_seen_at).getTime() > recent) ? { label: "OK", tone: "ok" } : { label: "Nothing new in 3 days", tone: "warn" };
    return {
      id: fd.id as number,
      name: fd.name as string,
      status,
      read: mine.filter((a: Row) => a.status === "processed").length,
      // counted among the articles that were read, so it can never exceed "Articles read"
      passed: mine.filter((a: Row) => a.status === "processed" && match(String(a.title ?? ""))).length,
      delay: median(delays),
    };
  });

  const filtered = items.filter((i) => (!f.source || i.source === f.source) && (!f.outcome || i.outcome === (f.outcome as Outcome)));
  return { feeds: feedRows, items: filtered.slice(0, 400), shown: Math.min(filtered.length, 400), matching: filtered.length, total: items.length, sources: (feeds ?? []).map((x: Row) => x.name as string) };
}

// ---------------------------------------------------------------------------------------------------- rubric
export async function rubricScores(): Promise<{ scores: number[]; label: string }> {
  const db = serverDb();
  const { data: newest } = await db.from("startups").select("first_seen_at").not("score", "is", null).order("first_seen_at", { ascending: false }).limit(1);
  const at = newest?.[0]?.first_seen_at as string | undefined;
  // the scan that produced the newest scored startup: the run whose time window contains it
  const { data: runs } = at ? await db.from("runs").select("started_at,finished_at").neq("status", "skipped").lte("started_at", at).order("id", { ascending: false }).limit(1) : { data: [] as Row[] };
  const run = runs?.[0];
  let q = db.from("startups").select("score").not("score", "is", null);
  if (run) q = q.gte("first_seen_at", run.started_at).lte("first_seen_at", run.finished_at ?? new Date().toISOString());
  const { data } = await q.limit(2000);
  return { scores: (data ?? []).map((s: Row) => Number(s.score)), label: run ? "scored in the latest scan" : "scored so far" };
}
