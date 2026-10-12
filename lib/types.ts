export type Mark = "yes" | "partial" | "no" | "unclear";
export type StageLabel = "pre-seed" | "seed" | "other" | "unclear";

export interface Criterion {
  key: string;
  name: string;
  question: string;
  weight: number;
  rejectOnNo: boolean;
  allowsPartial: boolean;
}

export interface Rubric {
  version: number;
  /** null = no time window: the recency gate is switched off */
  lookbackHours: number | null;
  allowedStages: string[];
  passMark: number;
  thesisSectors: string[];
  thesisGeographies: string[];
  maxRoundSizeUsd: number | null;
  hunterLookupsPerRun: number;
  maxArticlesPerRun: number;
  maxGeminiCallsPerRun: number;
  fundingKeywords: string[];
  points: Record<Mark, number>;
  criteria: Criterion[]; // active only, in sort order
  outreach: Record<string, string>;
}

/** What Gemini returns per criterion. */
export interface MarkedCriterion {
  mark: Mark;
  quote: string | null;
}
