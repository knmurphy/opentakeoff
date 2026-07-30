// MeasureReadout — the live measurement readout as its own props-driven
// component (issue #194, scope 1+2). This is the REDESIGN being refined on the
// standalone demo page (/readout-demo.html) before it replaces the inline JSX
// in TakeoffCanvas.jsx (~7554). Until that wiring lands, the canvas still
// renders its own copy — keep behavior changes here, not there.
//
// Design contract (from #194):
//   Tier 1 — the measurement, dominant.
//   Tier 2 — ONE quiet secondary line (SY, LF perim, spaces, cutouts).
//   Tier 3 — interaction hints, demoted but never deleted.
// Plus the two surfaces the old readout never had: the detected room label and
// the confidence receipt (both already computed and persisted to provenance).
//
// Guardrail carried over verbatim from the canvas: the Detect branch never
// shows a "done" state, a green tick, or a total-SF figure — a detection pass
// never finishes a sheet, and a readout that looks like a completed one would
// be a lie the estimator prices work against.
//
// The `state` prop is a discriminated union — one object per tool posture:
//   { kind: "empty",    prompt }
//   { kind: "area",     sf, perimLf, deduct?, heightFt? }
//   { kind: "surface",  lf, heightFt }          // heightFt <= 0 → the danger prompt
//   { kind: "zone",     sf?, crossSheet? }
//   { kind: "oneclick", sf, spaces, cutouts, label?, autoLabel?, gripSelected?,
//                       confidence?: { score, factors }, rasterTraced? }
//   { kind: "detect",   running, done, total, found }            // running pass
//   { kind: "detect",   running: false, toReview, headline, accepted, limits } // report
//   { kind: "multi",    count, hasLabels?, onClear? }
// `totals` is the per-condition block under the divider; `meta` the footer.
import React, { useState } from "react";
import { num } from "../lib/num.js";
import { areaVal, areaUnit, lenVal, lenUnit, heightVal, heightUnit } from "../lib/units";

// ── shared bits ──────────────────────────────────────────────────────────────

const S = {
  box: {
    background: "var(--paper-bright)", border: "1px solid var(--ink-faint)",
    borderRadius: 0, padding: "10px 12px 8px", width: 236,
    boxShadow: "var(--shadow-1)", fontVariantNumeric: "tabular-nums",
    fontFamily: "var(--f-body)",
  },
  header: {
    fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 600,
    letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-muted)",
    display: "flex", alignItems: "baseline", gap: 6, marginBottom: 5,
    whiteSpace: "nowrap", overflow: "hidden",
  },
  tier2: { fontSize: 11.5, color: "var(--ink-secondary)", marginTop: 3, lineHeight: 1.4 },
  tier3: {
    fontSize: 10, color: "var(--ink-muted)", lineHeight: 1.55, marginTop: 7,
    paddingTop: 5, borderTop: "1px solid var(--divider-soft)",
  },
  warn: { fontSize: 10.5, color: "var(--c-warning)", marginTop: 5, lineHeight: 1.4 },
  danger: { fontSize: 12, color: "var(--c-danger)", lineHeight: 1.45 },
  divider: { height: 1, background: "var(--divider-soft)", margin: "8px 0 6px" },
};

// Tier 1: the number owns the box. Mono so digits land on the tabular grid the
// whole box declares; the unit rides small so "SF" never competes with "418".
function Big({ value, unit, color = "var(--ink)", prefix = "" }) {
  return (
    <div style={{ fontFamily: "var(--f-mono)", fontSize: 25, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.05, color }}>
      {prefix}{value}
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", marginLeft: 5, color: "var(--ink-muted)", textTransform: "uppercase" }}>{unit}</span>
    </div>
  );
}

// Tier 3: hints joined into one condensed run — present, legible, demoted.
function Hints({ lines }) {
  const text = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).join(" · ");
  return text ? <div style={S.tier3}>{text}</div> : null;
}

// The confidence receipt. The score is a review prioritizer, not a probability
// (confidence.ts) — so the chip reads "receipt", not "grade": muted at 1.0
// ("nothing to flag"), ink below it, warning color only under 0.85 where the
// engine itself says the estimator's eyes belong on an edge. Clicking unfolds
// the named factors — the same strings that persist to origin.confidence_factors.
export function ConfidenceChip({ confidence, expanded, onToggle }) {
  if (!confidence || typeof confidence.score !== "number") return null;
  const pct = Math.round(confidence.score * 100);
  const hasFactors = (confidence.factors || []).length > 0;
  const color = pct < 85 ? "var(--c-warning)" : pct < 100 ? "var(--ink)" : "var(--ink-muted)";
  return (
    <button
      type="button"
      onClick={hasFactors && onToggle ? onToggle : undefined}
      title={hasFactors ? confidence.factors.join("\n") : "Every signal came back clean — still a machine trace, review the edges."}
      style={{
        border: "none", background: "none", padding: 0, marginLeft: "auto",
        fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 600, color,
        cursor: hasFactors && onToggle ? "pointer" : "default", flexShrink: 0,
        borderBottom: hasFactors ? "1px dotted var(--ink-faint)" : "none", lineHeight: 1.3,
      }}>
      {pct}%{hasFactors ? (expanded ? " ▾" : " ▸") : ""}
    </button>
  );
}

