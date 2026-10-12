import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The behaviour itself was checked against the live database inside a rolled-back transaction (see DECISIONS.md).
// These checks keep the migration file from drifting away from what was verified.
const sql = readFileSync("supabase/migrations/003_rubric_version_scoring_only.sql", "utf8");
const code = sql.replace(/--.*$/gm, "");

describe("003_rubric_version_scoring_only.sql", () => {
  it("keeps the function pinned to the public schema", () => expect(code).toMatch(/set search_path = public/));
  it("lists exactly the scoring settings", () => {
    const keys = [...code.match(/scoring_keys constant text\[\] := array\[([^\]]+)\]/)![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(["allowed_stages", "max_round_size_usd", "pass_mark", "points", "thesis_geographies", "thesis_sectors"]);
  });
  it("never lists a non-scoring setting as scoring", () => {
    for (const k of ["lookback_hours", "hunter_lookups_per_run", "funding_keywords", "max_articles_per_run", "max_gemini_calls_per_run"]) expect(code).not.toContain(k);
  });
  it("still sets updated_at on every change, and bumps only when told to", () => {
    expect(code).toMatch(/new\.updated_at := now\(\)/);
    expect(code).toMatch(/if bump then\s+update rubric_meta set version = version \+ 1/);
  });
  it("treats an unchanged value as no change", () => expect(code).toMatch(/old\.value is distinct from new\.value/));
});
