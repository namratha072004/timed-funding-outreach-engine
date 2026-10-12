"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGate } from "./AccessGate";

const NEXT: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  review: [{ to: "approved", label: "Approve" }],
  approved: [{ to: "done", label: "Mark done" }, { to: "new", label: "Back to review" }],
  done: [{ to: "new", label: "Back to review" }],
};

/** Moves a draft between the tabs. Needs the access code. `tab` is the tab the draft is in now. */
export default function MoveButtons({ id, tab, movable }: { id: number; tab: "review" | "approved" | "done"; movable: boolean }) {
  const router = useRouter();
  const { guard, toast } = useGate();
  const [busy, setBusy] = useState(false);
  if (!movable) return null;
  async function move(status: string) {
    setBusy(true);
    const r = await guard(() => fetch(`/api/drafts/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }), "Moving a draft changes data, so it needs the code.");
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast((await r.json().catch(() => ({}))).error ?? `Could not move the draft (HTTP ${r.status}).`);
    router.refresh();
  }
  return <>{NEXT[tab]!.map((b) => <button key={b.to} className="btn" disabled={busy} onClick={() => move(b.to)}>{b.label}</button>)}</>;
}
