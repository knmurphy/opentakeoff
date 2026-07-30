// Artifact bundle entry (NOT part of the app build — bundled by esbuild into
// the self-contained claude.ai artifact page). Renders both labs behind a
// house-style tab bar; each lab is the same component the repo pages mount.
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import ReadoutLab from "./src/demo/readoutLab.jsx";
import PuckLab from "./src/demo/puckLab.jsx";

function Shell() {
  const [tab, setTab] = useState("puck");
  const tabs = [
    ["puck", "puck lab", "hover · click commits · offers"],
    ["readout", "readout lab", "every tool state · save card"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="paper-cream" style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 14px", height: 44, flexShrink: 0, borderBottom: "1px solid var(--ink-faint)", color: "var(--ink)" }}>
        <span style={{ fontFamily: "var(--f-display)", fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
          open<span style={{ fontStyle: "italic", color: "var(--cobalt)" }}>takeoff</span>
        </span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)" }}>
          interaction lab · #194 + puck
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {tabs.map(([id, name, hint]) => (
            <button key={id} onClick={() => setTab(id)} title={hint}
              style={{
                padding: "6px 12px", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 600,
                letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
                border: `1px solid ${tab === id ? "var(--cobalt)" : "var(--ink-faint)"}`,
                background: tab === id ? "var(--tint-select)" : "transparent",
                color: tab === id ? "var(--cobalt)" : "var(--ink-muted)",
              }}>
              {name}
            </button>
          ))}
        </div>
      </div>
      {/* keyed remount on switch: each lab owns window key listeners scoped to
          its lifetime, and stale committed state across a hidden lab would
          read as a bug in a lab meant for feel */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === "puck" ? <PuckLab key="p" embedded /> : <ReadoutLab key="r" embedded />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Shell />);
