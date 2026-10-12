/** Server-side validation for the two settings forms. The browser checks too, but nothing here trusts it. */

export class ValidationError extends Error {}

export const LOOKBACK_CHOICES = [6, 12, 24, 36, 48, 72, 168] as const;
export const STAGE_CHOICES = ["pre-seed", "seed"] as const;
/** The criteria that may carry "reject straight away if clearly no". */
export const REJECT_ON_NO_KEYS = ["sector_fit", "geography_fit"] as const;
export const LIMITS = { articles: [1, 2000], gemini: [1, 2000], hunter: [0, 10] } as const;

const MAX_ITEMS = 50;
const MAX_ITEM_LENGTH = 120;

const bad = (m: string): never => {
  throw new ValidationError(m);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Trim, collapse spaces, drop empties, drop case-insensitive repeats (first spelling wins). */
export function cleanList(v: unknown, label: string): string[] {
  if (!Array.isArray(v)) return bad(`${label} must be a list.`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return bad(`${label} must be a list of text.`);
    const t = x.trim().replace(/\s+/g, " ");
    if (!t) continue;
    if (t.length > MAX_ITEM_LENGTH) return bad(`Each item in ${label} must be ${MAX_ITEM_LENGTH} characters or fewer.`);
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  if (out.length > MAX_ITEMS) return bad(`${label} can have at most ${MAX_ITEMS} items.`);
  return out;
}

const num = (v: unknown, label: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(`${label} must be a number.`));
const int = (v: unknown, label: string, lo: number, hi: number): number => {
  const n = num(v, label);
  if (!Number.isInteger(n) || n < lo || n > hi) return bad(`${label} must be a whole number from ${lo} to ${hi}.`);
  return n;
};

export type RubricInput = {
  passMark: number;
  weights: Record<string, number>;
  rejectOnNo: Record<string, boolean>;
  sectors: string[];
  geographies: string[];
  stages: string[];
  lookbackHours: number;
};

/** `activeKeys` are the live criteria; the form must send a weight for each of them and for nothing else. */
export function validateRubric(input: unknown, activeKeys: string[]): RubricInput {
  if (!isObj(input)) return bad("Nothing to save.");

  const passMark = num(input.passMark, "Pass mark");
  if (passMark < 0 || passMark > 100) bad("Pass mark must be from 0 to 100.");

  if (!isObj(input.weights)) return bad("Weights are missing.");
  const weights: Record<string, number> = {};
  for (const k of Object.keys(input.weights)) if (!activeKeys.includes(k)) bad(`Unknown criterion "${k}".`);
  for (const k of activeKeys) {
    if (!(k in input.weights)) bad(`Weight for "${k}" is missing.`);
    const w = num(input.weights[k], `Weight for "${k}"`);
    if (w < 0 || w > 100) bad("Every weight must be from 0 to 100.");
    weights[k] = w;
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 1e-6) bad(`Weights add up to ${Math.round(total * 100) / 100}. They must add up to 100.`);

  const rejectOnNo: Record<string, boolean> = {};
  if (input.rejectOnNo !== undefined) {
    if (!isObj(input.rejectOnNo)) return bad("Reject settings are invalid.");
    for (const [k, v] of Object.entries(input.rejectOnNo)) {
      if (!(REJECT_ON_NO_KEYS as readonly string[]).includes(k) || !activeKeys.includes(k)) bad(`"${k}" cannot reject straight away.`);
      if (typeof v !== "boolean") bad("Reject settings must be on or off.");
      rejectOnNo[k] = v as boolean;
    }
  }

  const sectors = cleanList(input.sectors, "Sectors");
  if (!sectors.length) bad("Add at least one sector.");
  const geographies = cleanList(input.geographies, "Countries");
  if (!geographies.length) bad("Add at least one country.");
  const stages = cleanList(input.stages, "Stages").map((s) => s.toLowerCase());
  if (!stages.length) bad("Pick at least one stage.");
  for (const s of stages) if (!(STAGE_CHOICES as readonly string[]).includes(s)) bad(`"${s}" is not a stage you can pick.`);

  const lookbackHours = num(input.lookbackHours, "Look-back window");
  if (!(LOOKBACK_CHOICES as readonly number[]).includes(lookbackHours)) bad(`Look-back window must be one of ${LOOKBACK_CHOICES.join(", ")} hours.`);

  return { passMark, weights, rejectOnNo, sectors, geographies, stages: [...new Set(stages)], lookbackHours };
}

export type RunInput = { maxArticles: number; maxGemini: number; hunterLookups: number; keywords: string[] };

export function validateRun(input: unknown): RunInput {
  if (!isObj(input)) return bad("Nothing to save.");
  const keywords = cleanList(input.keywords, "Funding words");
  if (!keywords.length) bad("Add at least one funding word.");
  return {
    maxArticles: int(input.maxArticles, "Articles per run", LIMITS.articles[0], LIMITS.articles[1]),
    maxGemini: int(input.maxGemini, "Gemini calls per run", LIMITS.gemini[0], LIMITS.gemini[1]),
    hunterLookups: int(input.hunterLookups, "Email lookups per run", LIMITS.hunter[0], LIMITS.hunter[1]),
    keywords,
  };
}
