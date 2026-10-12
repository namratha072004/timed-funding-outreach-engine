// npm run test:access  (server must be running; BASE_URL defaults to http://localhost:3100)
// Checks acceptance item 7: cron route rejects without the bearer token, dashboard rejects without the cookie. Prints no secrets.
const base = process.env.BASE_URL || "http://localhost:3100";
const results = [];
const t = (name, ok, ev) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${ev}`); };
const get = (p, h = {}, m = "GET") => fetch(base + p, { method: m, headers: h, redirect: "manual" });

let r = await get("/");
t("dashboard without cookie redirects to unlock", r.status >= 300 && r.status < 400 && r.headers.get("location")?.includes("/unlock"), `HTTP ${r.status} -> ${r.headers.get("location")}`);
for (const p of ["/rejected", "/runs", "/rubric", "/drafts/1"]) { r = await get(p); t(`${p} without cookie`, r.status >= 300 && r.status < 400, `HTTP ${r.status}`); }
r = await get("/unlock"); const html = await r.text();
t("unlock page is public and shows only the form", r.status === 200 && html.includes('name="code"') && !/waiting for you|Rejected|Runs &amp; health|Rubric/.test((html.match(/<body[\s\S]*<\/body>/)?.[0] ?? "").replace(/<script[\s\S]*?<\/script>/g, "")), `HTTP ${r.status}`);
r = await get("/api/run"); t("GET /api/run without token", r.status === 401, `HTTP ${r.status}`);
r = await get("/api/run", { authorization: "Bearer wrong" }); t("GET /api/run with wrong token", r.status === 401, `HTTP ${r.status}`);
r = await get("/api/run", {}, "POST"); t("POST /api/run without token or cookie", r.status === 401, `HTTP ${r.status}`);
r = await get("/api/run", { authorization: "Bearer wrong" }, "POST"); t("POST /api/run wrong token", r.status === 401, `HTTP ${r.status}`);
r = await get("/api/run/status"); t("GET /api/run/status without cookie", r.status === 401, `HTTP ${r.status}`);
r = await get("/api/drafts/1/status", { "content-type": "application/json" }, "POST"); t("POST draft status without cookie", r.status === 401, `HTTP ${r.status}`);
r = await get("/api/rejects/1/overrule", {}, "POST"); t("POST overrule without cookie", r.status === 401, `HTTP ${r.status}`);
r = await fetch(base + "/api/unlock", { method: "POST", body: new URLSearchParams({ code: "definitely-wrong" }), redirect: "manual" });
t("wrong access code is refused and sets no cookie", r.headers.get("location")?.includes("error=1") && !r.headers.get("set-cookie"), `HTTP ${r.status}`);
r = await fetch(base + "/api/unlock", { method: "POST", body: new URLSearchParams({ code: process.env.ACCESS_CODE ?? "" }), redirect: "manual" });
const sc = r.headers.get("set-cookie") ?? "";
t("right access code sets an httpOnly cookie (value is not the code)", /HttpOnly/i.test(sc) && !sc.includes(process.env.ACCESS_CODE ?? "\0"), `HTTP ${r.status}, flags: ${[/HttpOnly/i, /SameSite=lax/i, /Secure/i].map((x) => x.test(sc) ? x.source.replace(/\\/g, "") : "-").join(" ")}`);
const cookie = sc.split(";")[0];
r = await get("/", { cookie }); const page = await r.text();
t("dashboard with cookie renders the Review page", r.status === 200 && /Outreach/.test(page), `HTTP ${r.status}`);
for (const p of ["/rejected", "/runs", "/rubric"]) { r = await get(p, { cookie }); t(`${p} with cookie`, r.status === 200, `HTTP ${r.status}`); }
r = await get("/api/run", { cookie }); t("GET /api/run with cookie only is refused (cron needs the bearer)", r.status === 401, `HTTP ${r.status}`);
r = await get("/api/run/status", { cookie }); t("status API with cookie", r.status === 200, `HTTP ${r.status}`);
r = await get("/api/drafts/999999/status", { cookie, "content-type": "application/json" }, "POST"); t("draft status API rejects bad input / unknown id", r.status === 400 || r.status === 409, `HTTP ${r.status}`);
const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} FAILED` : "\nall access checks passed");
process.exit(bad ? 1 : 0);
