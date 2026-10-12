"use client";

/** Sticky bar for the settings forms. `problem` is shown instead of the status when the form cannot be saved yet. */
export default function SaveBar({ dirty, problem, error, saving, onDiscard, onSave }: { dirty: boolean; problem?: string | null; error?: string | null; saving: boolean; onDiscard: () => void; onSave: () => void }) {
  const msg = error ? <span className="msg bad" role="alert">{error}</span> : !dirty ? <span className="msg">No unsaved changes.</span> : problem ? <span className="msg bad">{problem}</span> : <span className="msg">You have unsaved changes.</span>;
  return (
    <div className="save">
      {msg}
      <div className="actions">
        <button className="btn" type="button" disabled={!dirty || saving} onClick={onDiscard}>Discard</button>
        <button className="btn primary" type="button" disabled={!dirty || !!problem || saving} onClick={onSave}>{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}
