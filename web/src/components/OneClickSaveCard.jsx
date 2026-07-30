// OneClickSaveCard — issue #194 scope 3: the persistent accept / save
// interface for One-Click. Today a click stages a proposal, the readout shows
// the number, ⏎ commits, and everything — the detected label, the confidence
// receipt — evaporates. This card is the interaction-design candidate being
// refined on /readout-demo.html: it stays visible after the click, shows
// measurement + detected label + confidence factors, lets the estimator
// rename before committing, and makes Save an explicit button (⏎ still works).
//
// Deliberate choices to grill on the demo page:
//  - The label input is prefilled with the drawing's own tag ("from plan"
//    marker clears the moment the estimator types — their word always wins,
//    same rule as origin.auto_named).
//  - Confidence factors are ALWAYS visible here, not folded behind a chip:
//    this card is the review gate, and the factors are exactly what needs
//    reviewing before Save. A clean trace says "nothing to flag" instead.
//  - Save is labeled with the condition it commits into — "Save to CPT-1" —
//    so the estimator never commits into the wrong condition unknowingly.
//  - Add-more gestures stay live while the card is up (click adds a space,
//    ⌥-click carves) — the card is a gate, not a modal.
import React, { useEffect, useState } from "react";
import { num } from "../lib/num.js";
import { areaVal, areaUnit, lenVal, lenUnit } from "../lib/units";

export default function OneClickSaveCard({
  units = "imperial",
  condTag,                    // condition this Save commits into
  sf, spaces = 1, cutouts = 0, perimLf,
  label = "",                 // detected room label (may be empty)
  autoLabel = false,          // true → label came from the plan's own tag
  confidence,                 // { score, factors } | undefined
  warnings = [],              // e.g. the raster-traced notice
  onSave,                     // (finalLabel) => void
  onDiscard,                  // () => void
  style,
}) {
  const [draft, setDraft] = useState(label);
  const [touched, setTouched] = useState(false);

  // ⏎ saves, esc discards — from anywhere while the card is up, not only with
  // the input focused. The card is a gate, not a modal: draw gestures stay
  // live, so the keys must too (the canvas's existing ⏎ Create contract).
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); onSave?.(draft.trim()); }
      else if (e.key === "Escape") { e.preventDefault(); onDiscard?.(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const pct = confidence ? Math.round(confidence.score * 100) : null;
  const factors = confidence?.factors || [];
  const secondary = [
    `${spaces} space${spaces === 1 ? "" : "s"}${cutouts ? ` − ${cutouts} cutout${cutouts === 1 ? "" : "s"}` : ""}`,
    units === "metric" ? null : `${num(sf / 9)} SY`,
    perimLf ? `${num(lenVal(perimLf, units))} ${lenUnit(units)} perim` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div style={{
      background: "var(--paper-bright)", border: "1px solid var(--ink)",
      borderRadius: 0, padding: "12px 14px", width: 264,
      boxShadow: "var(--shadow-2)", fontVariantNumeric: "tabular-nums",
      fontFamily: "var(--f-body)", ...style,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-muted)" }}>
          proposed takeoff
        </span>
        {pct != null && (
          <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 600, color: pct < 85 ? "var(--c-warning)" : "var(--ink)" }}
            title="Review prioritizer, not a probability — 1.0 means every signal came back clean, never 'verified'.">
            {pct}%
          </span>
        )}
      </div>

      <div style={{ fontFamily: "var(--f-mono)", fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.05, color: "var(--cobalt)" }}>
        {num(areaVal(sf, units))}
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", marginLeft: 5, color: "var(--ink-muted)", textTransform: "uppercase" }}>{areaUnit(units)}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", marginTop: 3 }}>{secondary}</div>

      {/* the label — the estimator's word, seeded by the drawing's */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9 }}>
        <input
          value={draft}
          placeholder="label this takeoff"
          onChange={(e) => { setDraft(e.target.value); setTouched(true); }}
          style={{
            flex: 1, minWidth: 0, padding: "5px 8px", border: "1px solid var(--ink-faint)",
            background: "var(--paper-cream)", color: "var(--ink)", fontSize: 12.5, fontWeight: 600,
            fontFamily: "var(--f-body)",
          }} />
        {autoLabel && !touched && draft === label && (
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)", flexShrink: 0 }}>from plan</span>
        )}
      </div>

      {/* the receipt — always unfolded here; this card IS the review gate */}
      <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--divider-soft)" }}>
        {factors.length ? factors.map((f, i) => (
          <div key={i} style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--ink-muted)", lineHeight: 1.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={f}>
            − {f}
          </div>
        )) : (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--ink-muted)", lineHeight: 1.6 }}>
            traced clean — nothing to flag
          </div>
        )}
        {warnings.map((w, i) => (
          <div key={i} style={{ fontSize: 10.5, color: "var(--c-warning)", marginTop: 4, lineHeight: 1.4 }}>{w}</div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <button className="btn-primary" style={{ padding: "7px 13px", fontSize: 10, whiteSpace: "nowrap" }}
          onClick={() => onSave?.(draft.trim())}>
          Save to {condTag || "condition"} <kbd style={{ fontFamily: "inherit", fontSize: 9, opacity: 0.7 }}>⏎</kbd>
        </button>
        <button className="btn-ghost" style={{ padding: "7px 11px", fontSize: 10, whiteSpace: "nowrap", border: "1px solid var(--ink-faint)" }}
          onClick={() => onDiscard?.()}>
          Discard <kbd style={{ fontFamily: "inherit", fontSize: 9, opacity: 0.7 }}>esc</kbd>
        </button>
      </div>
      <div style={{ fontSize: 9.5, color: "var(--ink-muted)", marginTop: 7, lineHeight: 1.5 }}>
        still live: click adds a space · ⌥-click carves a cutout · edits update this card
      </div>
    </div>
  );
}
