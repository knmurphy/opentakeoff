// Keyboard-shortcut config modal — lists every remappable command, captures a
// new chord on row click, persists overrides browser-globally, and surfaces
// conflicts inline. Closes on the live `escape` binding (not literal Esc).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Z } from "../lib/ui.js";
import {
  DEFAULT_KEYMAP,
  chordToKeys,
  findConflict,
  getOverrides,
  isKeymapLoaded,
  matches,
  normalizeEvent,
  resetAll,
  resetCommand,
  setOverride,
  subscribe,
} from "../lib/keymap.ts";
import { clearKeybindOverrides, saveKeybindOverrides } from "../lib/keybindStore.js";
import { useKeymap } from "../lib/useKeymap.js";

const CATEGORY_ORDER = ["Tools", "Navigation", "Edit", "Escape hatch"];

function Kbd({ children, danger = false }) {
  return (
    <kbd style={{
      fontFamily: "var(--f-mono)", fontSize: 11, padding: "2px 6px",
      border: `1px solid ${danger ? "var(--c-danger)" : "var(--ink-faint)"}`,
      borderBottomWidth: 2, borderRadius: 5, background: "var(--paper-bright)",
      color: danger ? "var(--c-danger)" : "var(--ink)", whiteSpace: "nowrap",
    }}>{children}</kbd>
  );
}

function Keycaps({ chords }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {chords.map((chord, ci) => (
        <span key={chord} style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
          {ci > 0 && (
            <span style={{ color: "var(--ink-muted)", fontFamily: "var(--f-mono)", fontSize: 11 }}>or</span>
          )}
          {chordToKeys(chord).map((k, i) => <Kbd key={i}>{k}</Kbd>)}
        </span>
      ))}
    </span>
  );
}

function defaultChords(id) {
  const def = DEFAULT_KEYMAP[id].default;
  return Array.isArray(def) ? def : [def];
}

function isOverridden(id, eff) {
  return JSON.stringify(eff[id]) !== JSON.stringify(defaultChords(id));
}

