"use client";
import { useState } from "react";
import { useGate } from "./AccessGate";

/**
 * Opens THIS email in Gmail. It asks Gmail where the draft is right now (a saved link goes stale when a draft is edited),
 * and if the draft is gone, offers to create it again.
 */
export default function OpenGmailButton({ id, canRecreate }: { id: number; canRecreate: boolean }) {
  const { guard, toast } = useGate();
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState<"missing" | "none" | null>(null);

  async function open() {
    setBusy(true);
    const tab = window.open("", "_blank"); // opened now so the browser does not block it after the wait
    const done = (url: string | null) => {
      if (url && tab) tab.location.href = url;
      else if (url) window.location.href = url;
      else tab?.close();
    };
    try {
      const r = await fetch(`/api/drafts/${id}/gmail`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { done(null); toast(j.error ?? "Could not reach Gmail."); }
      else if (j.state === "ok") { setGone(null); done(j.url); }
      else { done(null); setGone(j.state); }
    } catch {
      done(null);
      toast("Could not reach Gmail. Try again in a moment.");
    }
    setBusy(false);
  }

  async function recreate() {
    setBusy(true);
    const r = await guard(() => fetch(`/api/drafts/${id}/recreate`, { method: "POST" }), "Putting the draft back in Gmail creates a draft, so it needs the code.");
    setBusy(false);
    if (!r) return;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error ?? `Could not create it (HTTP ${r.status}).`);
    setGone(null);
    toast(j.created ? "Created again in Gmail Drafts." : "It is already in Gmail.");
    if (j.url) window.open(j.url, "_blank");
  }

  return (
    <>
      <button className="btn primary" disabled={busy} onClick={open}>{busy ? "Opening…" : "Open Gmail draft"}</button>
      {gone && (
        <span className="note warn" role="status" style={{ margin: 0 }}>
          {gone === "missing" ? "This draft is no longer in Gmail (it may have been deleted)." : "There is no Gmail draft for this one yet."}{" "}
          {canRecreate ? <button className="btn small" disabled={busy} onClick={recreate}>Create it again</button> : "It is rewritten on the next run."}
        </span>
      )}
    </>
  );
}
