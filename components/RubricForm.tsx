"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGate } from "./AccessGate";
import ChipList from "./ChipList";
import SaveBar from "./SaveBar";
import { Card } from "./ui";
import { COUNTRY_OPTIONS, SECTOR_OPTIONS } from "@/lib/options";
import { LOOKBACK_CHOICES, REJECT_ON_NO_KEYS, STAGE_CHOICES } from "@/lib/settings";

export type RubricValues = { passMark: number; weights: Record<string, number>; rejectOnNo: Record<string, boolean>; sectors: string[]; geographies: string[]; stages: string[]; lookbackHours: number };
export type Criterion = { key: string; name: string; help: string };

const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
const stageLabel = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export default function RubricForm({ initial, criteria, scores, scoresLabel }: { initial: RubricValues; criteria: Criterion[]; scores: number[]; scoresLabel: string }) {
  const router = useRouter();
  const { guard, toast } = useGate();
  const [base, setBase] = useState(initial);
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<RubricValues>) => { setError(null); setV({ ...v, ...patch }); };

  const total = criteria.reduce((a, c) => a + (v.weights[c.key] ?? 0), 0);
  const dirty = JSON.stringify(v) !== JSON.stringify(base);
  const problem = total !== 100 ? `Weights add up to ${total}. They must add up to 100.` : !v.sectors.length ? "Add at least one sector." : !v.geographies.length ? "Add at least one country." : !v.stages.length ? "Pick at least one stage." : null;
  const reach = scores.filter((x) => x >= v.passMark).length;

  async function save() {
    setSaving(true);
    setError(null);
    const r = await guard(() => fetch("/api/settings/rubric", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v) }), "Saving changes the settings, so it needs the access code.");
    setSaving(false);
    if (!r) return;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? `Could not save (HTTP ${r.status}).`);
    setBase(v);
    toast(j.changed === false ? "Nothing had changed." : `Saved as version ${j.version}. Applies from the next run.`);
    router.refresh();
  }

  return (
    <>
      <section className="sect">
        <h2>Pass mark</h2>
        <div className="sub">The score a startup needs to reach your Drafts.</div>
        <Card>
          <div className="fld">
            <div className="l"><b>Minimum score</b><p>Scores run from 0 to 100. A startup at or above this number is drafted. Below it, it goes to Rejected, where you can still overrule it.</p></div>
            <div><input className="inp" type="number" aria-label="Minimum score" min={0} max={100} step={1} value={v.passMark} onChange={(e) => set({ passMark: clamp(Number(e.target.value)) })} /> <span className="meta">out of 100</span></div>
          </div>
          <div className="help" aria-live="polite">
            At <b>{v.passMark}</b>, <b>{reach} of {scores.length}</b> startups {scoresLabel} would reach Drafts. Lower the mark to see more startups, with more that only partly fit. Raise it to see fewer, stricter ones.
          </div>
        </Card>
      </section>

      <section className="sect">
        <h2>What counts, and how much</h2>
        <div className="sub">Five checks. Each has a weight. Together they make the 100 points.</div>
        <Card>
          {criteria.map((c) => (
            <div className="fld" key={c.key}>
              <div className="l">
                <b>{c.name}</b><p>{c.help}</p>
                {(REJECT_ON_NO_KEYS as readonly string[]).includes(c.key) && (
                  <label className="sw" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={!!v.rejectOnNo[c.key]} onChange={(e) => set({ rejectOnNo: { ...v.rejectOnNo, [c.key]: e.target.checked } })} /> Reject straight away if clearly “no”
                  </label>
                )}
              </div>
              <div>
                <input className="inp" type="number" aria-label={`${c.name} weight`} min={0} max={100} step={1} value={v.weights[c.key] ?? 0} onChange={(e) => set({ weights: { ...v.weights, [c.key]: clamp(Number(e.target.value)) } })} /> <span className="meta">points</span>
                <div className="bar"><i style={{ width: `${clamp(v.weights[c.key] ?? 0)}%` }} /></div>
              </div>
            </div>
          ))}
          <div className="total"><span>Total</span><span style={{ color: total === 100 ? "var(--ok)" : "var(--bad)" }}>{total} / 100 {total === 100 ? "✓" : "(must be 100)"}</span></div>
        </Card>
      </section>

      <section className="sect">
        <h2>Sectors you back</h2>
        <div className="sub">Startups outside these are rejected on sector. Choose from the list to add one, or press × to remove it.</div>
        <Card><ChipList items={v.sectors} onChange={(sectors) => set({ sectors })} placeholder="Choose a sector to add…" label="Add a sector" options={SECTOR_OPTIONS} /></Card>
      </section>

      <section className="sect">
        <h2>Countries</h2>
        <div className="sub">Where the startup must be based.</div>
        <Card><ChipList items={v.geographies} onChange={(geographies) => set({ geographies })} placeholder="Choose a country to add…" label="Add a country" options={COUNTRY_OPTIONS} /></Card>
      </section>

      <section className="sect">
        <h2>Stages</h2>
        <div className="sub">Which funding rounds you want to hear about.</div>
        <Card>
          <div className="fld" style={{ justifyContent: "flex-start", gap: 32 }}>
            {STAGE_CHOICES.map((s) => (
              <label className="sw" key={s}>
                <input type="checkbox" checked={v.stages.includes(s)} onChange={(e) => set({ stages: e.target.checked ? [...v.stages, s] : v.stages.filter((x) => x !== s) })} /> {stageLabel(s)}
              </label>
            ))}
          </div>
        </Card>
      </section>

      <section className="sect">
        <h2>Look-back window</h2>
        <div className="sub">How old a funding announcement can be.</div>
        <Card>
          <div className="fld">
            <div className="l"><b>Announced within the last</b><p>Older news is rejected as too old. Your outreach window is 30 to 60 days after the raise, so a short look-back means you hear about it first.</p></div>
            <select aria-label="Look-back window" value={v.lookbackHours} onChange={(e) => set({ lookbackHours: Number(e.target.value) })}>
              {LOOKBACK_CHOICES.map((h) => <option key={h} value={h}>{h} hours</option>)}
            </select>
          </div>
        </Card>
      </section>

      <SaveBar dirty={dirty} problem={problem} error={error} saving={saving} onDiscard={() => { setError(null); setV(base); }} onSave={save} />
    </>
  );
}
