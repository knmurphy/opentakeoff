// Puck lab — /puck-demo.html
//
// Interactive playground for CursorPuck, wired exactly to the evidence-reviewed
// foundations doc (§4 "The puck, restated in the ontology"):
//   hover        → passive ambient readout at the cursor (T1)
//   click        → the commit — the work, and the act that gates offers
//   on commit    → Tier A name auto-applies IF confidence ≥ gate, else demoted
//                  to an offer; Tier B quantities (wall base, transitions)
//                  NEVER auto-apply — they appear as act-gated chips,
//                  pre-computed, one act to take, auto-dismissed on move-on,
//                  behind a first-class off switch (T2)
//   refine       → immediately post-commit, scoped to the LAST commit, dies at
//                  the next one; r reopens it inside the window (T3)
//   base run     → latched mode (b), state always rendered on the puck (T4);
//                  per-room skip is a held-⇧ quasimode with an s toggle
//                  fallback for users who can't sustain holds
//   presentation → chips, not radial (T5); velocity only softens opacity —
//                  inference never selects, commits, or takes anything (T6)
//
// Hover a room. Click it. Take or ignore the chips. b starts a base run.
import React, { useEffect, useMemo, useRef, useState } from "react";
import "../styles/tokens.css";
import "../styles/app.css";
import CursorPuck, { CommitTray } from "../components/CursorPuck.jsx";
import MeasureReadout from "../components/MeasureReadout.jsx";
import { getTheme, toggleTheme, onThemeChange } from "../lib/theme.js";
import { num } from "../lib/num.js";
import { areaVal, areaUnit, lenVal, lenUnit } from "../lib/units";

const CONF_NAME_GATE = 0.85;   // Tier A demotion threshold (ours, §1.5)

// The mock sheet's rooms — ring in plan coords, quantities pre-computed the way
// the engine would have them at offer time (offers are pre-computed, T2).
const ROOMS = [
  { id: "pr139", name: "PATIENT ROOM 139", ring: [[66, 86], [434, 86], [434, 374], [66, 374]],
    area: 418.2, baseLf: 76.2, conf: { score: 1, factors: [] },
    transitions: [{ id: "tr-corr", label: "transition @ corridor door", lf: 3.33 }] },
  { id: "toilet", name: "TOILET 139A", ring: [[446, 86], [634, 86], [634, 224], [446, 224]],
    area: 97.3, baseLf: 36.8, conf: { score: 0.88, factors: ["sealed-opening(12% synthetic boundary)"] },
    transitions: [{ id: "tr-139", label: "transition @ door", lf: 2.67 }] },
  { id: "stor", name: "STOR. 141", ring: [[646, 86], [834, 86], [834, 374], [646, 374]],
    area: 186.0, baseLf: 54.0, conf: { score: 0.61, factors: ["raster-traced", "coarse-mask"] },
    transitions: [] },
  { id: "corr", name: "CORRIDOR C-1", ring: [[66, 386], [834, 386], [834, 464], [66, 464]],
    area: 340.5, baseLf: 171.2, conf: { score: 0.97, factors: ["door-swing-crossed(1.1% annexed swing)"] },
    transitions: [{ id: "tr-2", label: "transitions @ 2 doors", lf: 6.67 }] },
];
const roomById = (id) => ROOMS.find((r) => r.id === id);
const centroid = (ring) => ring.reduce(([X, Y], [x, y]) => [X + x / ring.length, Y + y / ring.length], [0, 0]);

const INK = "#2a3346";
const COBALT = "#1f3fc7";

