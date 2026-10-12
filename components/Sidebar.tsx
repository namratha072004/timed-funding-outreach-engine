"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Review", key: "drafts" as const },
  { href: "/rejected", label: "Rejected", key: "rejected" as const },
  { href: "/runs", label: "Runs & health" },
  { href: "/rubric", label: "Rubric" },
];

export default function Sidebar({ counts }: { counts: { drafts: number; rejected: number } }) {
  const path = usePathname();
  return (
    <aside className="side">
      <div className="brand">Outreach</div>
      <nav aria-label="Main" style={{ display: "contents" }}>
        {items.map((i) => {
          const on = i.href === "/" ? path === "/" || path.startsWith("/drafts") : path.startsWith(i.href);
          return (
            <Link key={i.href} href={i.href} className={`nav${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
              <span>{i.label}</span>
              {i.key && <span className="n">{counts[i.key]}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="foot">Drafts only. Nothing is sent automatically.</div>
    </aside>
  );
}
