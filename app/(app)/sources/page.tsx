import FilterBar from "@/components/FilterBar";
import { Card, EmptyState, PageHeader, Pub, StatusPill } from "@/components/ui";
import { OUTCOME_LABEL, OUTCOME_TONE, type Outcome } from "@/lib/outcomes";
import { sourcesData } from "@/lib/queries";
import { ago, hoursLabel } from "@/lib/time";

export default async function Sources({ searchParams }: { searchParams: Promise<{ source?: string; outcome?: string }> }) {
  const f = await searchParams;
  const d = await sourcesData(f);
  const all = { value: "", label: "All" };
  return (
    <>
      <PageHeader title="Sources" sub="Where the articles are read. Every article the scans looked at, and what happened to it." />
      <Card className="tw" >
        <table className="rt">
          <thead><tr><th>Feed</th><th>Status</th><th className="n">Articles read</th><th className="n">Passed keyword filter</th><th className="n">Median delay</th></tr></thead>
          <tbody>
            {d.feeds.map((x) => (
              <tr key={x.id}>
                <td><b>{x.name}</b></td>
                <td data-label="Status"><StatusPill tone={x.status.tone}>{x.status.label}</StatusPill></td>
                <td className="n" data-label="Articles read">{x.read}</td>
                <td className="n" data-label="Passed keyword filter">{x.passed}</td>
                <td className="n" data-label="Median delay">{hoursLabel(x.delay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="meta" style={{ margin: "8px 0 24px" }}>Every article is read by the AI whether or not its headline matches a funding word. The keyword column only shows how many headlines look like funding news. Median delay is the time from publication to the scan first seeing the article.</p>

      <FilterBar
        filters={[
          { name: "source", label: "Source", options: [all, ...d.sources.map((s) => ({ value: s, label: s }))] },
          { name: "outcome", label: "What happened", options: [all, ...(Object.keys(OUTCOME_LABEL) as Outcome[]).map((k) => ({ value: k, label: OUTCOME_LABEL[k] }))] },
        ]}
      />
      {!d.items.length ? (
        <EmptyState title="No articles match these filters" text="Change a filter to see more." />
      ) : (
        <Card className="tw">
          <table className="rt">
            <thead><tr><th>Article</th><th>Source</th><th>Published</th><th>Outcome</th></tr></thead>
            <tbody>
              {d.items.map((a) => (
                <tr key={a.id}>
                  <td><a href={a.url} target="_blank" rel="noreferrer noopener">{a.title} ↗</a><div className="meta">{a.detail}</div></td>
                  <td data-label="Source"><Pub>{a.source}</Pub></td>
                  <td data-label="Published">{a.published ? ago(a.published) : "unknown"}</td>
                  <td data-label="Outcome"><StatusPill tone={OUTCOME_TONE[a.outcome]}>{OUTCOME_LABEL[a.outcome]}</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="meta" style={{ marginTop: 16 }}>Showing {d.shown} of {d.matching} matching articles ({d.total} stored). Feeds are managed in Supabase.</p>
    </>
  );
}
