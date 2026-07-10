// ImportSchedulePanel — the approval dialog for "Import from schedule".
// The estimator drags a box around the finish/material schedule; the parent
// (TakeoffCanvas) extracts + parses it (lib/scheduleParse) and hands the rows
// here. This view is the one human beat: glance, uncheck what you don't want,
// Create. It invents nothing — it only toggles what the parser found.
//
// Parsing/normalization is the parent's (tested) job; this holds only local
// checkbox state. Contract:
//   <ImportSchedulePanel rows existing={Set<finish_tag>} onCreate(rows[]) onClose />
//
// Defaults do the work: ceilings/millwork arrive suggested:false (unchecked),
// and codes already present as conditions arrive locked ("in use") so a second
// import can't duplicate them.
import React, { useMemo, useState } from "react";
import { Icon } from "../brand/icons.jsx";

// category → display group, in the order an estimator reads a floor set
const GROUPS = [
  { key: "floor", label: "Floor" },
  { key: "base", label: "Base" },
  { key: "wall", label: "Wall" },
  { key: "transition", label: "Transition" },
  { key: "ceiling", label: "Ceiling" },
  { key: "other", label: "Other" },
];

export default function ImportSchedulePanel({ rows = [], existing = new Set(), palette = [], startIndex = 0, onCreate, onClose }) {
  // a row is selectable only if its code isn't already a condition
  const canPick = (r) => !existing.has(r.finish_tag);
  const [picked, setPicked] = useState(() => new Set(rows.filter((r) => r.suggested && canPick(r)).map((r) => r.finish_tag)));

  // preview the line color each new condition will actually get: the parent
  // assigns palette[startIndex + n] over the creatable rows in this order, so
  // mirror that here (in-use rows are skipped, matching create).
  const colorByTag = useMemo(() => {
    const m = new Map();
    let n = startIndex;
    for (const r of rows) if (canPick(r) && palette.length) m.set(r.finish_tag, palette[n++ % palette.length]);
    return m;
  }, [rows, palette, startIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const by = new Map(GROUPS.map((g) => [g.key, []]));
    for (const r of rows) (by.get(r.category) || by.get("other")).push(r);
    return GROUPS.filter((g) => (by.get(g.key) || []).length).map((g) => ({ ...g, rows: by.get(g.key) }));
  }, [rows]);

  const toggle = (tag) => setPicked((s) => { const n = new Set(s); n.has(tag) ? n.delete(tag) : n.add(tag); return n; });
  const toggleGroup = (grp) => {
    const pickable = grp.rows.filter(canPick).map((r) => r.finish_tag);
    const allOn = pickable.length > 0 && pickable.every((t) => picked.has(t));
    setPicked((s) => { const n = new Set(s); for (const t of pickable) allOn ? n.delete(t) : n.add(t); return n; });
  };

  const count = picked.size;
  const create = () => { if (count) onCreate(rows.filter((r) => picked.has(r.finish_tag))); };

  const lbl = { fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.32)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxHeight: "min(82vh, 720px)", display: "flex", flexDirection: "column", background: "var(--paper-bright)", border: "1px solid var(--cobalt)", boxShadow: "var(--shadow-pop)", fontSize: 12.5 }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--ink-faint)", background: "var(--cobalt)", color: "var(--accent-contrast)" }}>
          <span style={{ fontWeight: 700 }}>Import from schedule — {rows.length} finish{rows.length === 1 ? "" : "es"} found</span>
          <button onClick={onClose} title="Close" style={{ background: "transparent", border: "none", color: "var(--accent-contrast)", cursor: "pointer", display: "inline-flex" }}><Icon name="close" size={14} /></button>
        </div>

        {/* rows */}
        <div style={{ overflow: "auto", padding: "4px 0" }}>
          {grouped.map((grp) => {
            const pickable = grp.rows.filter(canPick).map((r) => r.finish_tag);
            const allOn = pickable.length > 0 && pickable.every((t) => picked.has(t));
            return (
              <div key={grp.key}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", cursor: pickable.length ? "pointer" : "default", background: "var(--paper)", borderTop: "1px solid var(--ink-faint)" }}>
                  <input type="checkbox" checked={allOn} disabled={!pickable.length} onChange={() => toggleGroup(grp)} />
                  <span style={lbl}>{grp.label}</span>
                  <span style={{ ...lbl, opacity: 0.6 }}>{grp.rows.length}</span>
                </label>
                {grp.rows.map((r) => {
                  const inUse = !canPick(r);
                  const on = picked.has(r.finish_tag);
                  return (
                    <label key={r.finish_tag} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 14px 5px 26px", cursor: inUse ? "default" : "pointer", opacity: inUse ? 0.5 : 1 }}>
                      <input type="checkbox" checked={on && !inUse} disabled={inUse} onChange={() => toggle(r.finish_tag)} />
                      <span style={{ width: 12, height: 12, flex: "0 0 auto", background: colorByTag.get(r.finish_tag) || "var(--ink-faint)", border: "1px solid var(--ink-faint)" }} />
                      <span style={{ fontFamily: "var(--f-mono)", fontWeight: 600, minWidth: 58 }}>{r.finish_tag}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.description || <span style={{ color: "var(--ink-muted)" }}>—</span>}
                        {(r.manufacturer || r.size) && (
                          <span style={{ color: "var(--ink-muted)", fontSize: 11 }}>  ·  {[r.manufacturer, r.size].filter(Boolean).join(" · ")}</span>
                        )}
                      </span>
                      {inUse && <span style={{ ...lbl, opacity: 0.8 }}>in use</span>}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--ink-faint)" }}>
          <button onClick={onClose} style={{ padding: "7px 12px", border: "1px solid var(--ink-faint)", background: "transparent", color: "var(--ink)", cursor: "pointer", fontSize: 12 }}>Cancel</button>
          <button onClick={create} disabled={!count}
            style={{ padding: "8px 16px", border: "none", background: count ? "var(--ink)" : "var(--text-faint)", color: "var(--paper-bright)", cursor: count ? "pointer" : "default", fontWeight: 700, fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Create {count} condition{count === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
