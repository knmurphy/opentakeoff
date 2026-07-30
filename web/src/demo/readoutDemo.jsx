// Standalone demo page for the #194 components — /readout-demo.html
//
// Renders MeasureReadout and OneClickSaveCard against a mock plan sheet with
// every tool state selectable, so the design and interaction can be refined
// WITHOUT touching TakeoffCanvas.jsx. Nothing here ships into the canvas; when
// the design settles, the canvas wires the same components with real state.
//
// Interactions that work here exactly as they should in the app:
//   ⏎ saves the staged One-Click proposal (toast + totals bump), esc discards,
//   the label input's "from plan" marker clears on edit, the confidence chip
//   unfolds its factors, and the theme/units toggles restyle everything live.
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../styles/app.css";
import MeasureReadout from "../components/MeasureReadout.jsx";
import OneClickSaveCard from "../components/OneClickSaveCard.jsx";
import { initTheme, getTheme, toggleTheme, onThemeChange } from "../lib/theme.js";
import { num } from "../lib/num.js";
import { areaVal, areaUnit } from "../lib/units";

initTheme();

// ── scenario data — mirrors the shapes the canvas computes ───────────────────

const CONF = {
  clean: { score: 1, factors: [] },
  sealed: { score: 0.88, factors: ["sealed-opening(12% synthetic boundary)"] },
  wedge: { score: 0.97, factors: ["door-swing-crossed(3.4% annexed swing)"] },
  raster: { score: 0.9, factors: ["raster-traced"] },
  low: {
    score: 0.61,
    factors: ["raster-traced", "hatch-filtered(override)", "sealed-opening(20% synthetic boundary)", "coarse-mask"],
  },
};

// One entry per readout posture. `overlay` keys the mock-plan drawing; `save`
// marks the One-Click states that stage a proposal for the save card.
const SCENARIOS = [
  { id: "empty-scale", group: "Empty", name: "No scale yet", header: "CPT-1", overlay: null,
    state: { kind: "empty", prompt: "Set scale first" } },
  { id: "empty-cond", group: "Empty", name: "No condition", header: null, overlay: null,
    state: { kind: "empty", prompt: "Pick a condition" } },
  { id: "empty-oneclick", group: "Empty", name: "One-Click prompt", header: "CPT-1", overlay: null,
    state: { kind: "empty", prompt: "Click inside a room — it selects itself" } },

  { id: "area", group: "Draw", name: "Area in progress", header: "CPT-1", overlay: "area",
    state: { kind: "area", sf: 161.6, perimLf: 52.4 } },
  { id: "area-h", group: "Draw", name: "Area + condition height", header: "CPT-1", overlay: "area",
    state: { kind: "area", sf: 161.6, perimLf: 52.4, heightFt: 9 } },
  { id: "deduct", group: "Draw", name: "Deduct", header: "CPT-1", overlay: "deduct",
    state: { kind: "area", sf: 9.3, perimLf: 12.2, deduct: true } },
  { id: "surface", group: "Draw", name: "Surface (wall run)", header: "WB-1", overlay: "surface",
    state: { kind: "surface", lf: 47.5, heightFt: 8 } },
  { id: "surface-noh", group: "Draw", name: "Surface — no height", header: "WB-1", overlay: "surface",
    state: { kind: "surface", lf: 47.5, heightFt: 0 } },
  { id: "zone", group: "Draw", name: "Zone check", header: "Zone check", overlay: "zone",
    state: { kind: "zone", sf: 1240.8 } },
  { id: "zone-cross", group: "Draw", name: "Zone — cross-sheet", header: "Zone check", overlay: "zone",
    state: { kind: "zone", crossSheet: true } },

  { id: "oc-clean", group: "One-Click", name: "Clean trace + label", header: "CPT-1", overlay: "oneclick", save: true,
    state: { kind: "oneclick", sf: 418.2, spaces: 1, cutouts: 0, label: "PATIENT ROOM 139", autoLabel: true, confidence: CONF.clean } },
  { id: "oc-wedge", group: "One-Click", name: "Door swing crossed", header: "CPT-1", overlay: "oneclick-wedge", save: true,
    state: { kind: "oneclick", sf: 424.5, spaces: 1, cutouts: 0, label: "PATIENT ROOM 139", autoLabel: true, confidence: CONF.wedge } },
  { id: "oc-sealed", group: "One-Click", name: "Sealed opening", header: "CPT-1", overlay: "oneclick", save: true,
    state: { kind: "oneclick", sf: 418.2, spaces: 1, cutouts: 0, label: "PATIENT ROOM 139", autoLabel: true, confidence: CONF.sealed } },
  { id: "oc-multi", group: "One-Click", name: "2 spaces − cutout", header: "CPT-1", overlay: "oneclick-multi", save: true,
    state: { kind: "oneclick", sf: 497.1, spaces: 2, cutouts: 1, label: "PATIENT ROOM 139", autoLabel: true, confidence: CONF.wedge } },
  { id: "oc-raster", group: "One-Click", name: "Raster (scan) trace", header: "CPT-1", overlay: "oneclick", save: true,
    state: { kind: "oneclick", sf: 411.9, spaces: 1, cutouts: 0, confidence: CONF.raster, rasterTraced: true } },
  { id: "oc-low", group: "One-Click", name: "Low confidence", header: "CPT-1", overlay: "oneclick", save: true,
    state: { kind: "oneclick", sf: 403.0, spaces: 1, cutouts: 0, label: "PATIENT ROOM 139", autoLabel: true, confidence: CONF.low, rasterTraced: true } },

  { id: "detect-run", group: "Detect", name: "Pass running", header: "Detect rooms", overlay: "detect",
    state: { kind: "detect", running: true, done: 12, total: 41, found: 8 } },
  { id: "detect-done", group: "Detect", name: "Report (never “done”)", header: "Detect rooms", overlay: "detect",
    state: { kind: "detect", running: false, toReview: 28, headline: "41 room tags → 28 traceable rooms.", accepted: 3,
      limits: ["9 tags gave fixture-sized traces (casework, not rooms) — skipped.", "4 rooms could not be traced — One-Click or Area those."] } },

  { id: "multi", group: "Select", name: "Multi-select", header: "Multi-select", overlay: "multi",
    state: { kind: "multi", count: 7, hasLabels: true } },
];

