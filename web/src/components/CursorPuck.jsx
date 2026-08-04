// CursorPuck + CommitTray — the One-Click cursor puck, built to the
// evidence-reviewed design foundations (docs/design/PUCK_DESIGN_FOUNDATIONS.md).
// Being refined on /puck-demo.html before any canvas wiring.
//
// TWO surfaces, not one — and they anchor differently:
//
//   CursorPuck  — the PASSIVE, AMBIENT readout (T1): area/name/confidence
//                 riding the cursor, pointer-events off, mutates nothing.
//                 It follows the cursor because it is glanceable state, never
//                 a click target.
//   CommitTray  — the ACT-GATED action surface (T2): appears only as a side
//                 effect of a commit click, and is anchored TO THE ACT — the
//                 commit point — not to the live cursor. That anchoring is
//                 load-bearing twice over: it's property (a) of every
//                 confirmed precedent (the Mini Toolbar appears at the
//                 selection; Blender's HUD docks after the operator), and a
//                 tray that rode the cursor was literally unreachable — it
//                 fled the pointer that tried to click it (first lab session's
//                 finding). Auto-dismisses on move-on; host owns the off
//                 switch. Short chips, no radial (T5).
//
// The tray also carries Tier A's "control to correct" (§1.5): the room name
// auto-applies at high confidence, so the correction — an editable label —
// must live on the act-gated surface, one mouse-move from the click.
import React, { useState } from "react";
import { num } from "../lib/num.js";
import { areaVal, areaUnit } from "../lib/units";

const MONO = "var(--f-mono)";

const chipStyle = (accent) => ({
  padding: "4px 9px", cursor: "pointer", whiteSpace: "nowrap",
  fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.04em",
  border: `1px solid ${accent ? "var(--cobalt)" : "var(--ink-faint)"}`,
  background: accent ? "var(--tint-select)" : "var(--paper-bright)",
  color: accent ? "var(--cobalt)" : "var(--ink)",
});

// ── the follower: passive readout + latched-mode state ───────────────────────

export default function CursorPuck({
  units = "imperial",
  x, y,                      // cursor position, host-container px
  softened = false,          // T6: presentation-only fade while the cursor is moving fast
  suppressed = false,        // the commit tray is up — the readout yields to it fast
  hover,                     // null | { label, area_sf, confidence, committed } — the passive readout
  baseRun,                   // { latched, skipHeld, skipArmed } — latched-mode state, always shown when latched
}) {
  const latched = baseRun?.latched;
  const skip = baseRun?.skipHeld || baseRun?.skipArmed;
  if (!hover && !latched) return null;

  const conf = hover?.confidence;
  const pct = conf ? Math.round(conf.score * 100) : null;

  // While the tray is showing this commit, the readout is the same numbers
  // twice — fade it out fast and yield. The base-run tag is exempt: latched
  // mode state stays at the locus of attention no matter what else is up.
  const readoutOpacity = suppressed ? 0 : softened ? 0.45 : 1;

  return (
    <div style={{
      position: "absolute", left: x + 18, top: y + 20, zIndex: 9,
      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
      pointerEvents: "none",   // a passive surface can never eat the canvas's events
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
          opacity: readoutOpacity, transition: "opacity .12s var(--ease)",
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
    </div>
  );
}

// ── the act-anchored tray: name correction + offers + refine ─────────────────

export function CommitTray({
  x, y,                      // the COMMIT POINT, host-container px — the tray does not move
  label = "",                // the committed label (auto-applied name, or empty)
  autoApplied = false,       // true → label came from the plan's own tag
  onLabel,                   // (value) => void — Tier A's control to correct
  offers = [],               // [{ id, label, onTake }] — pre-computed, one act to take
  onRefine,                  // fn | null — the T3 window is open
  onDismiss,                 // fn — esc / explicit dismiss
}) {
  const [draft, setDraft] = useState(label);
  const [touched, setTouched] = useState(false);

  return (
    <div style={{
      position: "absolute", left: x + 12, top: y + 16, zIndex: 8,
      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
    }}>
      {/* the name — auto-applied (Tier A), corrected here; typing wins */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
        background: "var(--paper-bright)", border: "1px solid var(--ink-faint)", boxShadow: "var(--shadow-1)",
      }}>
        <span className="pip-sm" style={{ width: 4, height: 4, flexShrink: 0 }} />
        <input
          // untouched, the field mirrors the committed label (so a taken name
          // chip shows up here); the first keystroke switches to the draft
          value={touched ? draft : label}
          placeholder="name this room"
          onChange={(e) => { setDraft(e.target.value); setTouched(true); onLabel?.(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); }}
          style={{
            width: 148, padding: "2px 4px", border: "none", background: "transparent",
            color: "var(--ink)", fontSize: 11, fontWeight: 600, fontFamily: "var(--f-body)", outline: "none",
          }} />
        {autoApplied && !touched && (
          <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)", flexShrink: 0 }}>from plan</span>
        )}
      </div>

      {/* the offers — chips, one act each, zero to ignore */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 280 }}>
        {offers.map((o) => (
          <button key={o.id} onClick={o.onTake} style={chipStyle(true)}>+ {o.label}</button>
        ))}
        {onRefine && <button onClick={onRefine} style={chipStyle(false)}>↺ refine · r</button>}
        {onDismiss && (
          <button onClick={onDismiss}
            style={{ padding: "4px 7px", border: "none", background: "none", color: "var(--ink-muted)", fontFamily: MONO, fontSize: 9.5, cursor: "pointer" }}>
            esc
          </button>
        )}
      </div>
    </div>
  );
}
