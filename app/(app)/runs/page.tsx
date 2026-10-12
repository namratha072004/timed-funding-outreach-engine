import RunNow from "@/components/RunNow";
import { hunterAccount } from "@/lib/contacts";
import { avgDelay, fmtTime, reviewData } from "@/lib/queries";
import { lockState } from "@/lib/lock";
import { serverDb } from "@/lib/supabase";

async function check(name: string, fn: () => Promise<boolean>) {
  try {
    return { name, ok: await Promise.race([fn(), new Promise<boolean>((r) => setTimeout(() => r(false), 6000))]) };
  } catch {
    return { name, ok: false };
  }
}

export default async function Runs() {
  const db = serverDb();
  const { runs, hunterUsed } = await reviewData();
  const [lock, services] = await Promise.all([
    lockState(db),
    Promise.all([
      check("Gemini", async () => {
        const base = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
        return (await fetch(`${base}/models?pageSize=1`, { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" }, cache: "no-store" })).ok;
      }),
      check("Supabase", async () => !(await db.from("rubric_meta").select("version").limit(1)).error),
      check("Gmail", async () => (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", refresh_token: process.env.GOOGLE_REFRESH_TOKEN ?? "", grant_type: "refresh_token" }), cache: "no-store" })).ok),
      check("Hunter", async () => (await hunterAccount()) != null),
    ]),
  ]);
  const finished = runs.filter((r: any) => r.finished_at && r.status !== "skipped");
  const last = finished[0];
  const delays = Object.entries((last?.source_delays ?? {}) as Record<string, { avg_hours: number }>);
  const avg = avgDelay(last?.source_delays);
  return (
    <>
      <div className="head">
        <div><h1 className="headline">Runs &amp; health</h1><p className="sub">The daily run is at 09:00 IST. Hobby plan timing can slip by up to an hour.</p></div>
        <RunNow />
      </div>
      <div className="grid3" style={{ marginBottom: 18 }}>
        <div className="card">
          <h4>Services</h4>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
            {services.map((s) => <span key={s.name} className={`pill ${s.ok ? "verified" : "none"}`}>{s.name} {s.ok ? "OK" : "down"}</span>)}
          </div>
          <div className="meta">Run lock: {lock.locked ? `held until ${fmtTime(lock.until)}` : "free"}</div>
        </div>
        <div className="card">
          <h4>Hunter lookups this month</h4>
          <div className="big">{hunterUsed} <span className="meta">of 50 free</span></div>
          <div className="bar" role="progressbar" aria-valuenow={hunterUsed} aria-valuemin={0} aria-valuemax={50}><i style={{ width: `${Math.min(100, (hunterUsed / 50) * 100)}%` }} /></div>
        </div>
        <div className="card">
          <h4>News to first seen</h4>
          <div className="big">{avg == null ? "-" : `${avg.toFixed(1)} h`}</div>
          <div className="meta">{delays.length ? delays.map(([k, v]) => `${k} ${v.avg_hours.toFixed(1)} h`).join(" · ") : "No data yet"}</div>
        </div>
      </div>
      {!runs.length ? (
        <div className="empty">No runs yet.</div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Run (IST)</th><th>Articles</th><th>New startups</th><th>Drafted</th><th>Rejected</th><th>Duplicates skipped</th><th>Errors</th><th>Took</th></tr></thead>
            <tbody>
              {runs.slice(0, 20).map((r: any) => {
                const c = r.counts ?? {};
                const unfinished = !r.finished_at;
                return (
                  <tr key={r.id}>
                    <td>{fmtTime(r.started_at)} <span className="meta">{c.trigger ?? ""}</span></td>
                    {r.status === "skipped" ? <td colSpan={7}><span className="pill check">Skipped: already running</span></td> : <>
                      <td>{c.fetched ?? "-"}</td><td>{c.startups_new ?? "-"}</td><td>{c.drafted ?? "-"}</td><td>{c.rejected ?? "-"}</td><td>{c.duplicates ?? "-"}</td>
                      <td>{unfinished ? <span className="pill check">did not finish</span> : c.errors ? <span className="pill check" title={(r.errors ?? []).join("\n")}>{c.errors} errors</span> : 0}</td>
                      <td>{c.duration_ms ? `${Math.round(c.duration_ms / 1000)} s` : "-"}</td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {last?.errors?.length ? <div className="banner error" style={{ marginTop: 16 }}><b>Last run errors:</b> {last.errors.slice(0, 5).join(" · ")}</div> : null}
    </>
  );
}
