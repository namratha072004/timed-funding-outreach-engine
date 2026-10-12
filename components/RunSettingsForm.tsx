"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGate } from "./AccessGate";
import ChipList from "./ChipList";
import SaveBar from "./SaveBar";
import { Card } from "./ui";
import { LIMITS } from "@/lib/settings";

export type RunValues = { maxArticles: number; maxGemini: number; hunterLookups: number; keywords: string[] };

const FIELDS: { key: "maxArticles" | "maxGemini" | "hunterLookups"; label: string; help: string; range: readonly [number, number] }[] = [
  { key: "maxArticles", label: "Articles per run", help: "The most articles read in one run, newest first. Any left over are read in a later scheduled run.", range: LIMITS.articles },
  { key: "maxGemini", label: "Gemini calls per run", help: "The most AI calls in one run. Stops the run before it spends too much.", range: LIMITS.gemini },
  { key: "hunterLookups", label: "Email lookups per run", help: "How many startups get a Hunter email lookup. Hunter allows 50 a month.", range: LIMITS.hunter },
];

export default function RunSettingsForm({ initial }: { initial: RunValues }) {
  const router = useRouter();
  const { guard, toast } = useGate();
  const [base, setBase] = useState(initial);
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(base);
  const problem = v.keywords.length === 0 ? "Add at least one word." : null;

  async function save() {
    setSaving(true);
    setError(null);
    const r = await guard(() => fetch("/api/settings/run", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v) }), "Saving changes the settings, so it needs the access code.");
    setSaving(false);
    if (!r) return;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? `Could not save (HTTP ${r.status}).`);
    setBase(v);
    toast("Saved. Applies from the next run.");
    router.refresh();
  }

  return (
    <>
      <section className="sect" style={{ marginTop: 32 }}>
        <h2>Run settings</h2>
        <div className="sub">Limits that keep each run fast and inside your Gemini and Hunter quotas.</div>
        <Card>
          {FIELDS.map((f) => (
            <div className="fld" key={f.key}>
              <div className="l"><b>{f.label}</b><p>{f.help}</p></div>
              <input className="inp" type="number" aria-label={f.label} min={f.range[0]} max={f.range[1]} step={1} value={Number.isNaN(v[f.key]) ? "" : v[f.key]} onChange={(e) => { setError(null); setV({ ...v, [f.key]: e.target.value === "" ? NaN : Number(e.target.value) }); }} />
            </div>
          ))}
        </Card>
      </section>
      <section className="sect">
        <h2>Funding words</h2>
        <div className="sub">Headlines that contain one of these words are counted as funding-like on the Sources page. The AI still reads every article, so more words change what is counted there, not what is read.</div>
        <Card><ChipList items={v.keywords} onChange={(keywords) => { setError(null); setV({ ...v, keywords }); }} placeholder="Add a word, for example “pre-series A”" label="Add a funding word" /></Card>
      </section>
      <SaveBar dirty={dirty} problem={problem ?? (FIELDS.some((f) => Number.isNaN(v[f.key]) || v[f.key] < f.range[0] || v[f.key] > f.range[1]) ? "Check the numbers: each must be inside its allowed range." : null)} error={error} saving={saving} onDiscard={() => { setError(null); setV(base); }} onSave={save} />
    </>
  );
}
