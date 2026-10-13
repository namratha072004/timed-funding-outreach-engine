"use client";
import { useState } from "react";

/**
 * Removable chips. With `options`, new items are picked from a list (choosing one adds it at once) and the last
 * entry, "Other…", opens a box to type your own; without `options`, they are typed into an add box.
 * Trimming and de-duplicating also happen on the server.
 */
const OTHER = "__other__";

export default function ChipList({ items, onChange, placeholder, label, options }: { items: string[]; onChange: (next: string[]) => void; placeholder: string; label: string; options?: string[] }) {
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const have = new Set(items.map((x) => x.toLowerCase()));
  const add = () => {
    const v = text.trim().replace(/\s+/g, " ");
    if (v && !have.has(v.toLowerCase())) onChange([...items, v]);
    setText("");
    setTyping(false);
  };
  const left = options?.filter((o) => !have.has(o.toLowerCase()));
  return (
    <>
      <div className="chips">
        {items.length ? items.map((x, i) => (
          <span className="chip" key={x}>
            {x}
            <button type="button" aria-label={`Remove ${x}`} title="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
          </span>
        )) : <span className="meta">None yet</span>}
      </div>
      {left && !typing ? (
        <div className="addrow">
          <select aria-label={label} value="" onChange={(e) => { if (e.target.value === OTHER) setTyping(true); else if (e.target.value) onChange([...items, e.target.value]); }}>
            <option value="">{placeholder}</option>
            {left.map((o) => <option key={o} value={o}>{o}</option>)}
            <option value={OTHER}>Other… (type your own)</option>
          </select>
        </div>
      ) : (
        <div className="addrow">
          <input className="inp wide" aria-label={label} placeholder={typing ? "Type it here, then press Add" : placeholder} value={text} autoFocus={typing} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <button className="btn" type="button" onClick={add}>Add</button>
          {typing && <button className="btn" type="button" onClick={() => { setText(""); setTyping(false); }}>Back to list</button>}
        </div>
      )}
    </>
  );
}
