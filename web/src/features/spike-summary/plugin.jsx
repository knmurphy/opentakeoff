// SPIKE (throwaway) — issue #166 feasibility probe. NOT the real contract.
//
// Reference plugin, built ENTIRELY through the ctx façade — it imports nothing
// from the canvas, no core state, no store internals. It exercises: read
// accessors (conditions/shapes/units), per-plugin storage (a persisted note),
// and an export (download derived from ctx). It never owns the pointer, so it
// fits the v1 "panels/overlays/exports" scope. Proves a real feature can live
// outside core against the façade alone.

import React, { useEffect, useState } from "react";

function buildSummaryText(conditions, shapes, units) {
  const lines = [
    `OpenTakeoff summary (${units})`,
    `Conditions: ${conditions.length}`,
    `Shapes: ${shapes.length}`,
    "",
  ];
  for (const c of conditions) {
    const n = shapes.filter((s) => s.condition_id === c.id).length;
    lines.push(`${c.finish_tag || "(untagged)"}: ${n} shapes`);
  }
  return lines.join("\n");
}

function SummaryPanel({ ctx, onClose }) {
  const conditions = ctx.getConditions();
  const shapes = ctx.getShapes();
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  // Round-trips through per-plugin storage (device-local; see context.js).
  useEffect(() => {
    let live = true;
    ctx.storage.get("note").then((v) => { if (live && typeof v === "string") setNote(v); });
    return () => { live = false; };
  }, []);

  const byCond = conditions.map((c) => ({
    id: c.id,
    tag: c.finish_tag || "(untagged)",
    n: shapes.filter((s) => s.condition_id === c.id).length,
  }));

  return (
    <div style={{
      position: "absolute", left: 14, bottom: 60, zIndex: 45, width: 300,
      background: "var(--paper-bright)", border: "1px solid var(--ink)",
      boxShadow: "var(--shadow-2)", color: "var(--ink)", fontSize: 12.5,
    }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--ink-faint)" }}>
        <strong>Takeoff Summary <span style={{ color: "var(--cobalt)" }}>· plugin</span></strong>
        <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
      </header>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ color: "var(--ink-muted)" }}>Units: <strong style={{ color: "var(--ink)" }}>{ctx.units}</strong> · Conditions: <strong style={{ color: "var(--ink)" }}>{conditions.length}</strong> · Shapes: <strong style={{ color: "var(--ink)" }}>{shapes.length}</strong></div>
        {byCond.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 140, overflow: "auto" }}>
            {byCond.map((r) => <li key={r.id}>{r.tag}: {r.n} shapes</li>)}
          </ul>
        )}
        <textarea value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }}
          placeholder="Per-project note (persisted via plugin storage)…" rows={2}
          style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: 6, border: "1px solid var(--ink-faint)", resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={async () => { await ctx.storage.set("note", note); setSaved(true); }}
            style={{ padding: "5px 10px", border: "1px solid var(--ink)", background: "var(--ink)", color: "var(--paper-bright)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Save note</button>
          {saved && <span style={{ color: "var(--cobalt)", fontSize: 11.5 }}>saved (device-local)</span>}
          <button type="button" onClick={() => ctx.download("takeoff-summary.txt", buildSummaryText(conditions, shapes, ctx.units), "text/plain")}
            style={{ marginLeft: "auto", padding: "5px 10px", border: "1px solid var(--ink-faint)", background: "var(--paper-bright)", cursor: "pointer", fontSize: 12 }}>Download</button>
        </div>
      </div>
    </div>
  );
}

export default {
  id: "spike-summary",
  minCtxVersion: 1,
  title: "Takeoff Summary",
  overlays: [
    { id: "summary", label: "Summary", icon: "∑", render: (props) => <SummaryPanel {...props} /> },
  ],
  exports: [
    {
      id: "summary-txt",
      label: "Summary (TXT)",
      run: (ctx) => ({ filename: "takeoff-summary.txt", mime: "text/plain", text: buildSummaryText(ctx.getConditions(), ctx.getShapes(), ctx.units) }),
    },
  ],
};
