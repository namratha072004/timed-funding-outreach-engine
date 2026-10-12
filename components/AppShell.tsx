"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const MAIN = [["/", "Today"], ["/drafts", "Drafts"], ["/rejected", "Rejected"], ["/sources", "Sources"], ["/runs", "Runs & health"]] as const;

/** Sidebar plus content. The sidebar is hidden on the welcome page only. Settings and Account sit at the bottom left. */
export default function AppShell({ drafts, children }: { drafts: number; children: React.ReactNode }) {
  const path = usePathname();
  const item = (href: string, label: React.ReactNode, count?: number) => {
    const on = href === "/" ? path === "/" : path.startsWith(href);
    return (
      <Link key={href} href={href} className={`nav${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
        {label}
        {count != null && <span className="count">{count}</span>}
      </Link>
    );
  };
  return (
    <div className={`shell${path === "/" ? " solo" : ""}`}>
      <nav className="side" aria-label="Main">
        {MAIN.map(([href, label]) => item(href, <span>{label}</span>, href === "/drafts" ? drafts : undefined))}
        <div className="side-foot">
          {item("/settings", <span>Settings</span>)}
          {item("/account", <span className="who"><i className="avatar" aria-hidden="true">R</i>Account</span>)}
        </div>
      </nav>
      <main className="main"><div className="wrap">{children}</div></main>
    </div>
  );
}
