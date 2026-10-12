import { describe, expect, it } from "vitest";
import { parseRubric } from "./config";
import { decide, type DecideInput } from "./decide";
import { quoteInText, verifyMarks } from "./quotes";
import { computeScore } from "./score";
import { rawRubric, rubric } from "./fixtures";
import type { Mark, MarkedCriterion } from "./types";

const m = (mark: Mark, quote: string | null = "q"): MarkedCriterion => ({ mark, quote });
const marks = (s: Mark, g: Mark, t: Mark, p: Mark, i: Mark) => ({
  sector_fit: m(s), geography_fit: m(g), product_traction: m(t), team_signal: m(p), idea_clarity: m(i),
});
const now = new Date("2026-10-12T03:30:00Z");
const base = (over: Partial<DecideInput> = {}): DecideInput => ({
  rubric: rubric(), now, publishedAt: new Date("2026-10-11T20:00:00Z"), stageLabel: "seed", stageQuote: "seed round",
  amountUsd: null, marks: marks("yes", "yes", "yes", "yes", "yes"), ...over,
});

describe("computeScore", () => {
  const r = rubric();
  it("all yes = 100, all no/unclear = 0", () => {
    expect(computeScore(r, marks("yes", "yes", "yes", "yes", "yes"))).toBe(100);
    expect(computeScore(r, marks("no", "no", "no", "no", "no"))).toBe(0);
    expect(computeScore(r, marks("unclear", "unclear", "unclear", "unclear", "unclear"))).toBe(0);
  });
  it("partial counts half on team_signal", () => {
    expect(computeScore(r, marks("yes", "yes", "unclear", "partial", "yes"))).toBe(65);
  });
  it("partial on a criterion that forbids it counts as unclear (0)", () => {
    expect(computeScore(r, marks("partial", "yes", "yes", "yes", "yes"))).toBe(70);
  });
  it("a missing mark counts as unclear", () => {
    expect(computeScore(r, { sector_fit: m("yes") })).toBe(30);
  });
  it("divides by the active weight total, not 100", () => {
    const raw = rawRubric();
    raw.criteria[4]!.active = false; // drop idea_clarity -> total 90
    expect(computeScore(parseRubric(raw), marks("yes", "yes", "yes", "yes", "no"))).toBe(100);
  });
});

describe("decide: pass mark", () => {
  it("passes at exactly the pass mark (65)", () => {
    const d = decide(base({ marks: marks("yes", "yes", "unclear", "partial", "yes") }));
    expect(d.score).toBe(65);
    expect(d.pass).toBe(true);
  });
  it("rejects below the pass mark with a score reason, not a hard rule", () => {
    const d = decide(base({ marks: marks("yes", "yes", "unclear", "unclear", "yes") })); // 55
    expect(d).toMatchObject({ pass: false, score: 55, hardRule: false });
    expect(d.reason).toContain("below pass mark");
  });
  it("changing pass_mark in the rubric changes the outcome with no code change", () => {
    const raw = rawRubric();
    raw.settings.find((s) => s.key === "pass_mark")!.value = 50;
    expect(decide(base({ rubric: parseRubric(raw), marks: marks("yes", "yes", "unclear", "unclear", "yes") })).pass).toBe(true);
  });
  it("changing a weight changes the score", () => {
    const raw = rawRubric();
    raw.criteria[2]!.weight = 5; // traction 25 -> 5, total 80
    const r = parseRubric(raw);
    expect(computeScore(r, marks("yes", "yes", "no", "no", "no"))).toBe((45 / 80) * 100);
  });
});

describe("decide: gates", () => {
  it("rejects an unknown date", () => {
    const d = decide(base({ publishedAt: null }));
    expect(d).toMatchObject({ pass: false, hardRule: true, reason: "date unknown" });
  });
  it("rejects an article older than lookback_hours, accepts one inside", () => {
    expect(decide(base({ publishedAt: new Date("2026-10-11T03:00:00Z") })).pass).toBe(false); // 24.5h
    expect(decide(base({ publishedAt: new Date("2026-10-11T03:30:00Z") })).pass).toBe(true); // exactly 24h
  });
  it("widening lookback_hours in the rubric accepts older articles", () => {
    const raw = rawRubric();
    raw.settings.find((s) => s.key === "lookback_hours")!.value = 168;
    expect(decide(base({ rubric: parseRubric(raw), publishedAt: new Date("2026-10-08T00:00:00Z") })).pass).toBe(true);
  });
  it("with no time window (lookback_hours = null) nothing is rejected for age or for an unknown date", () => {
    const raw = rawRubric();
    raw.settings.find((s) => s.key === "lookback_hours")!.value = null;
    const r = parseRubric(raw);
    expect(r.lookbackHours).toBeNull();
    expect(decide(base({ rubric: r, publishedAt: new Date("2020-01-01T00:00:00Z") })).pass).toBe(true);
    expect(decide(base({ rubric: r, publishedAt: null })).pass).toBe(true);
  });
  it("a missing lookback_hours setting is still an error, not a silent default", () => {
    const raw = rawRubric();
    raw.settings = raw.settings.filter((s) => s.key !== "lookback_hours");
    expect(() => parseRubric(raw)).toThrow(/lookback_hours/);
  });
  it.each(["other", "unclear"])("rejects stage %s with its quote", (label) => {
    const d = decide(base({ stageLabel: label, stageQuote: "Series A" }));
    expect(d).toMatchObject({ pass: false, hardRule: true, reason: `stage: ${label}`, quote: "Series A" });
  });
  it("accepts pre-seed", () => expect(decide(base({ stageLabel: "pre-seed" })).pass).toBe(true));
  it("rejects a round above max_round_size_usd when set", () => {
    const raw = rawRubric();
    raw.settings.find((s) => s.key === "max_round_size_usd")!.value = 1_000_000;
    const r = parseRubric(raw);
    expect(decide(base({ rubric: r, amountUsd: 2_000_000 })).pass).toBe(false);
    expect(decide(base({ rubric: r, amountUsd: null })).pass).toBe(true);
  });
});