export function ConfidenceFactors({ confidence }) {
  const factors = confidence?.factors || [];
  if (!factors.length) return null;
  return (
    <div style={{ marginTop: 4 }}>
      {factors.map((f, i) => (
        <div key={i} style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--ink-muted)", lineHeight: 1.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={f}>
          − {f}
        </div>
      ))}
    </div>
  );
}

// The detected room label — the drawing's own tag, surfaced instead of dying
// with the ⏎. The pip marks it machine-read. Provenance detail ("from plan")
// lives on the save card, the review surface — here it would crowd the name
// out of its own row (a 236px box truncated "PATIENT ROOM 139" to fit the tag).
function RoomLabel({ label, confidence, confExpanded, onConfToggle }) {
  if (!label && !confidence) return null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 5, minWidth: 0 }}>
      {label && (
        <>
          <span className="pip-sm" style={{ flexShrink: 0, alignSelf: "center" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={label}>{label}</span>
        </>
      )}
      <ConfidenceChip confidence={confidence} expanded={confExpanded} onToggle={onConfToggle} />
    </div>
  );
}

// ── the readout ──────────────────────────────────────────────────────────────

export default function MeasureReadout({ units = "imperial", header, state, totals, meta, style }) {
  const [confOpen, setConfOpen] = useState(false);
  const fa = (sf, d = 1) => `${num(areaVal(sf, units), d)} ${areaUnit(units)}`;
  const fl = (lf, d = 1) => `${num(lenVal(lf, units), d)} ${lenUnit(units)}`;
  const au = areaUnit(units);

  let body = null;
  const k = state?.kind;

  if (k === "detect" && state.running) {
    body = (
      <>
        <Big value={state.done} unit={`/ ${state.total} tags`} color="var(--cobalt)" />
        <div style={S.tier2}>{state.found} room{state.found === 1 ? "" : "s"} so far</div>
        <Hints lines={["one flood per tag — the canvas stays live", "Cancel keeps what it has found", "nothing is created until you accept"]} />
      </>
    );
  } else if (k === "detect") {
    body = (
      <>
        <Big value={state.toReview} unit="to review" color={state.toReview ? "var(--cobalt)" : "var(--ink-muted)"} />
        {state.headline && <div style={S.tier2}>{state.headline}</div>}
        {state.accepted > 0 && <div style={{ ...S.tier2, color: "var(--c-positive)" }}>{state.accepted} accepted into the takeoff.</div>}
        {(state.limits || []).map((l, i, arr) => (
          <div key={i} style={i === arr.length - 1 ? S.warn : { ...S.tier3, borderTop: "none", paddingTop: 0, marginTop: 5, fontSize: 10.5 }}>{l}</div>
        ))}
        <Hints lines={state.toReview
          ? ["✓ accepts a room · ✕ rejects it", "Accept all / Reject all in the toolbar", "esc discards the set"]
          : ["esc closes this", "One-Click each remaining room"]} />
      </>
    );
  } else if (k === "multi") {
    body = (
      <>
        <Big value={state.count} unit="selected" color="var(--cobalt)" />
        <Hints lines={["click toggles · drag lassoes", "⌫ deletes · condition chip reassigns" + (state.hasLabels ? " · Label menu re-labels" : ""), "esc clears"]} />
        {state.count > 0 && state.onClear && (
          <button onClick={state.onClear} style={{ marginTop: 6, padding: "3px 9px", border: "1px solid var(--ink-faint)", background: "transparent", cursor: "pointer", fontSize: 10.5, fontFamily: "var(--f-mono)" }}>
            clear (esc)
          </button>
        )}
      </>
    );
  } else if (k === "oneclick") {
    const secondary = [
      `${state.spaces} space${state.spaces === 1 ? "" : "s"}${state.cutouts ? ` − ${state.cutouts} cutout${state.cutouts === 1 ? "" : "s"}` : ""}`,
      units === "metric" ? null : `${num(state.sf / 9)} SY`,
    ].filter(Boolean).join(" · ");
    body = (
      <>
        <Big value={num(areaVal(state.sf, units))} unit={`${au} selected`} color="var(--cobalt)" />
        <RoomLabel label={state.label} confidence={state.confidence}
          confExpanded={confOpen} onConfToggle={() => setConfOpen((v) => !v)} />
        {confOpen && <ConfidenceFactors confidence={state.confidence} />}
        <div style={S.tier2}>{secondary}</div>
        {state.rasterTraced && <div style={S.warn}>Traced from scan pixels — verify edges before Create.</div>}
        <Hints lines={state.gripSelected
          ? ["drag moves the point · delete drops it · esc deselects", "⏎ create · ⌫ undo"]
          : ["hover a fill to edit — drag a corner or edge", "shift-click an edge adds a point", "click adds a space · ⌥-click carves a cutout", "⏎ create · ⌫ undo · esc cancel"]} />
      </>
    );
  } else if (k === "surface") {
    body = state.heightFt > 0 ? (
      <>
        <Big value={num(areaVal(state.lf * state.heightFt, units))} unit={`${au} wall`} />
        <div style={S.tier2}>{fl(state.lf)} × {num(heightVal(state.heightFt, units), 2)} {heightUnit(units)}</div>
      </>
    ) : (
      <div style={S.danger}>Set a height for {header || "this condition"} — H in the condition editor</div>
    );
  } else if (k === "zone") {
    body = state.crossSheet ? (
      <div style={S.danger}>Zone on one sheet — that point landed on a different sheet. Finish is disabled; esc or undo the last point to fix it.</div>
    ) : (
      <>
        {state.sf != null && <Big value={num(areaVal(state.sf, units))} unit={`${au} in zone`} color="var(--cobalt)" />}
        <Hints lines={["⏎, double-click, or Finish closes the zone and lists everything inside", "esc cancels"]} />
      </>
    );
  } else if (k === "area") {
    const secondary = units === "metric"
      ? `${fl(state.perimLf)} perim`
      : `${num(state.sf / 9)} SY · ${num(state.perimLf)} LF perim`;
    body = (
      <>
        <Big value={num(areaVal(state.sf, units))} unit={au}
          prefix={state.deduct ? "−" : ""} color={state.deduct ? "var(--c-danger)" : "var(--ink)"} />
        <div style={S.tier2}>{secondary}</div>
        {state.heightFt > 0 && (
          <Hints lines={[`@H ${num(heightVal(state.heightFt, units), 2)}${units === "metric" ? " m" : "′"}: ${fa(state.perimLf * state.heightFt)} vert${units === "metric" ? "" : ` · ${num((state.sf * state.heightFt) / 27)} CY`}`]} />
        )}
      </>
    );
  } else {
    body = <div style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.45 }}>{state?.prompt || "—"}</div>;
  }

  return (
    <div style={{ ...S.box, ...style }}>
      <div style={S.header}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{header || "no condition"}</span>
      </div>
      {body}
      {totals && (
        <>
          <div style={S.divider} />
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 8.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)" }}>
            {totals.tag || "—"} total ({totals.count || 0}{totals.mult > 1 ? ` ×${totals.mult}` : ""})
          </div>
          {(() => {
            const rows = [];
            const row = (key, val, unit, extra) => rows.push(
              <div key={key} style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: 600, marginTop: 2, color: "var(--ink)" }}>
                {val} <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", color: "var(--ink-muted)", textTransform: "uppercase" }}>{unit}</span>
                {extra && <span style={{ fontSize: 10.5, fontWeight: 500, color: "var(--ink-secondary)" }}> · {extra}</span>}
              </div>);
            if (totals.sf) row("sf", num(areaVal(totals.sf, units)), au, units === "imperial" ? `${num(totals.sf / 9)} SY` : null);
            if (totals.wallSf) row("wall", num(areaVal(totals.wallSf, units)), `${au} wall`);
            if (totals.borderSf) row("border", num(areaVal(totals.borderSf, units)), `${au} border`);
            if (totals.lf) row("lf", num(lenVal(totals.lf, units)), lenUnit(units));
            if (totals.ea) row("ea", num(totals.ea, 0), "EA");
            if (!rows.length) rows.push(<div key="none" style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 2 }}>—</div>);
            return rows;
          })()}
          {totals.vertSf > 0 && (
            <div style={{ fontSize: 10, color: "var(--ink-muted)", marginTop: 2 }} title="Display only — floor-area perimeters × this condition's height (not committed)">
              {fa(totals.vertSf)} vert (perim × H)
            </div>
          )}
        </>
      )}
      {meta && (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: "0.06em", opacity: 0.45, marginTop: 6 }}>
          {meta.shapes} shapes on {meta.sheets > 1 ? `${meta.sheets} sheets` : "sheet"} · zoom {meta.zoom}%
        </div>
      )}
    </div>
  );
}
