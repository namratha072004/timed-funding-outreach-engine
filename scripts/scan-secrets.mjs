// npm run scan:secrets — looks for any secret VALUE from .env.local in the repo, the build output (client bundle) and the logs.
// Prints variable names and file paths only, never values.
import fs from "node:fs";
import path from "node:path";
const envText = fs.readFileSync(".env.local", "utf8");
const secrets = [];
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  const v = m[2].trim().replace(/^["']|["']$/g, "");
  const nonSecret = /^(GEMINI_MODEL|GEMINI_BASE_URL|GEMINI_SEARCH_ENABLED|GEMINI_FALLBACK_MODELS|SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL)$/.test(m[1]);
  if (v.length >= 8 && !nonSecret) secrets.push([m[1], v]);
}
const roots = process.argv.slice(2).length ? process.argv.slice(2) : [".", ".next"];
const skipDir = new Set(["node_modules", ".git", "cache"]);
let hits = 0, files = 0;
const walk = (p, inNext) => {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) {
      if (skipDir.has(e.name) && !(e.name === "cache" && !f.includes(".next"))) continue;
      if (f === ".next" && inNext) continue;
      walk(f, inNext);
    } else if (e.name !== ".env.local" && !e.name.endsWith(".png")) {
      let buf; try { buf = fs.readFileSync(f, "utf8"); } catch { continue; }
      files++;
      for (const [name, v] of secrets) if (buf.includes(v)) { hits++; console.log(`FOUND ${name} in ${f}`); }
    }
  }
};
walk(".", false);
console.log(`${hits ? "FAIL" : "PASS"}  scanned ${files} files (repo + .next client and server bundles) for ${secrets.length} secret values: ${hits} hit(s)`);
process.exit(hits ? 1 : 0);
