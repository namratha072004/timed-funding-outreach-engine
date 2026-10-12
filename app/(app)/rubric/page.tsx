import { WithPlaceholders } from "@/components/Placeholders";
import { loadRubric } from "@/lib/config";
import { placeholderFor } from "@/lib/draft";
import { serverDb } from "@/lib/supabase";

export default async function RubricPage() {
  const r = await loadRubric(serverDb());
  const total = r.criteria.reduce((a, c) => a + c.weight, 0);
  const fields = [["Sender", "sender_name"], ["Accelerator", "accelerator_name"], ["Program", "program_description"], ["Ask", "call_to_action"], ["Style", "style_notes"]] as const;
  return (
    <>
      <div className="head"><div><h1 className="headline">Rubric</h1><p className="sub">Read-only. Rubric version {r.version}. Active weight total {total}.</p></div></div>
      <div className="grid5" style={{ marginBottom: 18 }}>
        {r.criteria.map((c) => (
          <div className="card" key={c.key}>
            <h4>{c.name}</h4>
            <div className="big">{c.weight}</div>
            <div className="meta">{c.rejectOnNo ? "Wrong = reject" : c.allowsPartial ? "Partial credit allowed" : "Scored"}</div>
          </div>
        ))}
      </div>
      <div className="grid3">
        <div className="card">
          <h4>Gates and settings</h4>
          <p className="meta" style={{ lineHeight: 1.9 }}>
            Pass mark: <b>{r.passMark}</b><br />Time window: <b>{r.lookbackHours == null ? "none (no time limit)" : `${r.lookbackHours} hours`}</b><br />Stages: <b>{r.allowedStages.join(", ")}</b><br />
            Geographies: <b>{r.thesisGeographies.join(", ") || "any"}</b><br />Sectors: <b>{r.thesisSectors.join(", ") || "any"}</b><br />
            Hunter lookups per run: <b>{r.hunterLookupsPerRun}</b><br />Articles per run: <b>{r.maxArticlesPerRun}</b> · Gemini calls per run: <b>{r.maxGeminiCallsPerRun}</b>
          </p>
        </div>
        <div className="card">
          <h4>Email wording</h4>
          <p className="meta" style={{ lineHeight: 1.9 }}>
            {fields.map(([label, k]) => (
              <span key={k}>{label}: {r.outreach[k]?.trim() ? <b>{r.outreach[k]}</b> : k === "style_notes" ? <i>(default)</i> : <WithPlaceholders text={placeholderFor(k)} />}<br /></span>
            ))}
          </p>
        </div>
        <div className="card">
          <h4>How Rohit edits this</h4>
          <p className="meta" style={{ lineHeight: 1.6 }}>In Supabase, tables <b>rubric_settings</b>, <b>rubric_criteria</b> and <b>outreach_settings</b>. Change a value and save. The next run uses it. No code change. Each change bumps the rubric version.</p>
        </div>
      </div>
    </>
  );
}
