import { parseRubric } from "./config";
import type { Rubric } from "./types";

/** Test-only rubric mirroring the seeded Supabase values. App code never imports this. */
export const rawRubric = () => ({
  settings: [
    { key: "lookback_hours", value: 24 },
    { key: "allowed_stages", value: ["pre-seed", "seed"] },
    { key: "pass_mark", value: 65 },
    { key: "thesis_sectors", value: ["AI", "fintech"] },
    { key: "thesis_geographies", value: ["India"] },
    { key: "max_round_size_usd", value: null },
    { key: "hunter_lookups_per_run", value: 2 },
    { key: "max_articles_per_run", value: 30 },
    { key: "max_gemini_calls_per_run", value: 40 },
    { key: "funding_keywords", value: ["seed", "raises"] },
    { key: "points", value: { yes: 1, partial: 0.5, no: 0, unclear: 0 } },
  ],
  criteria: [
    { key: "sector_fit", name: "Sector", question: "q", active: true, weight: 30, sort_order: 1, reject_on_no: true, allows_partial: false },
    { key: "geography_fit", name: "Geo", question: "q", active: true, weight: 15, sort_order: 2, reject_on_no: true, allows_partial: false },
    { key: "product_traction", name: "Traction", question: "q", active: true, weight: 25, sort_order: 3, reject_on_no: false, allows_partial: false },
    { key: "team_signal", name: "Team", question: "q", active: true, weight: 20, sort_order: 4, reject_on_no: false, allows_partial: true },
    { key: "idea_clarity", name: "Idea", question: "q", active: true, weight: 10, sort_order: 5, reject_on_no: false, allows_partial: false },
  ],
  meta: { version: 4 },
  outreach: [{ key: "sender_name", value: "" }],
});

export const rubric = (): Rubric => parseRubric(rawRubric());
