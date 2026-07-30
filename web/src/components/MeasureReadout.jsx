import { areaVal, areaUnit, lenVal, lenUnit } from "../lib/units";
import { openLen } from "../lib/geometry.js";
import { Icon } from "../brand/icons.jsx";

// The live measurement readout — the top-right overlay that reports the
// in-progress measurement for every draw tool (Area, Surface, Zone, One-Click,
// Detect, Multi-select) plus the active condition's running total.
//
// Extracted from TakeoffCanvas.jsx (#194) so the readout can be restyled and
// tested without editing the 6k-line canvas. Presentational only: it imports the
// pure formatters and takes every piece of data/handler it shows as a prop.
//
// Design: one compact data box with a strict hierarchy that reads the same in
// every tool — a dominant measurement, a quiet secondary line of derived
// figures, and interaction hints demoted below a hairline so the number never
// competes with the how-to text. Substantive notes (detection limits, scan-trace
// and scale warnings) are NOT hints — they keep their own weight and colour.
//
// The Detect-rooms branch is deliberately built to never show a "done" state or
// a total-SF figure — a detection pass never finishes a sheet, and a readout
// that looked like a completed one would be a lie the estimator prices work
// against. Preserve that when changing this component.

// Shared type scale — one place, so every tool's readout stays consistent.
const S = {
  label: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.55, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  primary: { fontSize: 21, fontWeight: 700, lineHeight: 1.15 },
  unit: { fontSize: 12.5, fontWeight: 600 },
  secondary: { fontSize: 12, color: "var(--ink-secondary)", marginTop: 3 },
  note: { fontSize: 11, marginTop: 4 },               // substantive, keeps weight/colour
  totalNum: { fontSize: 14.5, fontWeight: 700, marginTop: 2 },
  totalUnit: { fontSize: 11.5, fontWeight: 600 },
  foot: { fontSize: 10, opacity: 0.5, marginTop: 7 },
};

// Demoted interaction hints — smaller, muted, and set below a hairline so they
// read as a footnote to the measurement, never as data. `ruled={false}` for the
// empty-prompt state, where there's no measurement above to divide from.
function Hints({ children, ruled = true }) {
  return (
    <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.45, color: "var(--ink-muted)", ...(ruled ? { borderTop: "1px solid var(--divider-soft)", paddingTop: 5 } : {}) }}>
      {children}
    </div>
  );
}

