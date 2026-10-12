import Link from "next/link";
import DraftCard from "@/components/DraftCard";
import TelegramNote from "@/components/TelegramNote";
import { EmptyState, PageHeader } from "@/components/ui";
import { draftsData, type Tab } from "@/lib/queries";

const TABS: [Tab, string][] = [["review", "To review"], ["approved", "Approved"], ["done", "Done"]];

export default async function Drafts({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const q = (await searchParams).tab;
  const tab: Tab = q === "approved" || q === "done" ? q : "review";
  const { cards, counts } = await draftsData(tab);
  return (
    <>
      <PageHeader title="Drafts" sub={<>Nothing is ever sent without you.<TelegramNote className="sub" /></>} />
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <Link key={k} href={k === "review" ? "/drafts" : `/drafts?tab=${k}`} className={tab === k ? "on" : ""} role="tab" aria-selected={tab === k}>{label} {counts[k]}</Link>
        ))}
      </div>
      <div className="stack">
        {cards.length ? cards.map((d) => <DraftCard key={d.id} d={d} tab={tab} />) : (
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
