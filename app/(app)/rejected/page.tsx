import { OverruleButton } from "@/components/DraftActions";
import { serverDb } from "@/lib/supabase";

export default async function Rejected() {
  const { data } = await serverDb().from("startups").select("*").eq("status", "rejected").order("decided_at", { ascending: false }).limit(300);
  return (
    <>
      <div className="head"><div><h1 className="headline">Rejected</h1><p className="sub">Startups that did not fit, with the reason. For audit only.</p></div></div>
      {!data?.length ? (
        <div className="empty">Nothing has been rejected yet.</div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Startup</th><th>Reason</th><th>Evidence</th><th>Score</th><th></th></tr></thead>
            <tbody>
              {data.map((s: any) => (
                <tr key={s.id}>
                  <td><b>{s.name}</b><div className="meta">{[s.sector, s.location, s.stage_label].filter(Boolean).join(" · ")}</div></td>
                  <td><span className="chip">{s.reject_reason}</span></td>
                  <td className="quote">{s.reject_quote ? `"${s.reject_quote}"` : "-"}</td>
                  <td>{s.score == null ? "hard rule" : Math.round(s.score)}</td>
                  <td><OverruleButton id={s.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="meta" style={{ marginTop: 14 }}>Rohit never sees these in Drafts. Overrule queues a startup for drafting on the next run.</p>
    </>
  );
}
