import FilterBar from "@/components/FilterBar";
import OverruleButton from "@/components/OverruleButton";
import { Card, EmptyState, PageHeader, Pub } from "@/components/ui";
import { rejectedData } from "@/lib/queries";
import { ago } from "@/lib/time";

export default async function Rejected({ searchParams }: { searchParams: Promise<{ sector?: string; announced?: string; source?: string }> }) {
  const f = await searchParams;
  const { rows, total, sectors, sources } = await rejectedData(f);
  const any = { value: "", label: "Any" };
  return (
    <>
      <PageHeader title="Rejected" sub="Startups that did not fit. Overrule one if you disagree." />
      <FilterBar
        filters={[
          { name: "sector", label: "Sector", options: [any, ...sectors.map((s) => ({ value: s, label: s }))] },
          { name: "announced", label: "Announced", options: [any, { value: "24h", label: "Last 24 hours" }, { value: "7d", label: "Last 7 days" }] },
          { name: "source", label: "Reported by", options: [any, ...sources.map((s) => ({ value: s, label: s }))] },
        ]}
      />
      {!rows.length ? (
        <EmptyState title={total ? "Nothing matches these filters" : "Nothing has been rejected yet"} text={total ? "Change a filter to see more." : "Startups that do not fit appear here, with the reason."} />
      ) : (
        <Card className="tw">
          <table className="rt">
            <thead><tr><th>Startup</th><th>Reason</th><th className="n">Score</th><th>When</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                    <div className="meta">{[r.stage ? r.stage[0]!.toUpperCase() + r.stage.slice(1) : null, r.sector].filter(Boolean).join(" · ")}{r.source && <> {r.stage || r.sector ? "· " : ""}<Pub>{r.source}</Pub></>}{r.url && <> · <a href={r.url} target="_blank" rel="noreferrer noopener">Read article ↗</a></>}</div>
                  </td>
                  <td data-label="Reason"><div>{r.reason}{r.quote && <div className="meta">“{r.quote}”</div>}</div></td>
                  <td className="n" data-label="Score">{r.score == null ? "—" : Math.round(r.score)}</td>
                  <td data-label="When" style={{ whiteSpace: "nowrap" }}>{ago(r.announced)}</td>
                  <td className="n"><OverruleButton id={r.id} name={r.name} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
