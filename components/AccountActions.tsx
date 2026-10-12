"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGate } from "./AccessGate";

export default function AccountActions({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const { guard, toast } = useGate();
  const [busy, setBusy] = useState(false);
  return signedIn ? (
    <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await fetch("/api/unlock", { method: "DELETE" }); setBusy(false); toast("Signed out."); router.refresh(); }}>Sign out</button>
  ) : (
    <button className="btn primary" disabled={busy} onClick={async () => {
      setBusy(true);
      const r = await guard(() => fetch("/api/account", { cache: "no-store" }), "Signing in lets you run, save and approve.");
      setBusy(false);
      if (r?.ok) { toast("Signed in."); router.refresh(); }
    }}>Enter access code</button>
  );
}