const BASE_TOTALS = { tag: "CPT-1", count: 11, mult: 1, sf: 2417.5, vertSf: 0 };

// ── mock plan sheet ──────────────────────────────────────────────────────────
// A plausible little finish plan: patient room with a drawn door swing and a
// column, hatched toilet, storage, corridor. Linework stays dark on the white
// sheet in BOTH themes (a PDF page doesn't theme; --well stays white too).

const INK = "#2a3346";
const COBALT = "#1f3fc7";
const DANGER = "#b03a26";

function Seed({ x, y }) {
  // the seed star — same dashed-cobalt "candidate" language the canvas uses
  return (
    <g stroke={COBALT} strokeWidth="1.6">
      <line x1={x - 7} y1={y} x2={x + 7} y2={y} />
      <line x1={x} y1={y - 7} x2={x} y2={y + 7} />
      <rect x={x - 2.6} y={y - 2.6} width="5.2" height="5.2" fill={COBALT} stroke="none" />
    </g>
  );
}

function MockPlan({ overlay }) {
  const roomRing = "66,86 434,86 434,294 434,374 66,374";              // room 139 interior
  const proposalFill = "rgba(31,63,199,.09)";
  const dash = { fill: proposalFill, stroke: COBALT, strokeWidth: 2, strokeDasharray: "5 4" };
  return (
    <svg viewBox="0 0 900 620" style={{ width: "100%", height: "100%", display: "block" }}>
      {/* sheet */}
      <rect x="20" y="20" width="860" height="580" fill="var(--well)" stroke={INK} strokeWidth="1" />
      <text x="852" y="590" textAnchor="end" fontFamily="var(--f-mono-draft)" fontSize="11" fill={INK} opacity="0.7">A-101 · FIRST FLOOR FINISH PLAN · ⅛″ = 1′-0″</text>

      {/* walls */}
      <g stroke={INK} strokeWidth="4" fill="none">
        <polyline points="60,380 60,80 440,80" />
        <polyline points="440,80 640,80 640,230 440,230" />
        <line x1="440" y1="80" x2="440" y2="120" />
        <line x1="440" y1="160" x2="440" y2="230" />     {/* door gap 120–160 into toilet */}
        <line x1="440" y1="230" x2="440" y2="294" />
        <line x1="440" y1="334" x2="440" y2="380" />     {/* door gap 294–334 to corridor */}
        <line x1="640" y1="80" x2="840" y2="80" />
        <line x1="840" y1="80" x2="840" y2="380" />
        <line x1="640" y1="230" x2="640" y2="380" />
        <line x1="60" y1="380" x2="440" y2="380" />
        <line x1="440" y1="380" x2="840" y2="380" />
        <line x1="60" y1="470" x2="840" y2="470" />      {/* corridor south wall */}
      </g>
      {/* drawn door: leaf + swing arc, corridor door of room 139 */}
      <g stroke={INK} strokeWidth="1.5" fill="none">
        <line x1="440" y1="334" x2="400" y2="334" />
        <path d="M 400 334 A 40 40 0 0 1 440 294" />
      </g>
      {/* toilet hatch */}
      <g stroke={INK} strokeWidth="0.8" opacity="0.55">
        {Array.from({ length: 14 }, (_, i) => {
          const o = 452 + i * 14;
          return <line key={i} x1={o} y1="228" x2={Math.min(o + 60, 638)} y2={Math.max(228 - 60, 82) + Math.max(0, o + 60 - 638)} />;
        })}
      </g>
      {/* column */}
      <rect x="242" y="222" width="16" height="16" fill={INK} opacity="0.85" />
      {/* room tags — stroke-text style */}
      <g fontFamily="var(--f-mono-draft)" fill={INK}>
        <text x="250" y="190" textAnchor="middle" fontSize="15">PATIENT ROOM</text>
        <text x="250" y="209" textAnchor="middle" fontSize="14">139</text>
        <text x="540" y="150" textAnchor="middle" fontSize="12">TOILET 139A</text>
        <text x="740" y="220" textAnchor="middle" fontSize="12">STOR. 141</text>
        <text x="450" y="432" fontSize="12">CORRIDOR C-1</text>
      </g>

      {/* ── per-scenario overlays ── */}
      {overlay?.startsWith("oneclick") && (
        <>
          <polygon points={roomRing} {...dash} />
          {overlay === "oneclick-wedge" && (
            <path d="M 400 334 A 40 40 0 0 1 440 294 L 440 334 Z" fill="rgba(31,63,199,.16)" stroke={COBALT} strokeWidth="1.4" strokeDasharray="3 3" />
          )}
          {overlay === "oneclick-multi" && (
            <>
              <polygon points="446,236 634,236 634,374 446,374" {...dash} />
              <rect x="234" y="214" width="32" height="32" fill="rgba(176,58,38,.10)" stroke={DANGER} strokeWidth="1.6" strokeDasharray="4 3" />
            </>
          )}
          <Seed x={250} y={260} />
        </>
      )}
      {overlay === "area" && (
        <g>
          <polyline points="66,86 434,86 434,374 250,374" fill="rgba(14,26,46,.05)" stroke={COBALT} strokeWidth="1.8" />
          <line x1="250" y1="374" x2="200" y2="300" stroke={COBALT} strokeWidth="1.4" strokeDasharray="4 3" />
          {[[66, 86], [434, 86], [434, 374], [250, 374]].map(([x, y], i) => (
            <rect key={i} x={x - 3.5} y={y - 3.5} width="7" height="7" fill={COBALT} />
          ))}
        </g>
      )}
      {overlay === "deduct" && (
        <rect x="230" y="210" width="40" height="40" fill="rgba(176,58,38,.12)" stroke={DANGER} strokeWidth="1.8" strokeDasharray="4 3" />
      )}
      {overlay === "surface" && (
        <g>
          <line x1="66" y1="374" x2="434" y2="374" stroke={COBALT} strokeWidth="5" opacity="0.85" />
          {[[66, 374], [434, 374]].map(([x, y], i) => (
            <rect key={i} x={x - 4} y={y - 4} width="8" height="8" fill={COBALT} />
          ))}
        </g>
      )}
      {overlay === "zone" && (
        <rect x="48" y="66" width="608" height="416" fill="rgba(31,63,199,.05)" stroke={COBALT} strokeWidth="2.2" strokeDasharray="9 6" />
      )}
      {overlay === "detect" && (
        <>
          <polygon points={roomRing} {...dash} />
          <polygon points="446,86 634,86 634,224 446,224" {...dash} />
          <polygon points="646,86 834,86 834,374 646,374" {...dash} />
          {[[434, 100], [634, 100], [834, 100]].map(([x, y], i) => (
            <g key={i} fontFamily="var(--f-mono)" fontSize="13">
              <rect x={x - 40} y={y - 13} width="36" height="18" fill="var(--well)" stroke={COBALT} strokeWidth="1" />
              <text x={x - 31} y={y + 1} fill="#1f6b4a">✓</text>
              <text x={x - 15} y={y + 1} fill={DANGER}>✕</text>
            </g>
          ))}
        </>
      )}
      {overlay === "multi" && (
        <g>
          <polygon points={roomRing} fill="rgba(31,63,199,.14)" stroke={COBALT} strokeWidth="2" />
          <polygon points="446,236 634,236 634,374 446,374" fill="rgba(31,63,199,.14)" stroke={COBALT} strokeWidth="2" />
          <rect x="40" y="60" width="640" height="430" fill="none" stroke={INK} strokeWidth="1.2" strokeDasharray="3 4" opacity="0.6" />
        </g>
      )}
    </svg>
  );
}

