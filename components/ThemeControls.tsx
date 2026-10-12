"use client";

const PALETTES = [["aurora", "Aurora"], ["green", "Green"], ["slate", "Slate blue"], ["indigo", "Indigo"], ["terra", "Terracotta"], ["plum", "Plum"]];
const remember = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`; // a cookie, not localStorage
};

/** Palette dropdown and Dark/Light toggle. The theme choice is remembered in a cookie; with no cookie the system theme is used. */
export default function ThemeControls({ palette }: { palette: string }) {
  return (
    <>
      <select className="icon-btn" aria-label="Colour palette" defaultValue={palette} onChange={(e) => { document.documentElement.dataset.palette = e.target.value; remember("palette", e.target.value); }}>
        {PALETTES.map(([v, l]) => <option key={v} value={v}>Palette: {l}</option>)}
      </select>
      <button
        className="icon-btn"
        type="button"
        onClick={() => {
          const r = document.documentElement;
          const next = r.dataset.theme === "dark" ? "light" : "dark";
          r.dataset.theme = next;
          remember("theme", next);
        }}
      >
        <span className="if-dark">Light mode</span>
        <span className="if-light">Dark mode</span>
      </button>
    </>
  );
}
