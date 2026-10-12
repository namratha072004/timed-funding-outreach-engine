import { WithPlaceholders } from "./Placeholders";
import MoveButtons from "./MoveButtons";
import { Card, Pub, StatusPill } from "./ui";
import { gmailLink } from "@/lib/gmail";
import type { draftsData } from "@/lib/queries";
import { tabOf } from "@/lib/queries";
import { ago } from "@/lib/time";

type Draft = Awaited<ReturnType<typeof draftsData>>["cards"][number];
const cap = (s: string | null) => (s ? s[0]!.toUpperCase() + s.slice(1) : null);

function EmailPill({ d }: { d: Draft }) {
  if (d.status === "draft_failed") return <StatusPill tone="bad">Draft failed</StatusPill>;
  if (d.emailSource === "verified") return <StatusPill tone="ok">Hunter verified</StatusPill>;
  if (d.emailSource === "unverified") return <StatusPill tone="warn">Unverified: check before sending</StatusPill>;
  return <StatusPill tone="neutral">No address found</StatusPill>;
}

function contactNote(d: Draft): string {
  if (d.emailSource === "verified") return `Hunter.io lookup${d.contact?.domain ? ` · ${d.contact.domain}` : ""} · verified, score 100`;
  if (d.emailSource === "unverified") return "Found on the startup’s contact page · not verified by Hunter";
  return "No address found";
}

/** Short and calm: the facts first, the email and the evidence one click away. */
export default function DraftCard({ d }: { d: Draft }) {
  const s = d.startup;
  const failed = d.status === "draft_failed";
  const meta = [cap(s.stage), s.amount, s.sector, s.location, d.announced ? `Announced ${ago(d.announced)}` : null].filter(Boolean).join(" · ");
  const first = d.articles[0];
  return (
    <Card className="draft">
      <article id={`draft-${d.id}`}>
        <div className="row1">
          <div>
            <div className="name">{s.name}</div>
            <div className="meta">{meta || "Details not found"}</div>
          </div>
          <div className="score"><b>{s.score == null ? "-" : Math.round(s.score)}</b><span>fit score</span></div>
        </div>

        {failed && <div className="note bad" style={{ marginTop: 16 }}>The draft could not be written: {String(d.body ?? "").replace("[draft failed] ", "")}. It is retried on the next run.</div>}
        {d.status === "pending_gmail" && <div className="note warn" style={{ marginTop: 16 }}>The Gmail draft is not created yet (Gmail did not answer). It is retried on the next run.</div>}

        <div className="grid2">
          <div><div className="k">To</div><div className="v">{d.to ?? "—"} <EmailPill d={d} /></div></div>
          <div><div className="k">Subject</div><div className="v">{d.subject ?? "—"}</div></div>
        </div>

        {!failed && d.body && (
          <details>
            <summary>Read the email</summary>
            <div className="mail"><WithPlaceholders text={d.body} /></div>
          </details>
        )}

        <details>
          <summary>
            Sources and why it passed{first ? ` · first reported by ${first.source}` : ""}{d.articles.length > 1 ? ` · ${d.articles.length} articles` : ""}
          </summary>
          <div className="srcbox">
            {d.articles.map((a) => (
              <div className="li" key={a.id}>
                <Pub>{a.source}</Pub>
                <a href={a.url} target="_blank" rel="noreferrer noopener">{a.title} ↗</a>
                <span className="meta">published {ago(a.published)}</span>
              </div>
            ))}
            {d.articles.length > 1 && <div className="meta">Same startup, {d.articles.length} articles merged into one draft.</div>}
            <div className="li"><Pub>Contact</Pub><span>{contactNote(d)}</span></div>
          </div>
          {d.why.length > 0 && <ul>{d.why.map((w) => <li key={w.name}><b>{w.name}: {w.mark}</b>{w.quote ? `, “${w.quote}”` : ""}</li>)}</ul>}
        </details>

        <div className="actions">
          <a className="btn primary" href={gmailLink(d.gmail)} target="_blank" rel="noreferrer noopener" aria-disabled={!d.gmail}>Open Gmail draft</a>
          <MoveButtons id={d.id} tab={tabOf(d.status)} movable={["new", "approved", "done", "sent", "skipped"].includes(d.status)} />
        </div>
      </article>
    </Card>
  );
}
