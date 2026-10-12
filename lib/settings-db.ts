import type { SupabaseClient } from "@supabase/supabase-js";
import type { RubricInput, RunInput } from "./settings";

/** Writes only what changed, so saving an untouched form changes nothing and bumps no version. */
async function setSettings(db: SupabaseClient, wanted: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await db.from("rubric_settings").select("key,value");
  if (error) throw new Error(`reading settings failed: ${error.message}`);
  const have = new Map((data ?? []).map((r: any) => [r.key as string, r.value]));
  let changed = false;
  for (const [key, value] of Object.entries(wanted)) {
    if (!have.has(key)) throw new Error(`setting ${key} does not exist`);
    if (JSON.stringify(have.get(key)) === JSON.stringify(value)) continue;
    const { error: e } = await db.from("rubric_settings").update({ value }).eq("key", key);
    if (e) throw new Error(`saving ${key} failed: ${e.message}`);
    changed = true;
  }
  return changed;
}

export async function currentVersion(db: SupabaseClient): Promise<number> {
  const { data } = await db.from("rubric_meta").select("version").limit(1).single();
  return Number(data?.version ?? 0);
}

export async function saveRubric(db: SupabaseClient, input: RubricInput): Promise<{ changed: boolean; version: number }> {
  const { data: crit, error } = await db.from("rubric_criteria").select("key,weight,reject_on_no,active").eq("active", true);
  if (error) throw new Error(`reading criteria failed: ${error.message}`);
  let changed = false;
  for (const c of crit ?? []) {
    const patch: Record<string, unknown> = {};
    if (c.key in input.weights && Number(c.weight) !== input.weights[c.key]) patch.weight = input.weights[c.key];
    if (c.key in input.rejectOnNo && Boolean(c.reject_on_no) !== input.rejectOnNo[c.key]) patch.reject_on_no = input.rejectOnNo[c.key];
    if (!Object.keys(patch).length) continue;
    const { error: e } = await db.from("rubric_criteria").update(patch).eq("key", c.key);
    if (e) throw new Error(`saving ${c.key} failed: ${e.message}`);
    changed = true;
  }
  const s = await setSettings(db, {
    pass_mark: input.passMark,
    thesis_sectors: input.sectors,
    thesis_geographies: input.geographies,
    allowed_stages: input.stages,
    lookback_hours: input.lookbackHours,
  });
  return { changed: changed || s, version: await currentVersion(db) };
}

export async function saveRunSettings(db: SupabaseClient, input: RunInput): Promise<{ changed: boolean }> {
  const changed = await setSettings(db, {
    max_articles_per_run: input.maxArticles,
    max_gemini_calls_per_run: input.maxGemini,
    hunter_lookups_per_run: input.hunterLookups,
    funding_keywords: input.keywords,
  });
  return { changed };
}
