import Link from "next/link";
import { EmailPill } from "@/components/Pills";
import { PreviewToggle } from "@/components/DraftActions";
import { WithPlaceholders } from "@/components/Placeholders";
import { avgDelay, hhmm, reviewData, score } from "@/lib/queries";

export default async function Review() {
  const { rows, last, hunterUsed } = await reviewData();
  const waiting = rows.filter((d: any) => ["new", "pending_gmail"].includes(d.status)).length;
  const c = last?.counts ?? {};
  const delay = avgDelay(last?.source_delays);
  return (
    <>
      <h1 className="headline">{waiting > 0 ? <><b>{waiting} draft{waiting === 1 ? "" : "s"}</b> {waiting === 1 ? "is" : "are"} waiting for you</> : "No drafts are waiting"}</h1>
      <p className="sub">
        {!last ? "No run yet. Press Run now on the Runs & health page." : waiting > 0 ? `Good morning. Today's run found ${c.startups_new ?? 0} new startups; ${c.passed ?? 0} fit your thesis.` : `Nothing new fits today. Last run was at ${hhmm(last.started_at)} IST.`}
      </p>
      <div className="stats">
        <div className="stat"><b>{c.fetched ?? "-"}</b><span>articles read</span></div>
        <div className="stat"><b>{delay == null ? "-" : `${delay.toFixed(1)} h`}</b><span>news to first seen</span></div>
        <div className="stat"><b>{hunterUsed} / 50</b><span>Hunter lookups used</span></div>
        <div className="stat"><b>{c.errors ?? "-"}</b><span>errors last run</span></div>
      </div>
      {rows.length === 0 ? (
        <div className="empty">No drafts yet. When a run finds a startup that fits, its draft appears here.</div>
      ) : (
        <div className="stack">
          {rows.map((d: any) => {
            const s = d.startups;
            const sc = score(s);
            const done = d.status === "sent" || d.status === "skipped";
            return (
              <article key={d.id} className={`item${done ? " done" : ""}`}>
                <div className="tile" aria-label={`Score ${sc ?? "n/a"}`}>{sc == null ? "-" : Math.round(sc)}</div>
                <div className="body">
                  <div className="name">{s.name}</div>
                  <div className="line">{[s.sector, s.location, s.stage_label, s.amount_text].filter(Boolean).join(" · ") || "Details not found"}</div>
                  <div className="line">{s.description ?? "No description found."}</div>
                </div>
                <div className="right">
                  <EmailPill source={d.email_source} status={d.status} />
                  <div className="actions">
                    {d.subject && d.body && d.status !== "draft_failed" && <PreviewToggle subject={d.subject}><WithPlaceholders text={d.body} /></PreviewToggle>}
                    <Link className="btn primary" href={`/drafts/${d.id}`}>Open draft</Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
