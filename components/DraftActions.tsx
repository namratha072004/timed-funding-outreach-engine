"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function StatusButtons({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function set(next: string) {
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/drafts/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next }) });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    setBusy(false);
    router.refresh();
  }
  const reviewable = ["new", "sent", "skipped"].includes(status);
  if (!reviewable) return null;
  return (
    <>
      <button className="btn" disabled={busy || status === "skipped"} onClick={() => set("skipped")}>{status === "skipped" ? "Skipped" : "Skip"}</button>
      <button className="btn primary" disabled={busy || status === "sent"} onClick={() => set("sent")}>{status === "sent" ? "Marked sent" : "Mark sent"}</button>
      {(status === "sent" || status === "skipped") && <button className="btn sm" disabled={busy} onClick={() => set("new")}>Undo</button>}
      {err && <span className="pill none" role="alert">{err}</span>}
    </>
  );
}

export function OverruleButton({ id }: { id: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  async function go() {
    setState("busy");
    const r = await fetch(`/api/rejects/${id}/overrule`, { method: "POST" });
    setState(r.ok ? "done" : "err");
    if (r.ok) router.refresh();
  }
  if (state === "done") return <span className="pill info">Queued for a draft</span>;
  return <button className="btn sm" onClick={go} disabled={state === "busy"}>{state === "err" ? "Failed, retry" : "Overrule"}</button>;
}

export function PreviewToggle({ subject, children }: { subject: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Preview"}</button>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={`Preview: ${subject}`} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div>
            <div className="mail"><div className="h"><b>Subject:</b> {subject}</div><div className="b">{children}</div></div>
            <div style={{ marginTop: 14 }}><button className="btn" onClick={() => setOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
