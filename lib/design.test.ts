import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(process.env.CSS_FILE ?? "app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// ---- token cascade: :root (light), [data-theme="dark"], [data-palette=x], [data-palette=x][data-theme="dark"] ----
type Rule = { attrs: Record<string, string>; root: boolean; spec: number; order: number; vars: Record<string, string> };
const rules: Rule[] = [];
for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
  const sel = m[1]!.trim();
  if (!/^(:root|(\[data-(?:theme|palette)="[a-z]+"\])+)$/.test(sel)) continue;
  const attrs: Record<string, string> = {};
  for (const a of sel.matchAll(/\[data-(theme|palette)="([a-z]+)"\]/g)) attrs[a[1]!] = a[2]!;
  const vars: Record<string, string> = {};
  for (const v of m[2]!.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) vars[v[1]!] = v[2]!.trim();
  rules.push({ attrs, root: sel === ":root", spec: sel === ":root" ? 1 : Object.keys(attrs).length, order: rules.length, vars });
}
function tokens(palette: string, theme: "light" | "dark"): Record<string, string> {
  const hit = rules.filter((r) => r.root || Object.entries(r.attrs).every(([k, v]) => (k === "theme" ? v === theme : v === palette)));
  hit.sort((a, b) => a.spec - b.spec || a.order - b.order);
  return Object.assign({}, ...hit.map((r) => r.vars));
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// [text token, background token, where it is used]
const PAIRS: [string, string, string][] = [
  ["--ink", "--bg", "body text"], ["--ink", "--surface", "card text"], ["--ink", "--tint", "notes, help boxes"], ["--ink", "--line", "nav count"],
  ["--muted", "--bg", "meta text"], ["--muted", "--surface", "meta text on cards"], ["--muted", "--tint", "neutral pill"],
  ["--accent", "--bg", "links on page"], ["--accent", "--surface", "links on cards"], ["--accent", "--tint", "chips, publisher tags, active nav"],
  ["--accent-ink", "--accent", "primary button"],
  ["--ok", "--ok-bg", "OK pill"], ["--warn", "--warn-bg", "warning pill"], ["--bad", "--bad-bg", "rejected pill"],
  ["--ok", "--bg", "total line"], ["--bad", "--bg", "total line"], ["--bad", "--surface", "save bar message"],
  ["--ink", "--hl", "highlighted [PLACEHOLDER]"], ["--bg", "--ink", "toast"],
];
const PALETTES = ["green", "aurora", "slate", "indigo", "terra", "plum"];

describe("text contrast is at least 4.5:1 in every palette, light and dark", () => {
  for (const palette of PALETTES) {
    for (const theme of ["light", "dark"] as const) {
      it(`${palette} ${theme}`, () => {
        const t = tokens(palette, theme);
        const bad: string[] = [];
        for (const [fg, bg, where] of PAIRS) {
          expect(t[fg], `${fg} defined for ${palette}/${theme}`).toMatch(/^#[0-9a-f]{6}$/i);
          expect(t[bg], `${bg} defined for ${palette}/${theme}`).toMatch(/^#[0-9a-f]{6}$/i);
          const r = ratio(t[fg]!, t[bg]!);
          if (r < 4.5) bad.push(`${where}: ${fg} ${t[fg]} on ${bg} ${t[bg]} = ${r.toFixed(2)}`);
        }
        if (palette === "aurora") {
          const stops = t["--grad"]!.match(/#[0-9a-f]{6}/gi)!;
          expect(stops).toHaveLength(2);
          for (const s of stops) {
            const r = ratio(t["--grad-ink"]!, s);
            if (r < 4.5) bad.push(`gradient text ${t["--grad-ink"]} on ${s} = ${r.toFixed(2)}`);
          }
        }
        expect(bad).toEqual([]);
      });
    }
  }
});

describe("layout and style rules", () => {
  it("uses only the three text sizes", () => {
    const sizes = [...css.matchAll(/(?<![-\w])font-size:\s*([^;}]+)/g)].map((m) => m[1]!.trim());
    expect(sizes.length).toBeGreaterThan(20);
    for (const s of sizes) expect(s).toMatch(/^var\(--fs-(lg|md|sm)\)$/);
    const defs = [...css.matchAll(/--fs-(lg|md|sm):\s*(\d+)px/g)];
    expect(new Set(defs.map((d) => d[1])).size).toBe(3);
  });
  it("sets no font size inline in a component", () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx$/.test(f) && files.push(join(d, f))));
    walk("app");
    walk("components");
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/fontSize/);
  });
  it("centres one content column about 1000px wide", () => expect(css).toMatch(/\.wrap \{[^}]*max-width: 1000px;[^}]*margin: 0 auto/));
  it("uses gradients only on the primary button, the logo, the first welcome stat and the glow", () => {
    const withGradient = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /gradient\(|var\(--grad\)/.test(body!.replace(/--grad:[^;]+;/g, "")))
      .map(([, sel]) => sel!.trim())
      .sort();
    expect(withGradient).toEqual([
      '[data-palette="aurora"] .brand',
      '[data-palette="aurora"] .btn.primary',
      '[data-palette="aurora"] .hero .stats .stat:first-child',
      '[data-palette="aurora"] .hero::before',
    ].sort());
  });
  it("keeps email text and quotes on a flat background", () => {
    for (const sel of [".mail", ".srcbox", ".li", "details", ".meta"]) {
      const rule = css.match(new RegExp(`(^|\\n)${sel.replace(".", "\\.")} \\{([^}]*)\\}`))?.[2] ?? "";
      expect(rule).not.toMatch(/gradient|--grad/);
    }
  });
  it("switches the welcome animation off for reduced motion", () => expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.hero > \* \{ animation: none; \} \}/));
});
