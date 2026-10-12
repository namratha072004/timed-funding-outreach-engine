import RunNow from "@/components/RunNow";
import RunSettingsForm from "@/components/RunSettingsForm";
import { Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { loadRubric } from "@/lib/config";
import { runsData } from "@/lib/queries";
import { istStamp } from "@/lib/time";
import { serverDb } from "@/lib/supabase";

export default async function Runs() {
  const [d, rubric] = await Promise.all([runsData(), loadRubric(serverDb())]);
  return (
    <>
      <PageHeader title="Runs & health" sub="A run starts every 3 hours from GitHub Actions. Run now reads every article straight away." actions={<RunNow />} />
      <div className="stats">
        <Card className="stat"><b>{d.today.newStartups}</b><span>new startups today</span></Card>
        <Card className="stat"><b>{d.today.drafted}</b><span>drafted today</span></Card>
        <Card className="stat"><b>{d.today.rejected}</b><span>rejected today</span></Card>
        <Card className="stat"><b>{d.hunter.used} / {d.hunter.total}</b><span>Hunter lookups this month</span></Card>
      </div>

      <h2 className="section-title">Recent runs</h2>
      {!d.runs.length ? (
        <EmptyState title="No runs yet" text="Press Run now to start the first one." />
      ) : (
        <Card className="tw">
          <table className="rt">
            <thead><tr><th>Started (IST)</th><th>Status</th><th>Result</th><th className="n">Duration</th></tr></thead>
            <tbody>
              {d.runs.map((r: any) => {
                const c = r.counts ?? {};
                const skipped = r.status === "skipped";
                return (
                  <tr key={r.id}>
                    <td>{istStamp(r.started_at)} <span className="meta">{c.trigger ?? ""}</span></td>
                    <td data-label="Status"><StatusPill tone={r.view.tone}>{r.view.label}</StatusPill></td>
                    <td data-label="Result"><div>
                      {skipped ? "Another run was already going" : r.view.label === "Running" ? `${c.read ?? 0} of ${c.candidates ?? "?"} articles read so far` : `${c.read ?? 0} read · ${c.startups_new ?? 0} new · ${c.passed ?? 0} fit · ${c.drafted ?? 0} drafted · ${c.rejected ?? 0} rejected`}
                      {!skipped && r.errors?.length ? <div className="meta">{String(r.errors[0]).slice(0, 140)}{r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : ""}</div> : null}
                    </div></td>
                    <td className="n" data-label="Duration">{c.duration_ms ? `${Math.round(c.duration_ms / 1000)} s` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <RunSettingsForm initial={{ maxArticles: rubric.maxArticlesPerRun, maxGemini: rubric.maxGeminiCallsPerRun, hunterLookups: rubric.hunterLookupsPerRun, keywords: rubric.fundingKeywords }} />
    </>
  );
}
