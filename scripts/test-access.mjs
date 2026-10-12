// npm run test:access  (server must be running; BASE_URL defaults to http://localhost:3100)
// Pages are public and read-only; every write needs the access code (cookie) and the cron routes need the bearer token.
// Prints no secrets. Nothing it does changes data: every save it sends is refused by validation.
const base = process.env.BASE_URL || "http://localhost:3100";
const results = [];
const t = (name, ok, ev) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${ev}`); };
const call = (p, { method = "GET", headers = {}, body } = {}) => fetch(base + p, { method, headers, body, redirect: "manual" });
const json = { "content-type": "application/json" };

// ---- reading is public
for (const p of ["/", "/drafts", "/drafts?tab=approved", "/rejected", "/sources", "/runs", "/settings", "/settings?tab=notifications", "/account"]) {
  const r = await call(p); const html = await r.text();
  t(`${p} is public`, r.status === 200 && /Funding Outreach/.test(html), `HTTP ${r.status}`);
}
let r = await call("/"); let html = await r.text();
t("welcome page greets Rohit", /Rohit\./.test(html) && /Let’s get started|Let&#x27;s get started|Let’s get started/.test(html), "greeting and button present");
r = await call("/unlock"); t("the old unlock page is gone", r.status === 404, `HTTP ${r.status}`);
r = await call("/rubric"); t("/rubric now redirects to Settings", r.status >= 300 && r.status < 400 && /\/settings/.test(r.headers.get("location") ?? ""), `HTTP ${r.status}`);
r = await call("/api/run/status"); t("run progress is readable without the code", r.status === 200, `HTTP ${r.status}`);
const status = await r.json(); t("run progress carries no lock holder or internals", !JSON.stringify(status).match(/holder|started_ms|"queue"/), "keys checked");

// ---- writing is not
const writes = [
  ["POST", "/api/run"], ["GET", "/api/run"], ["POST", "/api/run/stage"],
  ["POST", "/api/drafts/1/status"], ["POST", "/api/rejects/1/overrule"], ["PUT", "/api/settings/rubric"], ["PUT", "/api/settings/run"],
  ["POST", "/api/telegram/connect"], ["DELETE", "/api/telegram/connect"], ["POST", "/api/telegram/test"], ["PUT", "/api/telegram/enabled"], ["GET", "/api/account"],
];
for (const [m, p] of writes) { r = await call(p, { method: m, headers: json, body: m === "GET" ? undefined : "{}" }); t(`${m} ${p} without the code`, r.status === 401, `HTTP ${r.status}`); }
r = await call("/api/run", { headers: { authorization: "Bearer wrong" } }); t("GET /api/run with a wrong token", r.status === 401, `HTTP ${r.status}`);
r = await call("/api/settings/rubric", { method: "PUT", headers: { ...json, authorization: `Bearer ${process.env.CRON_SECRET}` }, body: "{}" }); t("the cron token cannot save settings", r.status === 401, `HTTP ${r.status}`);

// ---- the code check is real
const anyMode = process.env.ACCEPT_ANY_ACCESS_CODE === "true";
r = await call("/api/unlock", { method: "POST", headers: json, body: JSON.stringify({ code: "definitely-wrong" }) });
if (anyMode) t("testing mode: any non-empty code is accepted", r.status === 200 && !!r.headers.get("set-cookie"), `HTTP ${r.status}`);
else t("a wrong code is refused and sets no cookie", r.status === 401 && !r.headers.get("set-cookie"), `HTTP ${r.status}`);
r = await call("/api/unlock", { method: "POST", headers: json, body: JSON.stringify({ code: "" }) });
t("an empty code is refused", r.status === 401 && !r.headers.get("set-cookie"), `HTTP ${r.status}`);
r = await call("/api/unlock", { method: "POST", headers: json, body: JSON.stringify({ code: process.env.ACCESS_CODE }) });
const sc = r.headers.get("set-cookie") ?? "";
t("the right code sets an httpOnly cookie that is not the code", r.status === 200 && /HttpOnly/i.test(sc) && !sc.includes(process.env.ACCESS_CODE ?? "\0"), `HTTP ${r.status}, flags: ${[/HttpOnly/i, /SameSite=lax/i, /Max-Age=\d+/i].map((x) => (x.test(sc) ? x.source.replace(/\\/g, "") : "-")).join(" ")}`);
const cookie = sc.split(";")[0];

// ---- with the code, writes get through to validation (invalid input is a 400, never a 401)
const h = { ...json, cookie };
r = await call("/api/run", { headers: { cookie } }); t("GET /api/run with the cookie only is still refused (cron needs the bearer)", r.status === 401, `HTTP ${r.status}`);
r = await call("/api/drafts/999999/status", { method: "POST", headers: h, body: JSON.stringify({ status: "approved" }) }); t("draft move: unknown id", r.status === 409, `HTTP ${r.status}`);
r = await call("/api/drafts/1/status", { method: "POST", headers: h, body: JSON.stringify({ status: "bogus" }) }); t("draft move: bad status", r.status === 400, `HTTP ${r.status}`);
r = await call("/api/settings/run", { method: "PUT", headers: h, body: JSON.stringify({ maxArticles: 0, maxGemini: 10, hunterLookups: 1, keywords: ["seed"] }) });
t("run settings: articles per run 0 is refused with a message", r.status === 400 && /Articles per run/.test((await r.json()).error), `HTTP ${r.status}`);
r = await call("/api/settings/run", { method: "PUT", headers: h, body: JSON.stringify({ maxArticles: 10, maxGemini: 10, hunterLookups: 1, keywords: [] }) });
t("run settings: no funding words is refused", r.status === 400, `HTTP ${r.status}`);
r = await call("/api/settings/rubric", { method: "PUT", headers: h, body: JSON.stringify({ passMark: 65, weights: { sector_fit: 50, geography_fit: 50, product_traction: 50, team_signal: 0, idea_clarity: 0 }, sectors: ["AI"], geographies: ["India"], stages: ["seed"], lookbackHours: 24 }) });
t("rubric: weights that do not total 100 are refused", r.status === 400 && /add up to/.test((await r.json()).error), `HTTP ${r.status}`);
r = await call("/api/settings/rubric", { method: "PUT", headers: h, body: JSON.stringify({ passMark: 65, weights: { sector_fit: 30, geography_fit: 15, product_traction: 25, team_signal: 20, idea_clarity: 10 }, sectors: [], geographies: ["India"], stages: ["seed"], lookbackHours: 24 }) });
t("rubric: empty sectors are refused", r.status === 400, `HTTP ${r.status}`);
r = await call("/api/settings/rubric", { method: "PUT", headers: h, body: JSON.stringify({ passMark: 65, weights: { sector_fit: 30, geography_fit: 15, product_traction: 25, team_signal: 20, idea_clarity: 10 }, sectors: ["AI"], geographies: ["India"], stages: ["seed"], lookbackHours: 25 }) });
t("rubric: a look-back outside the list is refused", r.status === 400, `HTTP ${r.status}`);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} FAILED` : "\nall access checks passed");
process.exit(bad ? 1 : 0);
