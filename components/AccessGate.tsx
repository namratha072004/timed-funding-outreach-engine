"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Ctx = {
  /** Runs a request that changes data. If the server answers 401, asks for the access code, then tries again once. */
  guard: (run: () => Promise<Response>, why: string) => Promise<Response | null>;
  toast: (message: string) => void;
};
const GateCtx = createContext<Ctx | null>(null);
export const useGate = (): Ctx => {
  const c = useContext(GateCtx);
  if (!c) throw new Error("useGate needs <AccessGate>");
  return c;
};

export default function AccessGate({ children, testing = false }: { children: React.ReactNode; testing?: boolean }) {
  const [ask, setAsk] = useState<{ why: string; done: (code: string | null) => void } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 4000);
  }, []);

  const guard = useCallback<Ctx["guard"]>(async (run, why) => {
    const first = await run();
    if (first.status !== 401) return first;
    for (;;) {
      const code = await new Promise<string | null>((done) => setAsk({ why, done }));
      setAsk(null);
      if (code == null) return null;
      const u = await fetch("/api/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (u.ok) return run();
      toast("That code is not right.");
    }
  }, [toast]);

  return (
    <GateCtx.Provider value={{ guard, toast }}>
      {children}
      {ask && <CodeModal why={ask.why} testing={testing} onDone={ask.done} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </GateCtx.Provider>
  );
}

function CodeModal({ why, testing, onDone }: { why: string; testing: boolean; onDone: (code: string | null) => void }) {
  const [code, setCode] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onDone(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onDone]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="gate-title" onClick={(e) => e.target === e.currentTarget && onDone(null)}>
      <form className="box" onSubmit={(e) => { e.preventDefault(); if (code.trim()) onDone(code); }}>
        <h2 id="gate-title">Enter access code</h2>
        <p className="sub">{why} Viewing is open to everyone.{testing && <> <b>(testing mode: any access code is accepted)</b></>}</p>
        <input ref={ref} type="password" autoComplete="current-password" placeholder="Access code" aria-label="Access code" value={code} onChange={(e) => setCode(e.target.value)} />
        <div className="actions">
          <button className="btn primary" type="submit" disabled={!code.trim()}>Confirm</button>
          <button className="btn" type="button" onClick={() => onDone(null)}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
