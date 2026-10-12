import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusButtons } from "@/components/DraftActions";
import { EmailPill } from "@/components/Pills";
import { WithPlaceholders } from "@/components/Placeholders";
import { gmailLink } from "@/lib/gmail";
import { hoursAgo, score } from "@/lib/queries";
import { serverDb } from "@/lib/supabase";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const db = serverDb();
  const { data: d } = await db.from("drafts").select("*, startups(*)").eq("id", Number(id)).maybeSingle();
  if (!d?.startups) notFound();
  const s = d.startups;
  const [{ data: arts }, { data: crit }, { data: set }] = await Promise.all([
    db.from("articles").select("title,source,published_at,canonical_url").eq("startup_id", s.id).order("published_at", { ascending: false, nullsFirst: false }).limit(3),
    db.from("rubric_criteria").select("key,name,sort_order").order("sort_order"),
    db.from("rubric_settings").select("value").eq("key", "pass_mark").maybeSingle(),
  ]);
  const art = arts?.[0];
  const marks = s.marks?.criteria ?? {};
  const sc = score(s);
  const failed = d.status === "draft_failed";
  return (
    <>
      <p className="meta" style={{ marginBottom: 10 }}><Link href="/">← Back to Review</Link></p>
      <div className="head">
        <div>
          <h1 className="headline" style={{ fontSize: 30 }}>{s.name}</h1>
          <p className="sub">
            {art?.published_at ? `Announced ${hoursAgo(art.published_at)} · ` : ""}Source: {art?.source ?? "unknown"}
            {art && <> · <a href={art.canonical_url} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "underline" }}>article</a></>}
            {s.website && <> · {s.domain}</>}
          </p>
          <p className="meta" style={{ marginTop: 4 }}>{[s.sector, s.location, s.stage_label, s.amount_text].filter(Boolean).join(" · ")}{s.investors?.length ? ` · ${s.investors.join(", ")}` : ""}</p>
        </div>
        <div className="actions">
          <EmailPill source={d.email_source} status={["sent", "skipped", "draft_failed"].includes(d.status) ? d.status : undefined} />
          <a className="btn" href={gmailLink(d.gmail_draft_id)} target="_blank" rel="noreferrer noopener" aria-disabled={!d.gmail_draft_id}>Open Gmail draft</a>
          <StatusButtons id={d.id} status={d.status} />
        </div>
      </div>

      <div className="stack" style={{ marginBottom: 16 }}>
        {failed && <div className="note bad">The draft could not be written: {String(d.body ?? "").replace("[draft failed] ", "")}. It will be retried on the next run.</div>}
        {d.status === "pending_gmail" && <div className="note warn">The Gmail draft has not been created yet (Gmail did not answer). It is retried on the next run.</div>}
        {d.email_source === "none" && !failed && <div className="note warn">No email found (Hunter and the contact page both came up empty). The Gmail draft is created with To left blank.</div>}
        {d.email_source === "unverified" && <div className="note warn">The email came from the startup's contact page, not Hunter. It is unverified, so To is left blank in the Gmail draft. Address found: {d.to_email}</div>}
        {(d.inferred_points ?? []).map((p: any, i: number) => (
          <div key={i} className="note inferred"><b>Inferred, not in the article:</b> {p.text} <span className="meta">({String(p.kind).replace(/_/g, " ")})</span></div>
        ))}
      </div>

      {!failed && d.subject && (
        <div className="mail">
          <div className="h">
            <b>To:</b> {d.email_source === "verified" ? d.to_email : <i>(blank in Gmail)</i>}
            <br /><b>Subject:</b> {d.subject}
          </div>
          <div className="b"><WithPlaceholders text={d.body ?? ""} /></div>
        </div>
      )}

      <div className="label">Why it passed · score {sc == null ? "n/a" : Math.round(sc)} ({String(set?.value ?? "")} needed)</div>
      <div className="grid5">
        {(crit ?? []).map((c: any) => {
          const m = marks[c.key];
          return (
            <div key={c.key} className="why">
              <b>{c.name.split(" ")[0]} · {m?.mark ?? "not marked"}</b>
              <span className="q">{m?.quote ? `"${m.quote}"` : "no quote"}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
