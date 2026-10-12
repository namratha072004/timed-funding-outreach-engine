import { describe, expect, it } from "vitest";
import { cleanList, validateRubric, validateRun, ValidationError } from "./settings";

const KEYS = ["sector_fit", "geography_fit", "product_traction", "team_signal", "idea_clarity"];
const good = () => ({
  passMark: 65,
  weights: { sector_fit: 30, geography_fit: 15, product_traction: 25, team_signal: 20, idea_clarity: 10 },
  rejectOnNo: { sector_fit: true, geography_fit: true },
  sectors: ["AI", "fintech"],
  geographies: ["India"],
  stages: ["pre-seed", "seed"],
  lookbackHours: 24,
});
const rubricError = (patch: Record<string, unknown>) => {
  try {
    validateRubric({ ...good(), ...patch }, KEYS);
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as Error).message;
  }
  return null;
};

describe("rubric validation (server side)", () => {
  it("accepts the current live rubric", () => {
    expect(validateRubric(good(), KEYS).passMark).toBe(65);
  });
  it("rejects weights that do not total 100", () => {
    expect(rubricError({ weights: { ...good().weights, idea_clarity: 11 } })).toMatch(/add up to 101/);
    expect(rubricError({ weights: { ...good().weights, idea_clarity: 0 } })).toMatch(/add up to 90/);
  });
  it("rejects a weight outside 0-100, even when the total is 100", () => {
    expect(rubricError({ weights: { sector_fit: 130, geography_fit: -30, product_traction: 0, team_signal: 0, idea_clarity: 0 } })).toMatch(/0 to 100/);
  });
  it("rejects missing, unknown and non-numeric weights", () => {
    const { idea_clarity, ...rest } = good().weights;
    expect(rubricError({ weights: rest })).toMatch(/missing/);
    expect(rubricError({ weights: { ...good().weights, bogus: 0 } })).toMatch(/Unknown criterion/);
    expect(rubricError({ weights: { ...good().weights, idea_clarity: "10" } })).toMatch(/must be a number/);
    expect(rubricError({ weights: { ...good().weights, idea_clarity: NaN } })).toMatch(/must be a number/);
  });
  it("rejects a pass mark outside 0-100 or not a number", () => {
    expect(rubricError({ passMark: 101 })).toMatch(/0 to 100/);
    expect(rubricError({ passMark: -1 })).toMatch(/0 to 100/);
    expect(rubricError({ passMark: "65" })).toMatch(/number/);
    expect(validateRubric({ ...good(), passMark: 0 }, KEYS).passMark).toBe(0);
    expect(validateRubric({ ...good(), passMark: 100 }, KEYS).passMark).toBe(100);
  });
  it("rejects empty sectors, countries and stages (also when they only hold blanks)", () => {
    expect(rubricError({ sectors: [] })).toMatch(/at least one sector/);
    expect(rubricError({ sectors: ["  ", ""] })).toMatch(/at least one sector/);
    expect(rubricError({ geographies: [] })).toMatch(/at least one country/);
    expect(rubricError({ stages: [] })).toMatch(/at least one stage/);
  });
  it("only allows pre-seed and seed as stages", () => {
    expect(rubricError({ stages: ["series a"] })).toMatch(/not a stage/);
    expect(validateRubric({ ...good(), stages: ["Seed", "SEED", "pre-seed"] }, KEYS).stages).toEqual(["seed", "pre-seed"]);
  });
  it("only allows the listed look-back windows", () => {
    for (const h of [6, 12, 24, 36, 48, 72, 168]) expect(validateRubric({ ...good(), lookbackHours: h }, KEYS).lookbackHours).toBe(h);
    for (const h of [0, 5, 25, 169, null, "24"]) expect(rubricError({ lookbackHours: h })).toMatch(/Look-back/);
  });
  it("only sector and geography can reject straight away", () => {
    expect(rubricError({ rejectOnNo: { team_signal: true } })).toMatch(/cannot reject/);
    expect(rubricError({ rejectOnNo: { sector_fit: "yes" } })).toMatch(/on or off/);
  });
  it("trims and de-duplicates list items, keeping the first spelling", () => {
    const r = validateRubric({ ...good(), sectors: ["  AI ", "ai", "Fin  tech", "fin tech", ""] }, KEYS);
    expect(r.sectors).toEqual(["AI", "Fin tech"]);
  });
  it("rejects non-objects and lists with non-text", () => {
    expect(() => validateRubric(null, KEYS)).toThrow(ValidationError);
    expect(() => validateRubric([], KEYS)).toThrow(ValidationError);
    expect(() => cleanList(["a", 1], "Sectors")).toThrow(/list of text/);
    expect(() => cleanList("a", "Sectors")).toThrow(/must be a list/);
    expect(() => cleanList(["x".repeat(121)], "Sectors")).toThrow(/120 characters/);
    expect(() => cleanList(Array.from({ length: 51 }, (_, i) => `s${i}`), "Sectors")).toThrow(/at most 50/);
  });
});

describe("run settings validation (server side)", () => {
  const ok = { maxArticles: 2000, maxGemini: 2000, hunterLookups: 2, keywords: ["seed", "raises"] };
  const err = (patch: Record<string, unknown>) => {
    try {
      validateRun({ ...ok, ...patch });
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      return (e as Error).message;
    }
    return null;
  };
  it("accepts the live values", () => expect(validateRun(ok)).toEqual(ok));
  it("keeps every cap inside its range", () => {
    expect(err({ maxArticles: 0 })).toMatch(/1 to 2000/);
    expect(err({ maxArticles: 2001 })).toMatch(/1 to 2000/);
    expect(err({ maxGemini: 0 })).toMatch(/Gemini calls/);
    expect(err({ maxGemini: 5000 })).toMatch(/Gemini calls/);
    expect(err({ hunterLookups: -1 })).toMatch(/0 to 10/);
    expect(err({ hunterLookups: 11 })).toMatch(/0 to 10/);
    expect(err({ maxArticles: 10.5 })).toMatch(/whole number/);
    expect(err({ maxArticles: "10" })).toMatch(/must be a number/);
    expect(validateRun({ ...ok, hunterLookups: 0 }).hunterLookups).toBe(0);
  });
  it("needs at least one funding word, and cleans the list", () => {
    expect(err({ keywords: [] })).toMatch(/at least one funding word/);
    expect(err({ keywords: [" ", ""] })).toMatch(/at least one funding word/);
    expect(validateRun({ ...ok, keywords: [" Seed ", "seed", "pre  seed"] }).keywords).toEqual(["Seed", "pre seed"]);
  });
});
