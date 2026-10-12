import Link from "next/link";
import TelegramNote from "@/components/TelegramNote";
import { Card } from "@/components/ui";
import { todayData } from "@/lib/queries";
import { greeting, todayIst } from "@/lib/time";

export default async function Today() {
  const t = await todayData();
  return (
    <div className="hero">
      <div className="meta">{todayIst()}</div>
      <h1>{greeting()}, Rohit.</h1>
      <p className="lead">Your latest scan is done. Here is what it found.</p>
      <div className="stats">
        <Card className="stat"><b>{t.drafts}</b><span>draft{t.drafts === 1 ? "" : "s"} ready for you</span></Card>
        <Card className="stat"><b>{t.rejected}</b><span>startups skipped (did not fit)</span></Card>
        <Card className="stat"><b>{t.articlesRead}</b><span>articles read from {t.sources} sources</span></Card>
      </div>
      <Link className="btn primary" href="/drafts">Let’s get started</Link>
      <div className="fine">Nothing is ever sent without you. <Link href="/sources">See where the articles came from</Link></div>
      <TelegramNote className="fine" />
    </div>
  );
}
