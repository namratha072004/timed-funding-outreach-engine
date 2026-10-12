// npm run screenshots — logs in with the access code and saves a PNG of each page to design/shots (gitignored).
import fs from "node:fs";
import puppeteer from "puppeteer-core";
const base = process.env.BASE_URL || "http://localhost:3100";
const out = "design/shots";
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${base}/unlock`);
await page.screenshot({ path: `${out}/unlock.png` });
await page.type("#code", process.env.ACCESS_CODE);
await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
const shots = { review: "/", rejected: "/rejected", runs: "/runs", rubric: "/rubric" };
for (const [n, p] of Object.entries(shots)) { await page.goto(base + p, { waitUntil: "networkidle0" }); await page.screenshot({ path: `${out}/${n}.png` }); }
const link = await page.goto(base + "/", { waitUntil: "networkidle0" }).then(() => page.$$eval("a[href^='/drafts/']", (a) => a[0]?.getAttribute("href")));
if (link) { await page.goto(base + link, { waitUntil: "networkidle0" }); await page.screenshot({ path: `${out}/draft.png`, fullPage: true }); }
await page.setViewport({ width: 390, height: 800 });
await page.goto(base + "/", { waitUntil: "networkidle0" });
await page.screenshot({ path: `${out}/review-mobile.png` });
await browser.close();
console.log("saved to", out);
