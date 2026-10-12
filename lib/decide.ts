import { computeScore, effectiveMark } from "./score";
import type { MarkedCriterion, Rubric } from "./types";

export interface DecideInput {
  rubric: Rubric;
  now: Date;
  publishedAt: Date | null;
  stageLabel: string;
  stageQuote: string | null;
  amountUsd: number | null;
  marks: Record<string, MarkedCriterion>;
}

export interface Decision {
  pass: boolean;
  score: number;
  /** true when a gate or reject_on_no rule failed (dashboard shows "hard rule" instead of a score) */
  hardRule: boolean;
  reason: string | null; // first failing reason; null if passed
  quote: string | null;
  reasons: string[]; // every failing reason
  rubricVersion: number;
}

const HOUR = 3_600_000;

export function decide(i: DecideInput): Decision {
  const { rubric: r } = i;
  const fails: { reason: string; quote: string | null; hard: boolean }[] = [];

  // recency gate (switched off entirely when lookback_hours is null: no time limit, and an unknown date is fine)
  if (r.lookbackHours != null) {
    if (!i.publishedAt || Number.isNaN(i.publishedAt.getTime())) {
      fails.push({ reason: "date unknown", quote: null, hard: true });
    } else if (i.now.getTime() - i.publishedAt.getTime() > r.lookbackHours * HOUR) {
      fails.push({ reason: `older than ${r.lookbackHours}h`, quote: null, hard: true });
    }
  }

  // stage gate
  if (!r.allowedStages.includes(i.stageLabel)) {
    fails.push({ reason: `stage: ${i.stageLabel}`, quote: i.stageQuote, hard: true });
  }

  // optional round-size ceiling
  if (r.maxRoundSizeUsd != null && i.amountUsd != null && i.amountUsd > r.maxRoundSizeUsd) {
    fails.push({ reason: `round size above ${r.maxRoundSizeUsd} USD`, quote: null, hard: true });
  }

  // reject_on_no
  for (const c of r.criteria) {
    if (c.rejectOnNo && effectiveMark(c, i.marks[c.key]) === "no") {
      fails.push({ reason: `${c.key} = no`, quote: i.marks[c.key]?.quote ?? null, hard: true });
    }
  }

  const score = computeScore(r, i.marks);
  const hardRule = fails.length > 0;
  if (score + 1e-9 < r.passMark) {
    fails.push({ reason: `score ${round(score)} below pass mark ${r.passMark}`, quote: null, hard: false });
  }

  const first = fails[0];
  return {
    pass: fails.length === 0,
    score: round(score),
    hardRule,
    reason: first?.reason ?? null,
    quote: first?.quote ?? null,
    reasons: fails.map((f) => f.reason),
    rubricVersion: r.version,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
