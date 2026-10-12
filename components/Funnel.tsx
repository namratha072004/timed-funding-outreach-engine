import Tilt from "./Tilt";
import CountUp from "./CountUp";
import type { FunnelData } from "@/lib/queries";

const pct = (a: number, b: number) => (b > 0 ? Math.max(3, Math.round((a / b) * 100)) : 0);

/** Left to right: what the engine read, and how that narrowed down to drafts. */
export function Funnel({ f }: { f: FunnelData }) {
  const steps = [
    { label: "Articles read", n: f.articlesRead, note: `from ${f.feeds} news sources` },
    { label: "Funding announcements", n: f.announcements, note: `${Math.max(0, f.articlesRead - f.announcements)} were not funding news` },
    { label: "Startups found", n: f.startups, note: "after removing repeats" },
    { label: "Fit your thesis", n: f.fit, note: `${f.rejected} rejected, with reasons` },
    { label: "Drafts in Gmail", n: f.drafts, note: "never sent automatically", last: true },
  ];
  return (
    <section aria-label="From articles to drafts" className="funnel">
      {steps.map((s, i) => (
        <Tilt key={s.label}>
          <div className={`fstep${s.last ? " last" : ""}`} style={{ ["--i" as string]: i }}>
            <span className="flabel">{s.label}</span>
            <b className="fnum"><CountUp value={s.n} /></b>
            <i className="fbar"><u style={{ width: `${pct(s.n, f.articlesRead)}%` }} /></i>
            <span className="fnote">{s.note}</span>
          </div>
        </Tilt>
      ))}
    </section>
  );
}

/** How each draft got its email address, and why only some go into To. */
export function EmailSources({ f, hunter }: { f: FunnelData; hunter: { used: number; total: number } }) {
  const total = f.verified + f.unverified + f.none;
  const rows = [
    { cls: "verified", n: f.verified, title: "Verified by Hunter", text: "Hunter says the address is valid with a score of 100. It is the only kind placed in the Gmail To field." },
    { cls: "check", n: f.unverified, title: "From the startup's own website", text: "Read off their contact page. Not verified, so To stays blank and you check it first." },
    { cls: "none", n: f.none, title: "Not found", text: "Neither Hunter nor the website had an address. The draft is ready, To is blank." },
  ];
  return (
    <Tilt max={2}>
      <section className="card emails" aria-label="How emails were found">
        <div className="ehead">
          <h2>How the emails were found</h2>
          <span className="meta">Hunter lookups this month: <b>{hunter.used} of {hunter.total}</b></span>
        </div>
        <div className="seg" role="img" aria-label={`${f.verified} verified, ${f.unverified} from website, ${f.none} not found`}>
          {rows.map((r) => r.n > 0 && <i key={r.cls} className={r.cls} style={{ flexGrow: r.n }} />)}
          {total === 0 && <i className="none" style={{ flexGrow: 1, opacity: 0.35 }} />}
        </div>
        <div className="erows">
          {rows.map((r) => (
            <div key={r.cls} className="erow">
              <span className={`pill ${r.cls}`}>{r.n}</span>
              <div><b>{r.title}</b><div className="meta">{r.text}</div></div>
            </div>
          ))}
        </div>
      </section>
    </Tilt>
  );
}
