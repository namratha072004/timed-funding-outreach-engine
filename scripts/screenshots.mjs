// npm run screenshots — saves a PNG of every page in dark and light, at 1280 px and 390 px, to design/shots (gitignored).
// Read-only: it only opens public pages. It also checks that no page scrolls sideways at phone width.
import fs from "node:fs";
import puppeteer from "puppeteer-core";
const base = process.env.BASE_URL || "http://localhost:3100";
const out = "design/shots";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const pages = { welcome: "/", drafts: "/drafts", approved: "/drafts?tab=approved", rejected: "/rejected", sources: "/sources", runs: "/runs", settings: "/settings", notifications: "/settings?tab=notifications", account: "/account" };
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
let overflow = 0;
for (const theme of ["dark", "light"]) {
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.setCookie({ name: "theme", value: theme, url: base }, { name: "palette", value: process.env.PALETTE || "aurora", url: base });
    for (const [name, path] of Object.entries(pages)) {
      await page.goto(base + path, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 900)); // let the fade-up finish
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) { overflow++; console.log(`SIDEWAYS SCROLL ${name} ${theme} ${w}px: ${wide}px`); }
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      // long pages (many drafts, many articles) are cropped to the first 2200 px so they stay readable
      await page.screenshot({ path: `${out}/${name}-${theme}-${w}.png`, ...(name === "welcome" ? {} : { captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(height, 2200) } }) });
    }
    await page.close();
  }
}
await browser.close();
console.log(overflow ? `${overflow} page(s) scroll sideways` : "no page scrolls sideways", "· saved to", out);
process.exit(overflow ? 1 : 0);
