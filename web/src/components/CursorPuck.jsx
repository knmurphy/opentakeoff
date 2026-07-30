// CursorPuck — the One-Click cursor puck, built to the evidence-reviewed
// design foundations (docs: puck design foundations, 2026-07-30). Being
// refined on /puck-demo.html before any canvas wiring.
//
// The ontology it implements, and the constraints each part carries:
//   Hover readout  — PASSIVE, AMBIENT (T1): displays area/name/confidence at
//                    the cursor; interacting with it can mutate nothing. Kept
//                    minimal — anti-ambient evidence exists for heavier UI.
//   Offer chips    — ACTION SURFACE, ACT-GATED (T2): appear only as a side
//                    effect of a commit click, never on hover/prediction.
//                    Required properties adopted as constraints: anchored to
//                    the act, auto-dismiss on move-on, first-class off switch
//                    (the host owns the switch; this component just renders
//                    what it's given).
//   Base-run tag   — LATCHED MODE state (T4): Raskin's "if unavoidable →
//                    maximally visible" clause. When the latch is on, the tag
//                    renders on the puck at the locus of attention, ALWAYS —
//                    not only in a toolbar. The quasimode skip (held key)
//                    state renders here too, for the same reason.
//   Refine chip    — T3's window: edit-right-after-accept, scoped to the last
//                    commit, dies at the next one. Not "refine anytime".
//   Softening      — T6: velocity/dwell may soften or reveal PRESENTATION
//                    only (opacity here); it never selects, commits, or takes
//                    an offer. No surface appears from inference alone.
//   Presentation   — short chips list (T5). No radial.
//
// Props are host-computed state; the puck renders and routes acts, nothing
// more. The demo page is the current host; TakeoffCanvas is the eventual one.
import React from "react";
import { num } from "../lib/num.js";
import { areaVal, areaUnit } from "../lib/units";

const MONO = "var(--f-mono)";

export default function CursorPuck({
  units = "imperial",
  x, y,                      // cursor position, host-container px
  softened = false,          // T6: presentation-only fade while the cursor is moving fast
  hover,                     // null | { label, area_sf, confidence, committed } — the passive readout
  baseRun,                   // { latched, skipHeld, skipArmed } — latched-mode state, always shown when latched
  offers = [],               // [{ id, label, onTake }] — act-gated; [] except right after a commit
  onRefine,                  // fn | null — the T3 window is open (last commit refinable)
  onDismiss,                 // fn — esc / explicit dismiss of the offer tray
}) {
  const latched = baseRun?.latched;
  const skip = baseRun?.skipHeld || baseRun?.skipArmed;
  const hasActions = offers.length > 0 || !!onRefine;
  if (!hover && !latched && !hasActions) return null;

  const conf = hover?.confidence;
  const pct = conf ? Math.round(conf.score * 100) : null;

  return (
    <div style={{
      position: "absolute", left: x + 18, top: y + 20, zIndex: 9,
      opacity: softened ? 0.45 : 1, transition: "opacity .15s var(--ease)",
      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
      // the passive part must never eat the canvas's events; the chips row
      // re-enables pointer events on itself only
      pointerEvents: "none",
    }}>
      {/* latched-mode state — Raskin visibility clause: on the puck, always */}
      {latched && (
        <div style={{
          fontFamily: MONO, fontSize: 8.5, fontWeight: 600, letterSpacing: "0.12em",
          textTransform: "uppercase", padding: "2px 7px",
          background: skip ? "var(--c-warning)" : "var(--cobalt)", color: "var(--accent-contrast)",
        }}>
          {skip ? "base run · skipping this room" : "base run · b ends"}
        </div>
      )}

      {/* passive readout — displays; commits nothing */}
      {hover && (
        <div style={{
          background: "var(--paper-bright)", border: "1px solid var(--ink-faint)",
          boxShadow: "var(--shadow-1)", padding: "5px 9px 6px",
          fontVariantNumeric: "tabular-nums", maxWidth: 240,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: hover.committed ? "var(--ink)" : "var(--cobalt)" }}>
              {num(areaVal(hover.area_sf, units))}
              <span style={{ fontSize: 9, fontWeight: 600, marginLeft: 3, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{areaUnit(units)}</span>
            </span>
            {pct != null && pct < 100 && (
              <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 9.5, fontWeight: 600, color: pct < 85 ? "var(--c-warning)" : "var(--ink-muted)" }}>{pct}%</span>
            )}
          </div>
          {(hover.label || hover.committed) && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
              {hover.label && <span className="pip-sm" style={{ width: 4, height: 4, flexShrink: 0 }} />}
              {hover.label && <span style={{ fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hover.label}</span>}
              {hover.committed && (
                <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--c-positive)", flexShrink: 0 }}>saved</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* act-gated offer tray — exists only in the wake of a commit click.
          Chips, not radial (T5). One act to take, zero to ignore. */}
      {hasActions && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 260, pointerEvents: "auto" }}>
          {offers.map((o) => (
            <button key={o.id} onClick={o.onTake}
              style={{
                padding: "4px 9px", border: "1px solid var(--cobalt)", background: "var(--tint-select)",
                color: "var(--cobalt)", fontFamily: MONO, fontSize: 9.5, fontWeight: 600,
                letterSpacing: "0.04em", cursor: "pointer", whiteSpace: "nowrap",
              }}>
              + {o.label}
            </button>
          ))}
          {onRefine && (
            <button onClick={onRefine}
              style={{
                padding: "4px 9px", border: "1px solid var(--ink-faint)", background: "var(--paper-bright)",
                color: "var(--ink)", fontFamily: MONO, fontSize: 9.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}>
              ↺ refine · r
            </button>
          )}
          {onDismiss && (
            <button onClick={onDismiss}
              style={{
                padding: "4px 7px", border: "none", background: "none", color: "var(--ink-muted)",
                fontFamily: MONO, fontSize: 9.5, cursor: "pointer",
              }}>
              esc
            </button>
          )}
        </div>
      )}
    </div>
  );
}
