// Step 0: connectivity checks. Prints PASS/FAIL with evidence, never secret values.
const env = process.env;
const results = [];
const rec = (id, ok, evidence) => {
  results.push({ id, ok });
  console.log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${id}: ${evidence}`);
};
const need = (...k) => k.filter((x) => !env[x]);
const safe = async (id, fn) => {
  try { await fn(); } catch (e) { rec(id, false, String(e.message || e).replace(/key=[^&\s]+/g, "key=***")); }
};

// (a) Supabase
await safe("a supabase rubric_weight_total", async () => {
  const m = need("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  if (m.length) return rec("a supabase rubric_weight_total", false, `missing env: ${m}`);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rubric_weight_total?select=*`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const j = await r.json();
  const v = Number(j?.[0]?.total_active_weight);
  rec("a supabase rubric_weight_total", v === 100, `HTTP ${r.status}, total_active_weight=${v}`);
});

// (b) Gemini + (c) grounding + stability. Base URL and model are configurable.
// Vertex express:  GEMINI_BASE_URL=https://aiplatform.googleapis.com/v1/publishers/google
// AI Studio:       GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
const base = (env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const isVertex = base.includes("aiplatform.googleapis.com");
const gcall = (model, body) =>
  fetch(`${base}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const jsonBody = { contents: [{ role: "user", parts: [{ text: 'Return {"ok":true,"n":7}' }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" }, n: { type: "INTEGER" } } } } };
let flash = env.GEMINI_MODEL;
await safe("b gemini flash json", async () => {
  if (need("GEMINI_API_KEY").length) return rec("b gemini flash json", false, "missing GEMINI_API_KEY");
  if (!isVertex) {
    const r = await fetch(`${base}/models?pageSize=200`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
    const j = await r.json();
    const flashes = (j.models || []).map((m) => m.name.replace("models/", "")).filter((n) => /flash/.test(n) && !/(lite|image|tts|live|audio|exp|thinking)/.test(n));
    console.log("     flash models available:", flashes.join(", "));
    flash ||= flashes.sort().reverse()[0];
  }
  if (!flash) return rec("b gemini flash json", false, "no GEMINI_MODEL set (Vertex has no model list for keys)");
  const g = await gcall(flash, jsonBody);
  const gj = await g.json();
  const txt = gj?.candidates?.[0]?.content?.parts?.[0]?.text;
  const ok = g.ok && JSON.parse(txt).ok === true;
  rec("b gemini flash json", ok, `model=${flash}, HTTP ${g.status}${g.ok ? "" : " " + (gj.error?.status || "")}`);
});
await safe("c gemini grounding", async () => {
  if (!flash) return rec("c gemini grounding", false, "no flash model");
  const g = await gcall(flash, { contents: [{ role: "user", parts: [{ text: "Indian startups that announced seed funding this week" }] }], tools: [{ google_search: {} }] });
  const gj = await g.json();
  const chunks = gj?.candidates?.[0]?.groundingMetadata?.groundingChunks?.length || 0;
  rec("c gemini grounding", g.ok && chunks > 0, `HTTP ${g.status}, groundingChunks=${chunks}${g.ok && chunks ? "" : " (keep GEMINI_SEARCH_ENABLED=false)"}`);
});
await safe("c2 gemini stability", async () => {
  if (!flash) return rec("c2 gemini stability", false, "no flash model");
  const body = { contents: [{ role: "user", parts: [{ text: "Classify: 'Acme raised $2M seed round led by X'. Give stage_label (pre-seed|seed|other) and a one-sentence reason." }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { stage_label: { type: "STRING" }, reason: { type: "STRING" } }, required: ["stage_label", "reason"] } } };
  const out = [];
  for (let i = 0; i < 3; i++) { const j = await (await gcall(flash, body)).json(); out.push(JSON.parse(j.candidates[0].content.parts[0].text).stage_label); }
  rec("c2 gemini stability", out.every((x) => x === out[0]), `3 repeats stage_label=${JSON.stringify(out)}`);
});

// (d) Hunter
await safe("d hunter account", async () => {
  if (need("HUNTER_API_KEY").length) return rec("d hunter account", false, "missing HUNTER_API_KEY");
  const r = await fetch("https://api.hunter.io/v2/account", { headers: { "X-API-KEY": env.HUNTER_API_KEY } });
  const j = await r.json();
  const s = j?.data?.requests?.searches;
  rec("d hunter account", r.ok, `HTTP ${r.status}, searches used=${s?.used}/${s?.available}`);
});

// (e) Gmail
await safe("e gmail draft create/delete", async () => {
  const m = need("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN");
  if (m.length) return rec("e gmail draft create/delete", false, `missing env: ${m}`);
  const t = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  const tj = await t.json();
  if (!t.ok) return rec("e gmail draft create/delete", false, `token exchange HTTP ${t.status}: ${tj.error}`);
  const h = { Authorization: `Bearer ${tj.access_token}`, "content-type": "application/json" };
  const raw = Buffer.from("Subject: outreach-engine connectivity test\r\n\r\ntest").toString("base64url");
  const c = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", headers: h, body: JSON.stringify({ message: { raw } }) });
  const cj = await c.json();
  if (!c.ok) return rec("e gmail draft create/delete", false, `create HTTP ${c.status}`);
  const d = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${cj.id}`, { method: "DELETE", headers: h });
  rec("e gmail draft create/delete", d.status === 204, `create HTTP ${c.status}, delete HTTP ${d.status}`);
});

// (f) feeds
const FEEDS = {
  Inc42: "https://inc42.com/feed/",
  YourStory: "https://yourstory.com/feed",
  Entrackr: "https://entrackr.com/rss",
  "ET Entrepreneur": "https://economictimes.indiatimes.com/small-biz/startups/rssfeeds/11993034.cms",
};
for (const [name, url] of Object.entries(FEEDS)) {
  await safe(`f feed ${name}`, async () => {
    const r = await fetch(url, { headers: { "user-agent": "OutreachEngine/1.0" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const x = await r.text();
    const items = (x.match(/<item[ >]|<entry[ >]/g) || []).length;
    rec(`f feed ${name}`, r.ok && items > 0, `HTTP ${r.status}, items=${items}, url=${url}`);
  });
}
const failed = results.filter((r) => r.ok === false).length;
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
