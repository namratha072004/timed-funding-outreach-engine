import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mark, Rubric } from "./types";

type Row = Record<string, any>;

const need = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null) throw new Error(`rubric: missing ${what}`);
  return v;
};
const list = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`rubric: ${what} must be a list of text`);
  return v as string[];
};
const num = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`rubric: ${what} must be a number`);
  return v;
};

/** Pure: turn raw table rows into a validated Rubric. Nothing is defaulted, so nothing is hard-coded. */
export function parseRubric(raw: { settings: Row[]; criteria: Row[]; meta: Row; outreach: Row[] }): Rubric {
  const s = new Map(raw.settings.map((r) => [r.key as string, r.value]));
  const get = (k: string) => need(s.get(k), `setting ${k}`);

  const points = get("points") as Record<Mark, number>;
  for (const m of ["yes", "partial", "no", "unclear"] as const) num(points?.[m], `points.${m}`);

  const criteria = raw.criteria
    .filter((c) => c.active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({
      key: String(c.key),
      name: String(c.name),
      question: String(c.question),
      weight: num(Number(c.weight), `weight of ${c.key}`),
      rejectOnNo: Boolean(c.reject_on_no),
      allowsPartial: Boolean(c.allows_partial),
    }));
  if (!criteria.length) throw new Error("rubric: no active criteria");

  if (!s.has("lookback_hours")) throw new Error("rubric: missing setting lookback_hours (use null for no time window)");
  const lookback = s.get("lookback_hours");
  const maxRound = s.get("max_round_size_usd");
  return {
    version: num(raw.meta?.version, "rubric_meta.version"),
    lookbackHours: lookback == null ? null : num(lookback, "lookback_hours"),
    allowedStages: list(get("allowed_stages"), "allowed_stages"),
    passMark: num(get("pass_mark"), "pass_mark"),
    thesisSectors: list(get("thesis_sectors"), "thesis_sectors"),
    thesisGeographies: list(get("thesis_geographies"), "thesis_geographies"),
    maxRoundSizeUsd: maxRound == null ? null : num(maxRound, "max_round_size_usd"),
    hunterLookupsPerRun: num(get("hunter_lookups_per_run"), "hunter_lookups_per_run"),
    maxArticlesPerRun: num(get("max_articles_per_run"), "max_articles_per_run"),
    maxGeminiCallsPerRun: num(get("max_gemini_calls_per_run"), "max_gemini_calls_per_run"),
    fundingKeywords: list(get("funding_keywords"), "funding_keywords"),
    points,
    criteria,
    outreach: Object.fromEntries(raw.outreach.map((o) => [o.key, String(o.value ?? "")])),
  };
}

/** Read the rubric fresh from Supabase. Called at the start of every run. */
export async function loadRubric(db: SupabaseClient): Promise<Rubric> {
  const q = async (t: string, build?: (q: any) => any) => {
    const { data, error } = await (build ? build(db.from(t).select("*")) : db.from(t).select("*"));
    if (error) throw new Error(`rubric: reading ${t} failed: ${error.message}`);
    return data as Row[];
  };
  const [settings, criteria, meta, outreach] = await Promise.all([
    q("rubric_settings"),
    q("rubric_criteria"),
    q("rubric_meta"),
    q("outreach_settings"),
  ]);
  return parseRubric({ settings, criteria, meta: meta[0] ?? {}, outreach });
}