function PlanSheet({ committed, hoverId, units, onEnter, onLeave, onCommit }) {
  return (
    <svg viewBox="0 0 900 620" style={{ width: "100%", height: "100%", display: "block" }}>
      <rect x="20" y="20" width="860" height="580" fill="var(--well)" stroke={INK} strokeWidth="1" />
      <text x="852" y="590" textAnchor="end" fontFamily="var(--f-mono-draft)" fontSize="11" fill={INK} opacity="0.7">A-101 · FIRST FLOOR FINISH PLAN · ⅛″ = 1′-0″</text>
      <g stroke={INK} strokeWidth="4" fill="none">
        <polyline points="60,380 60,80 440,80" />
        <polyline points="440,80 640,80 640,230 440,230" />
        <line x1="440" y1="80" x2="440" y2="120" />
        <line x1="440" y1="160" x2="440" y2="230" />
        <line x1="440" y1="230" x2="440" y2="294" />
        <line x1="440" y1="334" x2="440" y2="380" />
        <line x1="640" y1="80" x2="840" y2="80" />
        <line x1="840" y1="80" x2="840" y2="380" />
        <line x1="640" y1="230" x2="640" y2="380" />
        <line x1="60" y1="380" x2="440" y2="380" />
        <line x1="440" y1="380" x2="840" y2="380" />
        <line x1="60" y1="470" x2="840" y2="470" />
      </g>
      <g stroke={INK} strokeWidth="1.5" fill="none">
        <line x1="440" y1="334" x2="400" y2="334" />
        <path d="M 400 334 A 40 40 0 0 1 440 294" />
      </g>
      <g stroke={INK} strokeWidth="0.8" opacity="0.55">
        {Array.from({ length: 14 }, (_, i) => {
          const o = 452 + i * 14;
          return <line key={i} x1={o} y1="228" x2={Math.min(o + 60, 638)} y2={Math.max(228 - 60, 82) + Math.max(0, o + 60 - 638)} />;
        })}
      </g>
      <rect x="242" y="222" width="16" height="16" fill={INK} opacity="0.85" />
      <g fontFamily="var(--f-mono-draft)" fill={INK}>
        <text x="250" y="190" textAnchor="middle" fontSize="15">PATIENT ROOM</text>
        <text x="250" y="209" textAnchor="middle" fontSize="14">139</text>
        <text x="540" y="140" textAnchor="middle" fontSize="12">TOILET 139A</text>
        <text x="740" y="200" textAnchor="middle" fontSize="12">STOR. 141</text>
        <text x="450" y="432" fontSize="12">CORRIDOR C-1</text>
      </g>

      {/* committed shapes — the work that has landed */}
      {Object.entries(committed).map(([id, c]) => {
        const room = roomById(id);
        const [cx, cy] = centroid(room.ring);
        return (
          <g key={id}>
            <polygon points={room.ring.map((p) => p.join(",")).join(" ")}
              fill="rgba(31,63,199,.10)" stroke={COBALT} strokeWidth="2" />
            <text x={cx} y={cy + 42} textAnchor="middle" fontFamily="var(--f-mono)" fontSize="12" fontWeight="600" fill={COBALT}>
              {num(areaVal(c.area, units))} {areaUnit(units)}
            </text>
            {(c.baseLf || c.transitionLf) && (
              <text x={cx} y={cy + 58} textAnchor="middle" fontFamily="var(--f-mono)" fontSize="10" fill={COBALT} opacity="0.8">
                {[c.baseLf ? `base ${num(lenVal(c.baseLf, units))} ${lenUnit(units)}` : null,
                  c.transitionLf ? `tr ${num(lenVal(c.transitionLf, units))} ${lenUnit(units)}` : null,
                ].filter(Boolean).join(" · ")}
              </text>
            )}
          </g>
        );
      })}

      {/* hover preview — the app's dashed "candidate" language */}
      {hoverId && !committed[hoverId] && (
        <polygon points={roomById(hoverId).ring.map((p) => p.join(",")).join(" ")}
          fill="rgba(31,63,199,.07)" stroke={COBALT} strokeWidth="1.6" strokeDasharray="4 3.5" pointerEvents="none" />
      )}

      {/* hit targets — transparent, on top */}
      {ROOMS.map((room) => (
        <polygon key={room.id} points={room.ring.map((p) => p.join(",")).join(" ")}
          fill="transparent" style={{ cursor: "crosshair" }}
          onMouseEnter={() => onEnter(room.id)} onMouseLeave={() => onLeave(room.id)}
          onClick={(e) => onCommit(room, e)} />
      ))}
    </svg>
  );
}

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