function chordIsCurrent(id, chord, eff) {
  return eff[id].includes(chord);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ShortcutConfig({ onClose }) {
  const eff = useKeymap();
  const [loaded, setLoaded] = useState(isKeymapLoaded());
  useEffect(() => {
    setLoaded(isKeymapLoaded());
    return subscribe(() => setLoaded(isKeymapLoaded()));
  }, []);
  const [search, setSearch] = useState("");
  const [capturing, setCapturing] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const q = search.trim().toLowerCase();

  const grouped = useMemo(() => {
    const ids = Object.keys(DEFAULT_KEYMAP).filter((id) => {
      if (!q) return true;
      return DEFAULT_KEYMAP[id].label.toLowerCase().includes(q);
    });
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      ids: ids.filter((id) => DEFAULT_KEYMAP[id].category === cat),
    })).filter((g) => g.ids.length > 0);
  }, [q]);

  const cancelCapture = useCallback(() => {
    setCapturing(null);
    setConflict(null);
  }, []);

  const handleClose = useCallback(() => {
    cancelCapture();
    onClose();
  }, [cancelCapture, onClose]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (capturing) return;
      if (!matches(e, "escape")) return;
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, handleClose]);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" || e.key === "Backspace") {
        cancelCapture();
        return;
      }
      const chord = normalizeEvent(e);
      if (!chord) return;
      if (chordIsCurrent(capturing, chord, eff)) {
        cancelCapture();
        return;
      }
      const hit = findConflict(chord, getOverrides(), capturing);
      if (hit) {
        setConflict({ chord, commandId: hit });
        return;
      }
      setOverride(capturing, chord);
      saveKeybindOverrides();
      cancelCapture();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, eff, cancelCapture]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKey);
    return () => panel.removeEventListener("keydown", onKey);
  }, []);

  const startCapture = (id) => {
    if (!loaded) return;
    setConflict(null);
    setCapturing(id);
  };

  const handleReset = (e, id) => {
    e.stopPropagation();
    cancelCapture();
    resetCommand(id);
    saveKeybindOverrides();
  };

  const handleRestoreAll = () => {
    cancelCapture();
    resetAll();
    clearKeybindOverrides();
  };

  const handleScrimClick = () => {
    cancelCapture();
    handleClose();
  };

  const handlePanelBlur = (e) => {
    if (!capturing) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (e.relatedTarget && panel.contains(e.relatedTarget)) return;
    cancelCapture();
  };

  return (
    <div
      onClick={handleScrimClick}
      style={{
        position: "fixed", inset: 0, zIndex: Z.modal, background: "var(--scrim)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 16px", overflow: "auto",
      }}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onBlur={handlePanelBlur}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        style={{
          width: "min(760px, 100%)", background: "var(--paper-bright)", color: "var(--ink)",
          border: "1px solid var(--ink-faint)", borderRadius: 0, padding: "22px 26px 26px",
          boxShadow: "var(--shadow-2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
          <h2 style={{ fontFamily: "var(--f-display)", fontSize: 17, letterSpacing: "-0.02em", margin: 0, fontWeight: 700 }}>
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            title="Close"
            style={{ background: "none", border: "none", color: "var(--ink-soft)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}
          >×</button>
        </div>

        <p style={{ fontSize: "var(--fs-s)", color: "var(--ink-soft)", lineHeight: 1.5, margin: "2px 0 0" }}>
          Click a binding, then press the key combination you want. Changes apply immediately and are saved to this browser.
        </p>

        {!loaded && (
          <p style={{ fontFamily: "var(--f-mono)", fontSize: "var(--fs-xs)", color: "var(--ink-muted)", margin: "10px 0 0" }}>
            loading…
          </p>
        )}

        <input
          ref={searchRef}
          className="search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={cancelCapture}
          placeholder="Filter commands…"
          aria-label="Filter commands"
          style={{
            margin: "14px 0 4px", width: "100%", padding: "6px 10px",
            border: "1px solid var(--ink-faint)", borderRadius: 0,
            fontFamily: "var(--f-mono)", fontSize: "var(--fs-s)",
            color: "var(--ink)", background: "var(--paper-bright)",
          }}
        />

        <div style={{ maxHeight: "56vh", overflow: "auto", marginTop: 14 }}>
          {grouped.map(({ category, ids }, gi) => (
            <div key={category}>
              <div style={{
                margin: gi === 0 ? "0 0 6px" : "16px 0 6px",
                fontFamily: "var(--f-mono)", fontWeight: 500,
                letterSpacing: ".12em", textTransform: "uppercase", fontSize: 10,
                color: "var(--ink-muted)",
                paddingTop: gi === 0 ? 0 : 10,
                borderTop: gi === 0 ? "none" : "1px solid var(--ink-faint)",
              }}>
                {category}
              </div>
              {ids.map((id) => {
                const def = DEFAULT_KEYMAP[id];
                const active = capturing === id;
                const overridden = isOverridden(id, eff);
                return (
                  <div
                    key={id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      width: "100%", padding: "8px 10px", borderRadius: 0,
                      border: active ? "1px solid var(--cobalt)" : "1px solid transparent",
                      background: active ? "var(--tint-select)" : "transparent",
                      opacity: loaded ? 1 : 0.55,
                    }}
                    onMouseEnter={(e) => { if (!active && loaded) e.currentTarget.style.background = "var(--tint-08)"; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? "var(--tint-select)" : "transparent"; }}
                  >
                    <button
                      type="button"
                      disabled={!loaded}
                      onClick={() => startCapture(id)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 16, flex: 1, minWidth: 0, padding: 0,
                        border: "none", background: "transparent",
                        cursor: loaded ? "pointer" : "default", textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: "var(--fs-m)", color: "var(--ink-soft)" }}>
                        {def.label}
                        {id === "curveFlip" && (
                          <span style={{ fontFamily: "var(--f-mono)", fontSize: "var(--fs-2xs)", color: "var(--ink-muted)", marginLeft: 8 }}>
                            mid-trace
                          </span>
                        )}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        {active ? (
                          <>
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 8,
                              fontFamily: "var(--f-mono)", fontSize: "var(--fs-s)", color: "var(--cobalt)",
                              border: "1px dashed var(--cobalt)", borderRadius: "var(--r-1)", padding: "4px 10px",
                            }}>
                              Press keys…
                              <span style={{
                                display: "inline-block", width: 7, height: 14, background: "var(--cobalt)",
                                animation: reduceMotion ? "none" : "shortcut-caret-blink 1s steps(1) infinite",
                              }} />
                            </span>
                            <span style={{ fontFamily: "var(--f-mono)", fontSize: "var(--fs-2xs)", color: "var(--ink-muted)" }}>
                              Esc to cancel
                            </span>
                          </>
                        ) : (
                          <Keycaps chords={eff[id]} />
                        )}
                      </span>
                    </button>
                    {overridden && !active && (
                      <button
                        type="button"
                        className="reset"
                        disabled={!loaded}
                        onClick={(e) => handleReset(e, id)}
                        style={{
                          fontFamily: "var(--f-mono)", fontSize: "var(--fs-2xs)", color: "var(--cobalt)",
                          background: "none", border: "none", cursor: loaded ? "pointer" : "default",
                          padding: "2px 4px", opacity: 0.85, flexShrink: 0,
                        }}
                      >reset</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {conflict && (
          <div style={{
            marginTop: 8, padding: "8px 12px", borderLeft: "3px solid var(--c-danger)",
            background: "rgba(176, 58, 38, .06)", fontSize: "var(--fs-s)", color: "var(--ink-soft)",
            display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap",
          }}>
            <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
              {chordToKeys(conflict.chord).map((k, i) => <Kbd key={i} danger>{k}</Kbd>)}
              <span> is already bound to</span>
            </span>
            <span style={{ fontWeight: 600, color: "var(--c-danger)" }}>
              {DEFAULT_KEYMAP[conflict.commandId].label}
            </span>
            <span>— press a different key, or Esc to cancel.</span>
          </div>
        )}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--ink-faint)",
          fontSize: "var(--fs-s)", color: "var(--ink-soft)",
        }}>
          <button
            type="button"
            onClick={handleRestoreAll}
            style={{
              fontFamily: "var(--f-mono)", fontSize: "var(--fs-xs)", padding: "6px 12px",
              border: "1px solid var(--ink-faint)", background: "transparent", color: "var(--ink-soft)",
              borderRadius: 0, cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-danger)"; e.currentTarget.style.color = "var(--c-danger)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--ink-faint)"; e.currentTarget.style.color = "var(--ink-soft)"; }}
          >
            Restore all defaults
          </button>
          <span style={{ fontSize: "var(--fs-s)", color: "var(--ink-muted)", lineHeight: 1.45, maxWidth: "60%", textAlign: "right" }}>
            Fixed keys — Space (pan), hold&nbsp;M (dictation), hold&nbsp;⇧ (angle lock), ⌥/⇧‑click, and 1–9 (condition palette) — aren&apos;t listed here.
          </span>
        </div>
      </div>

      <style>{`
        @keyframes shortcut-caret-blink { 50% { opacity: 0; } }
        .search:focus {
          outline: none;
          border-color: var(--cobalt);
          box-shadow: 0 0 0 3px rgba(31, 63, 199, .18);
        }
      `}</style>
    </div>
  );
}
