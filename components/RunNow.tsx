"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGate } from "./AccessGate";

type Step = { key: string; label: string; state: "pending" | "active" | "done"; detail: string };
type Run = { id: number; started_at: string; finished_at: string | null; status: string; counts: any; errors: string[] };

export default function RunNow() {
  const router = useRouter();
  const { guard } = useGate();
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const since = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  async function poll() {
    const r = await fetch("/api/run/status", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const j = await r.json();
    if (j.run && new Date(j.run.started_at).getTime() >= since.current - 5000) {
      setRun(j.run);
      if (j.run.finished_at) {
        stop();
        setBusy(false);
        router.refresh();
      }
    }
  }

  async function start() {
    setBusy(true);
    setRun(null);
    setMsg(null);
    since.current = Date.now();
    const res = await guard(() => fetch("/api/run", { method: "POST" }), "Running now spends Gemini quota and creates drafts, so it needs the code.").catch(() => null);
    if (!res) {
      setBusy(false);
      return; // code prompt cancelled
    }
    setOpen(true);
    if (res.status === 409) {
      setMsg("Skipped: a run is already in progress.");
      setBusy(false);
      return;
    }
    if (!res.ok) {
      setMsg(`The run could not start (HTTP ${res.status}).`);
      setBusy(false);
      return;
    }
    timer.current = setInterval(poll, 1500);
    await poll();
  }

  const steps: Step[] = run?.counts?.steps ?? [];
  const c = run?.counts ?? {};
  return (
    <>
      <button className="btn primary" onClick={start} disabled={busy}>{busy ? "Running…" : "Run now"}</button>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Run now" onClick={(e) => e.target === e.currentTarget && !busy && setOpen(false)}>
          <div className="box" style={{ width: 620 }}>
            <h2>Run now</h2>
            <p className="sub" style={{ marginBottom: 12 }}>A real run. It reads every article, scores startups and writes drafts. It never sends email.</p>
            {msg && <div className="note bad" role="alert">{msg}</div>}
            <div aria-live="polite">
              {(steps.length ? steps : [{ key: "wait", label: "Starting…", state: "active", detail: "" } as Step]).map((s, i) => (
                <div key={s.key} className={`step ${s.state}${s.state !== "pending" ? " on" : ""}`}>
                  <div className="d">{s.state === "done" ? "✓" : i + 1}</div>
                  <div>{s.label}{s.detail && <small>{s.detail}</small>}</div>
                </div>
              ))}
            </div>
            {run?.finished_at && (
              <p style={{ marginTop: 12, fontWeight: 600 }}>
                {run.status === "error" ? "Run finished with an error." : "Run finished."} {c.passed ?? 0} fit · {c.rejected ?? 0} rejected · {c.duplicates ?? 0} repeats skipped · {c.drafted ?? 0} drafted · {c.errors ?? 0} errors.
              </p>
            )}
            {run?.errors?.length ? <div className="note bad" style={{ marginTop: 12 }}>{run.errors.slice(0, 3).join(" · ")}</div> : null}
            <div className="actions" style={{ marginTop: 16 }}><button className="btn" onClick={() => setOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