// `embedded` — rendered inside a host shell (the artifact bundle's tab
// switcher) rather than as its own page: fill the container, no page links.
export default function App({ embedded = false }) {
  const [units, setUnits] = useState("imperial");
  const [theme, setTheme] = useState(getTheme());
  const [offersOn, setOffersOn] = useState(true);       // the T2 off switch — first-class
  const [softenOn, setSoftenOn] = useState(true);       // the T6 presentation adaptation
  const [committed, setCommitted] = useState({});       // roomId → { area, area0, label, baseLf, transitionLf, sens }
  const [hoverId, setHoverId] = useState(null);
  const [cursor, setCursor] = useState({ x: -999, y: -999 });
  const [softened, setSoftened] = useState(false);
  const [baseLatched, setBaseLatched] = useState(false);
  const [skipHeld, setSkipHeld] = useState(false);      // quasimode: held ⇧
  const [skipArmed, setSkipArmed] = useState(false);    // toggle fallback: s
  const [tray, setTray] = useState(null);               // { roomId, x, y, list: [{id, kind, lf?, name?}] } — anchored to the commit point
  const [lastCommit, setLastCommit] = useState(null);   // T3 window target
  const [refineOpen, setRefineOpen] = useState(false);
  const [log, setLog] = useState([]);
  const stageRef = useRef(null);
  const velRef = useRef({ x: 0, y: 0, t: 0, timer: null });

  useEffect(() => onThemeChange(setTheme), []);
  const say = (line) => setLog((prev) => [line, ...prev].slice(0, 10));

  // ── acts ──────────────────────────────────────────────────────────────────

  function commit(room, e) {
    if (committed[room.id]) { say(`${room.name}: already measured — r refines the last commit`); return; }
    const skip = skipHeld || skipArmed;
    const named = !!room.name && room.conf.score >= CONF_NAME_GATE;   // Tier A confidence gate
    const mintBase = baseLatched && !skip;                            // latched mode: user opted in run-wide
    setCommitted((prev) => ({
      ...prev,
      [room.id]: { area: room.area, area0: room.area, label: named ? room.name : "", autoNamed: named, baseLf: mintBase ? room.baseLf : 0, transitionLf: 0, sens: 0.5 },
    }));
    setSkipArmed(false);                                              // the toggle fallback is one-shot
    const list = [];
    if (!mintBase && room.baseLf) list.push({ id: "base", kind: "base", lf: room.baseLf });
    for (const t of room.transitions) list.push({ id: t.id, kind: "transition", lf: t.lf, name: t.label });
    if (!named && room.name) list.push({ id: "name", kind: "name", name: room.name });  // Tier A, demoted
    // The tray anchors to the ACT — the commit point — so the estimator can
    // mouse over to it (a cursor-riding tray fled the pointer; lab finding).
    // T2: the off switch silences the whole act-gated surface.
    if (offersOn) {
      const rect = stageRef.current.getBoundingClientRect();
      setTray({ roomId: room.id, x: e.clientX - rect.left, y: e.clientY - rect.top, list });
    }
    setLastCommit(room.id);                                           // opens the T3 window…
    setRefineOpen(false);                                             // …and closes the previous one
    say(`commit ${room.name} — ${num(room.area)} SF${named ? ` · named from plan` : ""}${mintBase ? ` · base ${num(room.baseLf)} LF (run)` : skip && baseLatched ? " · base skipped" : ""}`);
  }

  function takeOffer(o) {
    const room = roomById(tray.roomId);
    setCommitted((prev) => {
      const c = { ...prev[tray.roomId] };
      if (o.kind === "base") c.baseLf = o.lf;
      if (o.kind === "transition") c.transitionLf += o.lf;
      if (o.kind === "name") { c.label = o.name; c.autoNamed = true; }
      return { ...prev, [tray.roomId]: c };
    });
    setTray((prev) => ({ ...prev, list: prev.list.filter((x) => x.id !== o.id) }));
    say(`take ${o.kind === "name" ? `name “${o.name}”` : `${o.name || "wall base"} ${num(o.lf)} LF`} → ${room.name}`);
  }

  // Tier A's control to correct — typing in the tray's name field wins over
  // the auto-applied tag, exactly the origin.auto_named rule.
  function setLabel(value) {
    setCommitted((prev) => ({
      ...prev,
      [tray.roomId]: { ...prev[tray.roomId], label: value, autoNamed: false },
    }));
    setTray((prev) => ({ ...prev, list: prev.list.filter((x) => x.kind !== "name") }));
  }

  // move-on auto-dismiss (T2b): entering a DIFFERENT room drops the tray.
  // Mousing from the committed room onto the tray itself never counts as
  // move-on (the tray sits at the commit point, over its own room). The
  // refine WINDOW stays open until the next commit — r reopens it (T3).
  useEffect(() => {
    if (tray && hoverId && hoverId !== tray.roomId) setTray(null);
  }, [hoverId, tray]);

  // ── keys: b latch · ⇧ quasimode · s toggle fallback · r reopen · esc ──────
  const snap = useRef({});
  snap.current = { lastCommit, refineOpen };
  useEffect(() => {
    const down = (e) => {
      // typing in the tray's name field must not trip the b/s/r hotkeys
      if (e.target?.tagName === "INPUT") return;
      if (e.key === "Shift") setSkipHeld(true);
      else if (e.key === "b" || e.key === "B") {
        setBaseLatched((v) => { const on = !v; setLog((p) => [(on ? "base run latched — b ends it" : "base run ended"), ...p].slice(0, 10)); return on; });
      } else if (e.key === "s" || e.key === "S") {
        setSkipArmed((v) => !v);
      } else if (e.key === "r" || e.key === "R") {
        if (snap.current.lastCommit) setRefineOpen(true);
      } else if (e.key === "Escape") {
        setTray(null); setRefineOpen(false);
      }
    };
    const up = (e) => { if (e.key === "Shift") setSkipHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // cursor + velocity softening (presentation only — T6)
  function onMove(e) {
    const rect = stageRef.current.getBoundingClientRect();
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (!softenOn) { setSoftened(false); return; }
    const v = velRef.current, t = performance.now();
    const dt = t - v.t;
    if (dt > 0) {
      const speed = Math.hypot(e.clientX - v.x, e.clientY - v.y) / dt;
      if (speed > 0.9) setSoftened(true);
    }
    velRef.current = { x: e.clientX, y: e.clientY, t, timer: v.timer };
    clearTimeout(v.timer);
    velRef.current.timer = setTimeout(() => setSoftened(false), 140);
  }

  // ── derived view state ────────────────────────────────────────────────────

  const hoverRoom = hoverId ? roomById(hoverId) : null;
  const hoverCommitted = hoverId ? committed[hoverId] : null;
  // committed rooms show what's actually ON the takeoff — a demoted, untaken
  // name offer must not read back as if it had been applied
  const puckHover = hoverRoom ? {
    label: hoverCommitted ? hoverCommitted.label : hoverRoom.name,
    area_sf: hoverCommitted ? hoverCommitted.area : hoverRoom.area,
    confidence: hoverCommitted ? null : hoverRoom.conf,
    committed: !!hoverCommitted,
  } : null;

  const trayOffers = (tray?.list || []).map((o) => ({
    id: o.id,
    label: o.kind === "base" ? `wall base ${num(lenVal(o.lf, units))} ${lenUnit(units)}`
      : o.kind === "transition" ? `${o.name} ${num(lenVal(o.lf, units))} ${lenUnit(units)}`
      : `name “${o.name}”`,
    onTake: () => takeOffer(o),
  }));
  const trayEntry = tray ? committed[tray.roomId] : null;

  const totals = useMemo(() => {
    const cs = Object.values(committed);
    return {
      tag: "CPT-1", count: cs.length, mult: 1,
      sf: cs.reduce((n, c) => n + c.area, 0),
      lf: cs.reduce((n, c) => n + c.baseLf + c.transitionLf, 0),
    };
  }, [committed]);

  const refineTarget = refineOpen && lastCommit ? committed[lastCommit] : null;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", background: "var(--paper-bright)", color: "var(--ink)" }}>
      {/* ── sidebar ── */}
      <div className="paper-cream" style={{ width: 248, flexShrink: 0, borderRight: "1px solid var(--ink-faint)", padding: "16px 14px", overflowY: "auto" }}>
        <div style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 2 }}>
          open<span style={{ fontStyle: "italic", color: "var(--cobalt)" }}>takeoff</span>
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 6 }}>
          puck lab · cursor puck
        </div>
        {!embedded && <a href="/readout-demo.html" style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--cobalt)", display: "block", marginBottom: 14 }}>← readout lab</a>}

        <div style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 12 }}>
          Hover a room, <b>click</b> commits it. Offers appear only in the wake of the
          click — take one or just keep working; moving to another room dismisses them.
        </div>

        <div className="field-label" style={{ marginBottom: 4 }}>Keys</div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, lineHeight: 1.8, color: "var(--ink-secondary)", marginBottom: 12 }}>
          <b>b</b> — base run latch on/off<br />
          <b>⇧ hold</b> — skip base this room<br />
          <b>s</b> — skip next room (toggle)<br />
          <b>r</b> — refine the last commit<br />
          <b>esc</b> — dismiss offers / refine
        </div>

        <Toggle label="Offers on commit (off switch)" value={offersOn} onChange={setOffersOn}
          options={[[true, "On"], [false, "Off"]]} />
        <Toggle label="Motion softening" value={softenOn} onChange={setSoftenOn}
          options={[[true, "On"], [false, "Off"]]} />
        <Toggle label="Base run" value={baseLatched} onChange={setBaseLatched}
          options={[[true, "Latched"], [false, "Off"]]} />
        <Toggle label="Units" value={units} onChange={setUnits}
          options={[["imperial", "SF"], ["metric", "m²"]]} />
        <Toggle label="Theme" value={theme} onChange={() => toggleTheme()}
          options={[["light", "Light"], ["dark", "Dark"]]} />

        <button className="btn-ghost" style={{ width: "100%", justifyContent: "center", padding: "7px 10px", fontSize: 10, marginBottom: 12 }}
          onClick={() => { setCommitted({}); setTray(null); setLastCommit(null); setRefineOpen(false); say("reset — sheet cleared"); }}>
          reset the sheet
        </button>

        <div className="field-label" style={{ marginBottom: 4 }}>Act log</div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 9, lineHeight: 1.7, color: "var(--ink-muted)" }}>
          {log.length ? log.map((l, i) => <div key={i} style={{ opacity: i === 0 ? 1 : 0.65 }}>· {l}</div>) : <div>—</div>}
        </div>
      </div>

      {/* ── stage ── */}
      <div ref={stageRef} onMouseMove={onMove}
        style={{ flex: 1, position: "relative", overflow: "hidden", background: theme === "dark" ? "#0b0e14" : "var(--paper-shadow)", padding: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: "min(100%, 980px)", aspectRatio: "900 / 620", boxShadow: "var(--shadow-2)" }}>
          <PlanSheet committed={committed} hoverId={hoverId} units={units}
            onEnter={setHoverId} onLeave={(id) => setHoverId((cur) => (cur === id ? null : cur))}
            onCommit={commit} />
        </div>

        <CursorPuck units={units} x={cursor.x} y={cursor.y} softened={softened}
          hover={puckHover}
          baseRun={{ latched: baseLatched, skipHeld, skipArmed }} />

        {/* the act-anchored tray — pinned at the commit point, reachable */}
        {tray && trayEntry && (
          <CommitTray key={tray.roomId} x={tray.x} y={tray.y}
            label={trayEntry.label} autoApplied={trayEntry.autoNamed}
            onLabel={setLabel} offers={trayOffers}
            onRefine={!refineOpen ? () => setRefineOpen(true) : null}
            onDismiss={() => setTray(null)} />
        )}

        {/* condition totals — the quiet corner ledger, not the interaction */}
        <div style={{ position: "absolute", right: 22, top: 22 }}>
          <MeasureReadout units={units} header="CPT-1"
            state={{ kind: "empty", prompt: "Hover a room — click commits it" }}
            totals={totals} meta={{ shapes: totals.count, sheets: 1, zoom: 100 }} />
        </div>

        {/* the T3 refine window — last commit only, dies at the next one */}
        {refineTarget && (
          <div style={{
            position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)",
            background: "var(--paper-bright)", border: "1px solid var(--ink)", boxShadow: "var(--shadow-2)",
            padding: "10px 14px", width: 300,
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-muted)" }}>
                refine · {refineTarget.label || roomById(lastCommit).name}
              </span>
              <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 600, color: "var(--cobalt)" }}>
                {num(areaVal(refineTarget.area, units))} {areaUnit(units)}
              </span>
            </div>
            <input type="range" min="0" max="1" step="0.05" value={refineTarget.sens}
              onChange={(e) => {
                const sens = Number(e.target.value);
                setCommitted((prev) => ({
                  ...prev,
                  [lastCommit]: { ...prev[lastCommit], sens, area: +(prev[lastCommit].area0 * (1 + (sens - 0.5) * 0.16)).toFixed(1) },
                }));
              }}
              style={{ width: "100%", marginTop: 8 }} />
            <div style={{ display: "flex", fontFamily: "var(--f-mono)", fontSize: 8.5, color: "var(--ink-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              <span>strict</span><span style={{ marginLeft: "auto" }}>loose</span>
            </div>
            <div style={{ fontSize: 9.5, color: "var(--ink-muted)", marginTop: 6, lineHeight: 1.5 }}>
              scoped to the last commit — this window closes at the next one · esc closes it now
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

