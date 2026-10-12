"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGate } from "./AccessGate";

export default function OverruleButton({ id, name }: { id: number; name: string }) {
  const router = useRouter();
  const { guard, toast } = useGate();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn small"
      disabled={busy}
      aria-label={`Overrule ${name}`}
      onClick={async () => {
        setBusy(true);
        const r = await guard(() => fetch(`/api/rejects/${id}/overrule`, { method: "POST" }), "Overrule moves this startup to the review queue, so it needs the code.");
        setBusy(false);
        if (!r) return;
        if (!r.ok) return toast((await r.json().catch(() => ({}))).error ?? `Could not overrule (HTTP ${r.status}).`);
        toast(`${name} is queued. Its draft is written on the next run.`);
        router.refresh();
      }}
    >
      Overrule
    </button>
  );
}
