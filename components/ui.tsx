import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "bad" | "neutral";

/** Title top-left, actions top-right. */
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`.trim()}>{children}</div>;
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <Card className="empty">
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {action}
    </Card>
  );
}

export function StatusPill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className={`pill ${tone}`} title={title}>{children}</span>;
}

/** Publisher tag, for example Inc42. */
export function Pub({ children }: { children: ReactNode }) {
  return <span className="pub">{children}</span>;
}
