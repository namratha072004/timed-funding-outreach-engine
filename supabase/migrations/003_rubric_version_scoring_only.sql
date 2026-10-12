-- 003: rubric_meta.version moves only when something that changes scoring changes.
--
-- Scoring settings (rubric_settings keys): allowed_stages, pass_mark, points, max_round_size_usd, thesis_sectors,
-- thesis_geographies. Any real change to rubric_criteria also counts.
-- Not scoring (they still set updated_at, but leave the version alone): lookback_hours, hunter_lookups_per_run,
-- funding_keywords, max_articles_per_run, max_gemini_calls_per_run.
-- An UPDATE that writes the same value back is not a change and does not bump the version.
-- Idempotent: create or replace; the triggers from 001 keep pointing at this function.

create or replace function public.rubric_touch()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  scoring_keys constant text[] := array['allowed_stages', 'pass_mark', 'points', 'max_round_size_usd', 'thesis_sectors', 'thesis_geographies'];
  bump boolean := false;
begin
  if tg_op <> 'DELETE' then
    new.updated_at := now();
  end if;

  if tg_table_name = 'rubric_criteria' then
    bump := case tg_op
      when 'UPDATE' then (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at')
      else true
    end;
  elsif tg_table_name = 'rubric_settings' then
    bump := case tg_op
      when 'INSERT' then new.key = any (scoring_keys)
      when 'DELETE' then old.key = any (scoring_keys)
      else (old.key = any (scoring_keys) or new.key = any (scoring_keys))
           and (old.key is distinct from new.key or old.value is distinct from new.value)
    end;
  end if;

  if bump then
    update rubric_meta set version = version + 1, updated_at = now() where id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;
