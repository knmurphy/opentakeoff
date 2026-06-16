// ToolMenu — brand dropdown for the takeoff toolbar (and tab overflow).
// STACK-style state+switcher: the trigger face can show the currently armed
// tool while the panel switches it. Square corners, paper/ink/cobalt tokens.
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../brand/icons.jsx";

const MENU_W = 232;

export default function ToolMenu({ face, active = false, accent = "cobalt", title = "", items, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  const accentColor = accent === "danger" ? "var(--c-danger)" : "var(--cobalt)";
  const toggle = () => {
    if (!open && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      setFlip(r.left + MENU_W > window.innerWidth - 16);
    }
    setOpen((v) => !v);
  };

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" onClick={toggle} title={title}
        style={{
          display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 10px", cursor: "pointer",
          border: `1px solid ${active ? accentColor : "var(--ink-faint)"}`,
          background: active ? accentColor : (open ? "var(--paper-shadow)" : "transparent"),
          color: active ? "var(--paper-bright)" : "var(--ink)",
          fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 600, lineHeight: 1,
        }}>
        {face}
        <span style={{ display: "inline-flex", opacity: 0.7 }}><Icon name="chevronDown" size={11} /></span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", [flip ? "right" : "left"]: 0, zIndex: 60,
          minWidth: MENU_W, background: "var(--paper-bright)", border: "1px solid var(--ink)",
          boxShadow: "var(--shadow-2)", padding: "4px 0",
        }}>
          {items.map((it, i) => {
            if (it === "divider") return <div key={i} style={{ height: 1, background: "var(--ink-faint)", margin: "4px 0" }} />;
            if (it.section) return (
              <div key={i} style={{ padding: "6px 12px 3px", fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-muted)" }}>{it.section}</div>
            );
            const dis = !!it.disabled;
            return (
              <button key={it.id || i} type="button" disabled={dis}
                onClick={() => { if (!dis) { setOpen(false); it.onSelect?.(); } }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 12px",
                  border: "none", textAlign: "left", cursor: dis ? "default" : "pointer",
                  background: it.active ? "var(--paper-cream)" : "transparent",
                  borderLeft: it.active ? "2px solid var(--cobalt)" : "2px solid transparent",
                  opacity: dis ? 0.38 : 1, color: "var(--ink)",
                }}
                onMouseEnter={(e) => { if (!dis && !it.active) e.currentTarget.style.background = "var(--paper-shadow)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = it.active ? "var(--paper-cream)" : "transparent"; }}>
                {it.icon && <span style={{ display: "inline-flex", width: 17, justifyContent: "center", color: it.tint || "var(--ink)" }}><Icon name={it.icon} size={16} /></span>}
                <span style={{ flex: 1, fontFamily: "var(--f-body)", fontSize: 13, fontWeight: it.active ? 600 : 400 }}>{it.label}</span>
                {it.shortcut && <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--ink-muted)" }}>{it.shortcut}</span>}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
