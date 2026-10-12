import type { Criterion, Mark, MarkedCriterion, Rubric } from "./types";

/** Mark actually counted: a missing mark is "unclear"; "partial" on a criterion that forbids it is "unclear". */
export function effectiveMark(c: Criterion, m: MarkedCriterion | undefined): Mark {
  if (!m) return "unclear";
  if (m.mark === "partial" && !c.allowsPartial) return "unclear";
  return m.mark;
}

/** score = sum(weight x points) / sum(weights of active criteria) x 100. Pure; Gemini never does this. */
export function computeScore(rubric: Pick<Rubric, "criteria" | "points">, marks: Record<string, MarkedCriterion>): number {
  const total = rubric.criteria.reduce((a, c) => a + c.weight, 0);
  if (total <= 0) throw new Error("rubric: active weights sum to 0");
  const got = rubric.criteria.reduce((a, c) => a + c.weight * rubric.points[effectiveMark(c, marks[c.key])], 0);
  return (got / total) * 100;
}
