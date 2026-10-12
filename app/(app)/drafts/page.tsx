import Link from "next/link";
import DraftCard from "@/components/DraftCard";
import TelegramNote from "@/components/TelegramNote";
import { EmptyState, PageHeader } from "@/components/ui";
import { draftsData, KINDS, type Kind, type Tab } from "@/lib/queries";

const TABS: [Tab, string][] = [["review", "To review"], ["approved", "Approved"], ["done", "Done"]];
const KIND_HELP: Record<Kind, string> = {
  verified: "Hunter checked these addresses (valid, score 100). They are filled into the Gmail To field.",
  unverified: "The address came from the startup's own website and is not verified. To is blank in Gmail: check it before sending.",
  none: "No address was found. The draft is ready; add an address in Gmail.",
};

export default async function Drafts({ searchParams }: { searchParams: Promise<{ tab?: string; kind?: string }> }) {
  const q = await searchParams;
  const tab: Tab = q.tab === "approved" || q.tab === "done" ? q.tab : "review";
  const kind = KINDS.find((k) => k.key === q.kind)?.key;
  const { cards, counts, kindCounts, shownKind } = await draftsData(tab, kind);
  const href = (t: Tab, k?: Kind) => `/drafts${t === "review" && !k ? "" : "?"}${[t !== "review" ? `tab=${t}` : "", k ? `kind=${k}` : ""].filter(Boolean).join("&")}`;
  return (
    <>
      <PageHeader title="Drafts" sub={<>Nothing is ever sent without you.<TelegramNote className="sub" /></>} />
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <Link key={k} href={href(k)} className={tab === k ? "on" : ""} role="tab" aria-selected={tab === k}>{label} {counts[k]}</Link>
        ))}
      </div>
      <div className="kinds" role="tablist" aria-label="Email status">
        {KINDS.map((k) => (
          <Link key={k.key} href={href(tab, k.key)} className={`kind ${k.key}${shownKind === k.key ? " on" : ""}`} role="tab" aria-selected={shownKind === k.key}>
            {k.label} <b>{kindCounts[k.key]}</b>
          </Link>
        ))}
      </div>
      <p className="meta kindhelp">{KIND_HELP[shownKind]}</p>
      <div className="stack">
        {cards.length ? cards.map((d) => <DraftCard key={d.id} d={d} />) : (
          <EmptyState
            title="No drafts here"
            text={tab === "review" ? "New drafts appear after the next run." : tab === "approved" ? "Approve drafts from To review." : "Mark approved drafts as done and they move here."}
            action={<Link className="btn" href="/runs">See last run</Link>}
          />
        )}
      </div>
    </>
  );
}
