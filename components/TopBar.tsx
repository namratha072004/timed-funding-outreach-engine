import Link from "next/link";
import ThemeControls from "./ThemeControls";
import type { Tone } from "./ui";

export default function TopBar({ status, palette }: { status: { text: string; tone: Tone }; palette: string }) {
  return (
    <header className="top">
      <Link href="/" className="brand">Funding Outreach</Link>
      <Link href="/runs" className="status" title="Open Runs & health">
        <i className={`dot ${status.tone}`} />
        <span>{status.text}</span>
      </Link>
      <ThemeControls palette={palette} />
    </header>
  );
}
