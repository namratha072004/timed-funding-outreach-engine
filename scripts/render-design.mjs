// renders a design HTML file to a PNG: node scripts/_render.mjs <html> <png> <width> [height]
import puppeteer from "puppeteer-core";
const [, , html, png, w, h] = process.argv;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage(); await p.setViewport({ width: +w, height: +(h || 900), deviceScaleFactor: 1 });
await p.goto("file://" + process.cwd() + "/" + html); await new Promise((r) => setTimeout(r, 500));
await p.screenshot({ path: png, fullPage: !h });
await b.close();