describe("decide: reject_on_no", () => {
  it("sector = no rejects even when the score would pass, and keeps the quote", () => {
    const mk = marks("no", "yes", "yes", "yes", "yes"); // 70
    mk.sector_fit = m("no", "watches and luxury");
    const d = decide(base({ marks: mk }));
    expect(d).toMatchObject({ pass: false, hardRule: true, reason: "sector_fit = no", quote: "watches and luxury" });
  });
  it("geography = no rejects", () => {
    expect(decide(base({ marks: marks("yes", "no", "yes", "yes", "yes") })).reason).toBe("geography_fit = no");
  });
  it("unclear on a reject_on_no criterion does not hard-reject (it just scores 0)", () => {
    const d = decide(base({ marks: marks("unclear", "yes", "yes", "yes", "yes") })); // 70
    expect(d.pass).toBe(true);
  });
  it("'no' on a normal criterion is not a hard rule", () => {
    expect(decide(base({ marks: marks("yes", "yes", "no", "yes", "yes") })).pass).toBe(true); // 75
  });
  it("records every failing reason and the rubric version", () => {
    const d = decide(base({ stageLabel: "other", publishedAt: null }));
    expect(d.reasons).toEqual(["date unknown", "stage: other"]);
    expect(d.rubricVersion).toBe(4);
  });
});

describe("quote verification", () => {
  const text = "Zaperon  raised\n$2M in a seed round.";
  it("matches ignoring case and whitespace", () => {
    expect(quoteInText("zaperon raised $2m", text)).toBe(true);
    expect(quoteInText("invented quote", text)).toBe(false);
    expect(quoteInText(null, text)).toBe(false);
    expect(quoteInText("   ", text)).toBe(false);
  });
  it("tolerates curly quotes, non-breaking hyphens and ellipses in a real quote", () => {
    const src = "India\u2011based startup Gharbar said it\u2019s building student housing, and plans to expand to 20 cities.";
    expect(quoteInText("India-based startup Gharbar said it's building student housing", src)).toBe(true);
    expect(quoteInText("India-based startup Gharbar ... plans to expand to 20 cities", src)).toBe(true);
    expect(quoteInText("India-based startup Gharbar ... plans to expand to 90 countries", src)).toBe(false);
    expect(quoteInText("completely invented sentence here", src)).toBe(false);
  });
  it("downgrades yes/partial with a missing quote to unclear, leaves no/unclear alone", () => {
    const r = verifyMarks(
      { a: m("yes", "seed round"), b: m("yes", "made up"), c: m("partial", null), d: m("no", "made up"), e: m("unclear", null) },
      text,
    );
    expect(r.downgraded).toEqual(["b", "c"]);
    expect(r.marks.a!.mark).toBe("yes");
    expect(r.marks.b!.mark).toBe("unclear");
    expect(r.marks.d!.mark).toBe("no");
  });
});

describe("parseRubric", () => {
  it("ignores inactive criteria and sorts by sort_order", () => {
    const raw = rawRubric();
    raw.criteria.reverse();
    raw.criteria[0]!.active = false;
    const r = parseRubric(raw);
    expect(r.criteria.map((c) => c.key)).toEqual(["sector_fit", "geography_fit", "product_traction", "team_signal"]);
  });
  it("throws instead of defaulting when a setting is missing", () => {
    const raw = rawRubric();
    raw.settings = raw.settings.filter((s) => s.key !== "pass_mark");
    expect(() => parseRubric(raw)).toThrow(/pass_mark/);
  });
  it("throws when no criteria are active", () => {
    const raw = rawRubric();
    raw.criteria.forEach((c) => (c.active = false));
    expect(() => parseRubric(raw)).toThrow(/no active criteria/);
  });
});
