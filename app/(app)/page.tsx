import Link from "next/link";
import { EmailPill } from "@/components/Pills";
import { PreviewToggle } from "@/components/DraftActions";
import { WithPlaceholders } from "@/components/Placeholders";
import { Funnel, EmailSources } from "@/components/Funnel";
import Tilt from "@/components/Tilt";
import { funnelData, hhmm, hunterUsage, reviewData, score } from "@/lib/queries";

export default async function Review() {
  const [{ rows, last, hunterUsed }, funnel] = await Promise.all([reviewData(), funnelData()]);
  const hunter = await hunterUsage(hunterUsed);
  const waiting = rows.filter((d: any) => ["new", "pending_gmail"].includes(d.status)).length;
  return (
    <>
      <h1 className="headline">{waiting > 0 ? <><b>{waiting} draft{waiting === 1 ? "" : "s"}</b> {waiting === 1 ? "is" : "are"} waiting for you</> : "No drafts are waiting"}</h1>
      <p className="sub">
        {!last ? "No run yet. Press Run now on the Runs & health page." : waiting > 0 ? `${funnel.articlesRead} articles read, ${funnel.startups} startups found, ${funnel.fit} fit your thesis. Last run at ${hhmm(last.started_at)} IST.` : `Nothing new fits today. Last run was at ${hhmm(last.started_at)} IST.`}
      </p>
      <Funnel f={funnel} />
      <EmailSources f={funnel} hunter={hunter} />
      <h2 className="section">Drafts to review</h2>
      {rows.length === 0 ? (
        <div className="empty">No drafts yet. When a run finds a startup that fits, its draft appears here.</div>
      ) : (
        <div className="stack">
          {rows.map((d: any) => {
            const s = d.startups;
            const sc = score(s);
            const done = d.status === "sent" || d.status === "skipped";
            return (
              <Tilt key={d.id} max={1.5}>
              <article className={`item${done ? " done" : ""}`}>
                <div className="tile" aria-label={`Score ${sc ?? "n/a"}`}>{sc == null ? "-" : Math.round(sc)}</div>
                <div className="body">
                  <div className="name">{s.name}</div>
                  <div className="line">{[s.sector, s.location, s.stage_label, s.amount_text].filter(Boolean).join(" · ") || "Details not found"}</div>
                  <div className="line">{s.description ?? "No description found."}</div>
                  <div className="how">{d.email_source === "verified" ? `Email verified by Hunter · ${d.to_email}` : d.email_source === "unverified" ? `Email from their website, not verified · ${d.to_email}` : "No email found, add one before sending"}</div>
                </div>
                <div className="right">
                  <EmailPill source={d.email_source} status={d.status} />
                  <div className="actions">
                    {d.subject && d.body && d.status !== "draft_failed" && <PreviewToggle subject={d.subject}><WithPlaceholders text={d.body} /></PreviewToggle>}
                    <Link className="btn primary" href={`/drafts/${d.id}`}>Open draft</Link>
                  </div>
                </div>
              </article>
              </Tilt>
            );
          })}
        </div>
      )}
    </>
  );
}