export function MeasureReadout({
  detectShown, detect,
  tool, isMulti, multiSel, clearMulti, shapeLabels,
  aCond, activeCond, unitsPerPx, units,
  proposal, ocSel,
  poly, liveUpp, condH, liveArea, livePerim, zoneTraceCross,
  selShape, setShapeHeight, clearShapeHeight,
  condRow, condMult, condTotal, wallTotal, borderTotal, lfTotal, countTotal, vertTotal,
  visibleShapes, groupKeys, tf,
}) {
  // num is unit-agnostic; fa/fl close over `units` — same definitions the canvas uses.
  const num = (v, d = 1) => v.toLocaleString(undefined, { maximumFractionDigits: d });
  const fa = (sf, d = 1) => `${num(areaVal(sf, units), d)} ${areaUnit(units)}`;
  const fl = (lf, d = 1) => `${num(lenVal(lf, units), d)} ${lenUnit(units)}`;

  return (
    <div style={{ position: "absolute", right: 14, top: 14, background: "var(--paper-bright)", border: "1px solid var(--ink-faint)", borderRadius: 0, padding: "10px 13px", minWidth: 188, maxWidth: 244, maxHeight: "calc(50% - 110px)", overflowY: "auto", boxShadow: "0 3px 14px rgba(0,0,0,.10)", fontVariantNumeric: "tabular-nums", zIndex: 6 }}>
      <div style={S.label}>{detectShown ? "Detect rooms" : tool === "zone" ? "Zone check" : isMulti ? "Multi-select" : (aCond?.finish_tag || "No condition")}</div>
      {detectShown ? (
        <>
          {detect.running ? (
            <>
              <div style={{ ...S.primary, color: "var(--cobalt)" }}>{detect.done} <span style={S.unit}>/ {detect.total} room tags</span></div>
              <div style={S.secondary}>{detect.items.length} room{detect.items.length === 1 ? "" : "s"} so far</div>
              <Hints>One flood per tag — the canvas stays live. Cancel keeps what it has found; nothing is created until you accept.</Hints>
            </>
          ) : (
            <>
              <div style={{ ...S.primary, color: detect.items.length ? "var(--cobalt)" : "var(--ink-muted)" }}>{detect.items.length} <span style={S.unit}>to review</span></div>
              <div style={S.secondary}>{detect.report?.headline}</div>
              {detect.accepted > 0 && <div style={{ ...S.note, color: "var(--c-positive)" }}>{detect.accepted} accepted into the takeoff.</div>}
              {(detect.report?.limits || []).map((l, i, arr) => (
                <div key={i} style={{ ...S.note, color: i === arr.length - 1 ? "var(--c-warning)" : "var(--ink-muted)" }}>{l}</div>
              ))}
              <Hints>
                {detect.items.length ? "✓ on a room accepts it · ✕ rejects it · Accept all / Reject all in the toolbar · Esc discards the set" : "Esc or Dismiss closes this. One-Click each remaining room."}
              </Hints>
            </>
          )}
        </>
      ) : isMulti ? (
        <>
          <div style={{ ...S.primary, color: "var(--cobalt)" }}>{multiSel.size} <span style={S.unit}>selected</span></div>
          <Hints ruled={multiSel.size > 0}>
            click toggles · drag lassoes · ⌫ deletes · condition chip reassigns{shapeLabels.length ? " · Label menu re-labels" : ""} · Esc clears
          </Hints>
          {multiSel.size > 0 && (
            <button onClick={clearMulti} style={{ marginTop: 6, padding: "3px 9px", border: "1px solid var(--ink-faint)", background: "transparent", cursor: "pointer", fontSize: 11.5 }}>
              Clear selection (Esc)
            </button>
          )}
        </>
      ) : tool === "oneclick" && proposal?.regions.length ? (() => {
        const pos = proposal.regions.filter((r) => r.kind === "pos");
        const neg = proposal.regions.filter((r) => r.kind === "neg");
        const sf = pos.reduce((n, r) => n + r.area_sf, 0) - neg.reduce((n, r) => n + r.area_sf, 0);
        return (
          <>
            <div style={{ ...S.primary, color: "var(--cobalt)" }}>{num(areaVal(sf, units))} <span style={S.unit}>{areaUnit(units)} selected</span></div>
            <div style={S.secondary}>{pos.length} space{pos.length === 1 ? "" : "s"}{neg.length ? ` − ${neg.length} cutout${neg.length === 1 ? "" : "s"}` : ""}{units === "metric" ? "" : ` · ${num(sf / 9)} SY`}</div>
            {proposal.regions.some((r) => r.rt) && (
              <div style={{ ...S.note, color: "var(--c-warning)" }}>Traced from scan pixels — verify edges before Create.</div>
            )}
            <Hints>
              <div>{ocSel ? "drag to move · Delete drops this point · Esc deselects" : "hover a fill to edit: drag a corner or edge · shift-click an edge adds a point"}</div>
              <div style={{ marginTop: 2 }}>click adds a space · ⌥-click carves a cutout · ⏎ Create · ⌫ undo · Esc cancel</div>
            </Hints>
          </>
        );
      })() : tool === "surface" && poly.length >= 2 && liveUpp ? (
        (() => {
          const liveLF = openLen(poly) * liveUpp;
          return condH > 0 ? (
            <>
              <div style={{ ...S.primary, color: "var(--ink)" }}>{num(areaVal(liveLF * condH, units))} <span style={S.unit}>{areaUnit(units)} wall</span></div>
              <div style={S.secondary}>{fl(liveLF)} × {num(condH, 2)} ft</div>
            </>
          ) : <div style={{ fontSize: 12, color: "var(--c-danger)" }}>Set a height for {aCond?.finish_tag || "this condition"} — H in the condition editor</div>;
        })()
      ) : tool === "zone" && poly.length >= 1 ? (
        zoneTraceCross ? (
          <span style={{ color: "var(--c-danger)", fontSize: 12 }}>Zone on one sheet — that point landed on a different sheet. Finish is disabled; Esc or Undo last point to fix it.</span>
        ) : (
          <>
            {liveArea != null && poly.length >= 3 && <div style={{ ...S.primary, color: "var(--cobalt)" }}>{num(areaVal(liveArea, units))} <span style={S.unit}>{areaUnit(units)} in zone</span></div>}
            <Hints ruled={liveArea != null && poly.length >= 3}>⏎, double-click, or the Finish button closes the zone and lists everything inside · Esc cancels</Hints>
          </>
        )
      ) : liveArea != null && poly.length >= 3 ? (
        <>
          <div style={{ ...S.primary, color: tool === "deduct" ? "var(--c-danger)" : "var(--ink)" }}>{tool === "deduct" ? "−" : ""}{num(areaVal(liveArea, units))} <span style={S.unit}>{areaUnit(units)}</span></div>
          <div style={S.secondary}>{units === "metric" ? `${fl(livePerim)} perim` : `${num(liveArea / 9)} SY  ·  ${num(livePerim)} LF perim`}</div>
          {condH > 0 && <div style={{ ...S.note, color: "var(--ink-muted)" }}>@H {num(condH, 2)}′: {fa(livePerim * condH)} vert{units === "metric" ? "" : ` · ${num((liveArea * condH) / 27)} CY`}</div>}
        </>
      ) : (
        <Hints ruled={false}>{!unitsPerPx ? "Set scale first" : tool === "zone" ? "Trace a region (an apartment, a wing) — ⏎ closes it and lists every condition inside" : !activeCond ? "Pick a condition" : tool === "oneclick" ? "Click inside a room — it selects itself" : tool === "surface" ? "Trace the wall run" : "Click to trace an area"}</Hints>
      )}
      {selShape?.measure_role === "surface_area" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }} title="Height for THIS wall only — full-height tile here, 4-ft wainscot there, same condition. ↺ returns to the condition height.">
          <Icon name="height" size={12} />
          <span style={{ fontSize: 11, color: "var(--ink-muted)" }}>this wall</span>
          <input name="shape-height-ft" type="number" min="0" step="0.25" value={selShape.height_ft ?? ""}
            onChange={(e) => setShapeHeight(e.target.value)}
            style={{ width: 56, padding: "2px 5px", border: "1px solid var(--ink-faint)", fontSize: 12 }} />
          <span style={{ fontSize: 11, color: "var(--ink-muted)" }}>ft → {fa(selShape.computed?.area_sf || 0)}</span>
          {condH > 0 && Number(selShape.height_ft) !== condH && (
            <button onClick={clearShapeHeight} title="Set this wall to the condition height" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-muted)", padding: 0 }}>↺</button>
          )}
        </div>
      )}
      <div style={{ height: 1, background: "var(--divider-soft)", margin: "9px 0 7px" }} />
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.5 }}>{aCond?.finish_tag || "—"} total ({condRow?.shape_count || 0}{condMult > 1 ? ` ×${condMult}` : ""})</div>
      {condTotal !== 0 && <div style={S.totalNum}>{num(areaVal(condTotal, units))} <span style={S.totalUnit}>{areaUnit(units)}</span> {units === "imperial" && <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ink-secondary)" }}>· {num(condTotal / 9)} SY</span>}</div>}
      {wallTotal > 0 && <div style={S.totalNum}>{num(areaVal(wallTotal, units))} <span style={S.totalUnit}>{areaUnit(units)} wall</span></div>}
      {borderTotal > 0 && <div style={S.totalNum}>{num(areaVal(borderTotal, units))} <span style={S.totalUnit}>{areaUnit(units)} border</span></div>}
      {lfTotal > 0 && <div style={S.totalNum}>{num(lenVal(lfTotal, units))} <span style={S.totalUnit}>{lenUnit(units)}</span></div>}
      {countTotal > 0 && <div style={S.totalNum}>{num(countTotal, 0)} <span style={S.totalUnit}>EA</span></div>}
      {vertTotal > 0 && <div style={{ ...S.note, color: "var(--ink-muted)", marginTop: 2 }} title="Display only — floor-area perimeters × this condition's height (not committed)">{fa(vertTotal)} vert (perim × H)</div>}
      {condTotal === 0 && lfTotal === 0 && countTotal === 0 && wallTotal === 0 && borderTotal === 0 && <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 2 }}>—</div>}
      <div style={S.foot}>{visibleShapes.length} shapes on {groupKeys.length > 1 ? `${groupKeys.length} sheets` : "sheet"} · zoom {(tf.scale * 100).toFixed(0)}%</div>
    </div>
  );
}