// ── controls ─────────────────────────────────────────────────────────────────

function Toggle({ label, value, options, onChange }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="field-label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 4 }}>
        {options.map(([v, name]) => (
          <button key={String(v)} onClick={() => onChange(v)}
            style={{
              flex: 1, padding: "5px 6px", fontSize: 10, fontFamily: "var(--f-mono)",
              letterSpacing: "0.06em", textTransform: "uppercase",
              border: `1px solid ${value === v ? "var(--cobalt)" : "var(--ink-faint)"}`,
              background: value === v ? "var(--tint-select)" : "transparent",
              color: value === v ? "var(--cobalt)" : "var(--ink-muted)", cursor: "pointer",
            }}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [scenarioId, setScenarioId] = useState("oc-clean");
  const [units, setUnits] = useState("imperial");
  const [theme, setTheme] = useState(getTheme());
  const [showTotals, setShowTotals] = useState(true);
  const [placement, setPlacement] = useState("docked");   // save card: docked | at-click
  const [dismissed, setDismissed] = useState(false);      // save card discarded for this scenario
  const [saved, setSaved] = useState([]);                 // committed takeoffs this session
  const [toast, setToast] = useState(null);

  useEffect(() => onThemeChange(setTheme), []);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
  const showSave = !!scenario.save && !dismissed;

  const totals = useMemo(() => {
    if (!showTotals) return null;
    const extraSf = saved.reduce((n, s) => n + s.sf, 0);
    return { ...BASE_TOTALS, sf: BASE_TOTALS.sf + extraSf, count: BASE_TOTALS.count + saved.length };
  }, [showTotals, saved]);

  function doSave(finalLabel) {
    const st = scenario.state;
    setSaved((prev) => [...prev, { sf: st.sf }]);
    setDismissed(true);
    setToast(`Saved to CPT-1 — ${num(areaVal(st.sf, units))} ${areaUnit(units)}${finalLabel ? ` · ${finalLabel}` : ""}`);
  }
  function doDiscard() { setDismissed(true); setToast("Discarded — nothing created."); }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function pick(id) { setScenarioId(id); setDismissed(false); }

  const groups = [...new Set(SCENARIOS.map((s) => s.group))];
  const st = scenario.state;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--paper-bright)", color: "var(--ink)" }}>
      {/* ── sidebar ── */}
      <div className="paper-cream" style={{ width: 248, flexShrink: 0, borderRight: "1px solid var(--ink-faint)", padding: "16px 14px", overflowY: "auto" }}>
        <div style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 2 }}>
          open<span style={{ fontStyle: "italic", color: "var(--cobalt)" }}>takeoff</span>
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 14 }}>
          readout lab · issue #194
        </div>

        {groups.map((g) => (
          <div key={g} style={{ marginBottom: 10 }}>
            <div className="field-label" style={{ marginBottom: 4 }}>{g}</div>
            {SCENARIOS.filter((s) => s.group === g).map((s) => (
              <button key={s.id} onClick={() => pick(s.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "5px 8px",
                  fontSize: 11.5, fontFamily: "var(--f-body)", marginBottom: 2,
                  border: `1px solid ${s.id === scenarioId ? "var(--cobalt)" : "transparent"}`,
                  background: s.id === scenarioId ? "var(--tint-select)" : "transparent",
                  color: s.id === scenarioId ? "var(--cobalt)" : "var(--ink)",
                  fontWeight: s.id === scenarioId ? 600 : 400, cursor: "pointer",
                }}>
                {s.name}
              </button>
            ))}
          </div>
        ))}

        <div style={{ height: 1, background: "var(--ink-faint)", opacity: 0.5, margin: "12px 0" }} />
        <Toggle label="Units" value={units} onChange={setUnits}
          options={[["imperial", "SF"], ["metric", "m²"]]} />
        <Toggle label="Theme" value={theme} onChange={() => toggleTheme()}
          options={[["light", "Light"], ["dark", "Dark"]]} />
        <Toggle label="Condition totals" value={showTotals} onChange={setShowTotals}
          options={[[true, "Shown"], [false, "Hidden"]]} />
        <Toggle label="Save card sits" value={placement} onChange={setPlacement}
          options={[["docked", "Docked"], ["at-click", "At click"]]} />

        {scenario.save && dismissed && (
          <button className="btn-ghost" style={{ width: "100%", justifyContent: "center", padding: "7px 10px", fontSize: 10 }}
            onClick={() => setDismissed(false)}>
            re-stage the click
          </button>
        )}

        <div style={{ fontSize: 10, color: "var(--ink-muted)", lineHeight: 1.6, marginTop: 14 }}>
          The proposal states stage a save card — <b>⏎</b> saves it, <b>esc</b> discards, and totals
          update. Components live in <span style={{ fontFamily: "var(--f-mono)", fontSize: 9 }}>src/components/</span>;
          the canvas is untouched until this design settles.
        </div>
      </div>

      {/* ── stage ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: theme === "dark" ? "#0b0e14" : "var(--paper-shadow)", padding: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: "min(100%, 980px)", aspectRatio: "900 / 620", boxShadow: "var(--shadow-2)" }}>
          {/* proposal overlays clear with the proposal — saved or discarded, the
              dashed "candidate" language must leave the sheet */}
          <MockPlan overlay={scenario.save && dismissed ? null : scenario.overlay} />

          {/* save card at the click point — rides the seed */}
          {showSave && placement === "at-click" && (
            <div style={{ position: "absolute", left: "31%", top: "46%" }}>
              <OneClickSaveCard key={scenarioId + units} units={units} condTag="CPT-1"
                sf={st.sf} spaces={st.spaces} cutouts={st.cutouts} perimLf={82.6}
                label={st.label || ""} autoLabel={!!st.autoLabel} confidence={st.confidence}
                warnings={st.rasterTraced ? ["Traced from scan pixels — verify edges before saving."] : []}
                onSave={doSave} onDiscard={doDiscard} />
            </div>
          )}
        </div>

        {/* the readout — top-right, same berth as the canvas gives it */}
        <div style={{ position: "absolute", right: 22, top: 22, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end", maxHeight: "calc(100% - 44px)" }}>
          <MeasureReadout units={units} header={scenario.header}
            state={showSave || !scenario.save ? st : { kind: "empty", prompt: "Click inside a room — it selects itself" }}
            totals={totals} meta={{ shapes: 11 + saved.length, sheets: 2, zoom: 100 }} />
          {showSave && placement === "docked" && (
            <OneClickSaveCard key={scenarioId + units} units={units} condTag="CPT-1"
              sf={st.sf} spaces={st.spaces} cutouts={st.cutouts} perimLf={82.6}
              label={st.label || ""} autoLabel={!!st.autoLabel} confidence={st.confidence}
              warnings={st.rasterTraced ? ["Traced from scan pixels — verify edges before saving."] : []}
              onSave={doSave} onDiscard={doDiscard} />
          )}
        </div>

        {toast && (
          <div style={{
            position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
            background: "var(--ink)", color: "var(--paper-cream)", padding: "9px 16px",
            fontFamily: "var(--f-mono)", fontSize: 11.5, boxShadow: "var(--shadow-2)",
          }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
