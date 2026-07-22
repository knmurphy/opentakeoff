// Reference feature plugin — the first real consumer of the frozen v1 contract.
// It lives entirely outside the canvas: it imports nothing from core state or
// the store, only the ctx façade (#167). It exercises the FULL surface —
//   • live reads: getConditions / getShapes / units / getSelectedShapeId,
//     called at interaction time (never cached across renders), so the panel
//     reflects canvas state as it changes while the overlay is open;
//   • per-plugin storage (device scope): a persisted note round-trips;
//   • ONE real shape mutation: tag the selected (or first) shape with the note
//     via commands.dispatchShape → applyShapeCommand ("label", a documented
//     non-edit) — real undo/redo, NOT a raw setShapes.
//
// Public core ships no feature folders; this reference lives here so the seam
// has a working end-to-end consumer. It resolves to its own lazy chunk (the
// registry glob is lazy), never pulled into the entry bundle (Axis A).

import React, { useEffect, useState } from "react";
import { dispatchNoteLabel } from "./labelCommand.js";

function NotesPanel({ ctx, onClose }) {
  // LIVE reads — call the accessors on every render, never snapshot at mount.
  const conditions = ctx.getConditions();
  const shapes = ctx.getShapes();
  const selectedId = ctx.getSelectedShapeId();

  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [tagged, setTagged] = useState(null);

  // Round-trip through per-plugin device storage. Load ONCE on open: the panel
  // remounts each time the overlay opens (its key is the slot key), so mount is
  // the correct trigger. Depending on `ctx` would re-run on every canvas
  // re-render (ctx identity is intentionally per-render so accessors stay live)
  // and clobber the user's unsaved text with the last-saved value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    ctx.storage
      .get("note")
      .then((v) => { if (live && typeof v === "string") setNote(v); })
      .catch((err) => { console.error("[takeoff-notes] storage read failed:", err); });
    return () => { live = false; };
  }, []);

  // Target the selected shape, else the first shape on the canvas.
  const targetId = selectedId ?? (shapes[0] && shapes[0].id) ?? null;

  const saveNote = async () => {
    try {
      await ctx.storage.set("note", note);
      setSaved(true);
    } catch (err) {
      console.error("[takeoff-notes] storage write failed:", err);
    }
  };

  const applyTag = () => {
    // The ONE real mutation — through the command chokepoint (undoable).
    const cmd = dispatchNoteLabel(ctx.commands, targetId ? [targetId] : [], note);
    setTagged(cmd ? cmd.ids[0] : null);
  };

  return (
    <div
      style={{
        // Relative content: the host positions + sizes the overlay slot (Option
        // A). A plugin overlay renders plain content and never self-positions.
        width: "100%", boxSizing: "border-box",
        background: "var(--paper-bright)", border: "1px solid var(--ink)",
        color: "var(--ink)", fontSize: 12.5, // shadow comes from the host slot wrapper
      }}
    >
      <header
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 12px", borderBottom: "1px solid var(--ink-faint)",
        }}
      >
        <strong>Takeoff Notes <span style={{ color: "var(--cobalt)" }}>· plugin</span></strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
        >
          ×
        </button>
      </header>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ color: "var(--ink-muted)" }}>
          Units: <strong style={{ color: "var(--ink)" }}>{ctx.units}</strong> ·
          Conditions: <strong style={{ color: "var(--ink)" }}>{conditions.length}</strong> ·
          Shapes: <strong style={{ color: "var(--ink)" }}>{shapes.length}</strong>
        </div>
        <textarea
          value={note}
          onChange={(e) => { setNote(e.target.value); setSaved(false); }}
          placeholder="A note (persisted to this device), also usable as a shape tag…"
          rows={2}
          style={{
            width: "100%", boxSizing: "border-box", fontSize: 12, padding: 6,
            border: "1px solid var(--ink-faint)", resize: "vertical",
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={saveNote}
            style={{
              padding: "5px 10px", border: "1px solid var(--ink)", background: "var(--ink)",
              color: "var(--paper-bright)", cursor: "pointer", fontSize: 12, fontWeight: 600,
            }}
          >
            Save note
          </button>
          {saved && <span style={{ color: "var(--cobalt)", fontSize: 11.5 }}>saved (this device)</span>}
          <button
            type="button"
            onClick={applyTag}
            disabled={!targetId || !note.trim()}
            title={targetId ? "Tag the selected shape (undoable)" : "No shape to tag"}
            style={{
              marginLeft: "auto", padding: "5px 10px", border: "1px solid var(--ink-faint)",
              background: "var(--paper-bright)",
              cursor: targetId && note.trim() ? "pointer" : "not-allowed", fontSize: 12,
            }}
          >
            Tag shape
          </button>
        </div>
        {tagged && (
          <span style={{ color: "var(--cobalt)", fontSize: 11.5 }}>
            tagged shape {String(tagged)} — ⌘Z to undo
          </span>
        )}
      </div>
    </div>
  );
}

export default {
  id: "takeoff-notes",
  minCtxVersion: "1.0",
  overlays: [
    { id: "notes", label: "Notes", icon: "✎", render: (props) => <NotesPanel {...props} /> },
  ],
  exports: [],
};
