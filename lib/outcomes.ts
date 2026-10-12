/** Plain-English wording for why a startup was rejected, and what happened to each article. Pure. */

export type Outcome = "drafted" | "rejected" | "merged" | "filtered" | "old" | "error" | "waiting";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  drafted: "Drafted",
  rejected: "Rejected",
  merged: "Merged",
  filtered: "Not funding news",
  old: "Too old",
  error: "Error",
  waiting: "Not read yet",
};
export const OUTCOME_TONE: Record<Outcome, "ok" | "bad" | "neutral" | "warn"> = { drafted: "ok", rejected: "bad", merged: "neutral", filtered: "neutral", old: "warn", error: "warn", waiting: "neutral" };

/** `reject_reason` is written by code (lib/decide.ts); this only rewords it. `names` maps a criterion key to its display name. */
export function plainReason(reason: string | null | undefined, names: Record<string, string> = {}): string {
  const r = (reason ?? "").trim();
  if (!r) return "No reason saved";
  let m: RegExpMatchArray | null;
  if ((m = r.match(/^older than (\d+)h$/))) return `Older than ${m[1]} hours`;
  if (r === "date unknown") return "Publication date not found";
  if ((m = r.match(/^stage: (.+)$/))) return `Stage is "${m[1]}", not one you back`;
  if ((m = r.match(/^(\w+) = no$/))) return `${names[m[1]!] ?? m[1]!.replace(/_/g, " ")}: no`;
  if ((m = r.match(/^score ([\d.]+) below pass mark ([\d.]+)$/))) return `Score ${m[1]} is below the pass mark of ${m[2]}`;
  if ((m = r.match(/^round size above (\d+) USD$/))) return `Round is larger than $${Number(m[1]).toLocaleString("en-US")}`;
  return r;
}

type A = { id: number; status: string; startup_id: number | null; error: string | null };
type S = { status: string; reject_reason: string | null } | undefined;

/**
 * The Sources page outcome for one article, from fields the pipeline already writes:
 *  error / new           -> Error / Not read yet (articles.status)
 *  no linked startup     -> Not funding news (read, but not a single-startup announcement)
 *  linked, not the startup's first article -> Merged
 *  linked first article  -> Drafted (startup drafted or queued), Too old (rejected on date), else Rejected
 */
export function articleOutcome(a: A, s: S, isPrimary: boolean, primarySource: string | null, names: Record<string, string> = {}): { outcome: Outcome; detail: string } {
  if (a.status === "error") return { outcome: "error", detail: (a.error ?? "Could not be read").replace(/^gemini: /, "AI error: ").slice(0, 120) };
  if (a.status === "new" || a.status === "filtered_out") return { outcome: "waiting", detail: "Waiting for the next run to read it" };
  if (a.startup_id == null || !s) return { outcome: "filtered", detail: "Not an announcement about one startup" };
  if (!isPrimary) return { outcome: "merged", detail: primarySource ? `Same startup as the ${primarySource} article` : "Same startup as an earlier article" };
  if (s.status === "rejected") {
    const old = /^older than|^date unknown/.test(s.reject_reason ?? "");
    return { outcome: old ? "old" : "rejected", detail: plainReason(s.reject_reason, names) };
  }
  return { outcome: "drafted", detail: s.status === "queued_overrule" ? "Draft queued" : "Draft created" };
}

/** The first article for each startup: earliest published_at (unknown dates last), then lowest id. */
export function primaryArticles<T extends { id: number; startup_id: number | null; published_at: string | null }>(arts: T[]): Map<number, T> {
  const best = new Map<number, T>();
  for (const a of arts) {
    if (a.startup_id == null) continue;
    const cur = best.get(a.startup_id);
    if (!cur || before(a, cur)) best.set(a.startup_id, a);
  }
  return best;
}
const when = (a: { published_at: string | null }) => (a.published_at ? new Date(a.published_at).getTime() : Infinity);
const before = (a: { id: number; published_at: string | null }, b: { id: number; published_at: string | null }) => (when(a) !== when(b) ? when(a) < when(b) : a.id < b.id);
