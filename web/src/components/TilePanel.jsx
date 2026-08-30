// Tile panel (M5, docs/superpowers/plans/2026-08-27-tile-patterning-m5.md
// Task 5) — the docked right-rail surface for tile patterning: per-condition
// pattern/size/joint/SKU setup, a "this room" section for the selected
// shape's per-room origin/rotation override, and the cross-room QA list so a
// 40-room job isn't audited one zoom at a time.
//
// PURE VIEW, mirrors RollPanel.jsx's posture exactly: layout state lives on
// the CONDITIONS (tile_setup, edited via onTileSetup — same non-undoable
// precedent as roll_setup) and on the SHAPES (tile_layout, edited via
// onTileLayout — an undoable per-room override, shapeCommands.js `tileLayout`).
// This component does no engine math; it only reads the figured `layouts`
// (built by the canvas from computeTileTakeoff's byCond + condById) and the
// Task 4 `warnings` list, and dispatches patches upward. SKU images are
// deferred (design §6 #1) — color swatch only.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../brand/icons.jsx";
import { tileConfig } from "../lib/tileSetup.ts";
import { enumerateSlots } from "../lib/tilePatterns/enumerateSlots.ts";
import { PLANK_ARITY } from "../lib/tilePatterns/slotKey.ts";
import { wallElevationLayout } from "../lib/tileWallElevation.ts";
import { elevationButtonState } from "../lib/wallElevationPdf.ts";
import { wallWrappedLayout, runTurnAngles } from "../lib/wallWrapped.ts";

const WALL_CORNER_MODES = [
  { value: "wrap", label: "Wrap" },
  { value: "reset", label: "Reset per wall" },
];

const WALL_EDGE_FINISHES = [
  { value: "profile", label: "Profile (Schluter-style)" },
  { value: "bullnose", label: "Bullnose" },
  { value: "miter", label: "Mitered" },
];

const TILE_PATTERNS = [
  { value: "grid", label: "Grid" },
  { value: "brick_50", label: "Brick — 50% offset" },
  { value: "brick_33", label: "Brick — 33% offset" },
  { value: "diagonal", label: "Diagonal" },
  { value: "herringbone", label: "Herringbone" },
  { value: "basketweave", label: "Basketweave" },
];

const EDGE_STRATEGIES = [
  { value: "balanced", label: "Balanced — auto-center, no forced slivers" },
  { value: "start_full", label: "Start full at origin" },
];

let skuSeq = 0;
const mintSkuId = () => `sku${Date.now().toString(36)}${++skuSeq}`;

// A new SKU's default color cycles through this palette (indexed by the
// condition's current SKU count) so a second/third color is visibly
// distinct from the field's default purple — painting a checkerboard needs
// two DIFFERENT colors to read as anything but a solid field.
const SKU_PALETTE = ["#9333ea", "#0ea5e9", "#f59e0b", "#16a34a", "#e11d48", "#64748b"];

// The paint-the-unit grid's per-pattern unit-size range (design §6):
// basketweave's 2-plank cell needs at least a 2x2 unit to show both
// orientations, every other pattern can paint down to a 1x1 unit.
const UNIT_MIN = { basketweave: 2 };
const UNIT_MAX = 4;
const unitMin = (pattern) => UNIT_MIN[pattern] ?? 1;

// One SKU row — name/size/color, editable inline. `onChange(patch)` merges
// into this SKU; `onRemove` drops it (guarded by the parent: a setup keeps
// at least one usable SKU, same guard hasTileSetup reads).
function SkuRow({ sku, onChange, onRemove, removable }) {
  const ip = { padding: "3px 5px", border: "1px solid var(--ink-faint)", fontSize: 11.5, fontFamily: "var(--f-mono)" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 0", flexWrap: "wrap" }}>
      <input type="color" value={sku.color || "#9333ea"} onChange={(e) => onChange({ color: e.target.value })}
        title="Tile color" style={{ width: 22, height: 22, padding: 0, border: "1px solid var(--ink-faint)", cursor: "pointer" }} />
      <input value={sku.name || ""} onChange={(e) => onChange({ name: e.target.value })} placeholder="SKU name"
        style={{ ...ip, width: 92 }} />
      <input type="number" min="0.25" step="0.25" value={sku.w_in ?? ""} onChange={(e) => onChange({ w_in: Math.max(0.25, parseFloat(e.target.value) || 0.25) })}
        title="Tile width, inches" style={{ ...ip, width: 48 }} />
      <span style={{ color: "var(--ink-muted)", fontSize: 11 }}>×</span>
      <input type="number" min="0.25" step="0.25" value={sku.h_in ?? ""} onChange={(e) => onChange({ h_in: Math.max(0.25, parseFloat(e.target.value) || 0.25) })}
        title="Tile height, inches" style={{ ...ip, width: 48 }} />
      <span style={{ color: "var(--ink-muted)", fontSize: 10.5 }}>in</span>
      {removable && (
        <button onClick={onRemove} title="Remove this SKU"
          style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--ink-muted)", cursor: "pointer", fontSize: 13, padding: "0 2px" }}>×</button>
      )}
    </div>
  );
}

// The paint-the-unit control (M9 Task 11): a repeat-unit size selector plus
// a clickable grid of every slot in one iteration (enumerateSlots), each
// filled with its currently-assigned SKU's color (falling back to the
// field's default SKU on an unpainted/dangling slot — the SAME fallback
// assignedSkuId uses). Click a cell -> a small SKU swatch popover -> pick a
// SKU -> assignment.slots[slot] = skuId. One-act: click, see the swatch
// list, pick, done — no second confirm step. Slot cells lay out in the
// SAME row-major order enumerateSlots returns (j outer, i inner, p
// innermost), `unit.w * arity` columns wide, so a multi-plank pattern's
// per-cell plank roles sit adjacent in one visual row-group.
function PaintUnit({ ts, patch }) {
  const skus = ts.skus || [];
  const [openSlot, setOpenSlot] = useState(null);
  const rootRef = useRef(null);

  // Close on click-outside / Escape — same idiom as DrawStylePicker.jsx.
  useEffect(() => {
    if (!openSlot) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpenSlot(null); };
    const onKey = (e) => { if (e.key === "Escape") setOpenSlot(null); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [openSlot]);

  if (skus.length < 1) return null;

  // Clamp on READ too, not just on write: switching pattern to basketweave
  // (min 2) while an existing assignment carries a 1x1 unit must not leave
  // the selector showing a value below its own min.
  const min = unitMin(ts.pattern);
  const rawUnit = ts.assignment?.unit;
  const unit = {
    w: Math.min(UNIT_MAX, Math.max(min, Number(rawUnit?.w) || min)),
    h: Math.min(UNIT_MAX, Math.max(min, Number(rawUnit?.h) || min)),
  };
  const slots = ts.assignment?.slots || {};
  const arity = PLANK_ARITY[ts.pattern] ?? 1;
  const cells = enumerateSlots(ts.pattern, unit);

  const setUnitAxis = (axis, v) => {
    const next = { ...unit, [axis]: Math.min(UNIT_MAX, Math.max(min, Math.round(v) || min)) };
    patch({ assignment: { mode: "repeat", unit: next, slots } });
  };
  const paint = (slot, skuId) => {
    patch({ assignment: { mode: "repeat", unit, slots: { ...slots, [slot]: skuId } } });
    setOpenSlot(null);
  };

  const defaultSku = skus.find((s) => Number(s.w_in) > 0 && Number(s.h_in) > 0) || skus[0];
  // Usable, not just present: an id can still name a SKU whose w_in/h_in got
  // zeroed out (or never set) — matches assignedSkuId's own usableSku gate
  // (tileSetup.ts) so the swatch shown here never disagrees with what the
  // canvas actually renders for that slot.
  const skuFor = (slot) => {
    const id = slots[slot];
    const found = id && skus.find((s) => s.id === id);
    return (found && Number(found.w_in) > 0 && Number(found.h_in) > 0) ? found : defaultSku;
  };

  const ip = { padding: "3px 5px", border: "1px solid var(--ink-faint)", fontSize: 11.5, fontFamily: "var(--f-mono)" };
  const fld = { display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: "var(--ink-muted)" };
  const cellPx = 18;

  return (
    <div ref={rootRef} style={{ marginBottom: 6, position: "relative" }}>
      <div style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>Paint the repeat unit</div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 6 }}>
        <label style={fld}>Unit W
          <input type="number" min={min} max={UNIT_MAX} step="1" value={unit.w}
            onChange={(e) => setUnitAxis("w", parseInt(e.target.value, 10))} style={{ ...ip, width: 40 }} />
        </label>
        <label style={fld}>Unit H
          <input type="number" min={min} max={UNIT_MAX} step="1" value={unit.h}
            onChange={(e) => setUnitAxis("h", parseInt(e.target.value, 10))} style={{ ...ip, width: 40 }} />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${unit.w * arity}, ${cellPx}px)`, gap: 2 }}>
        {cells.map((s) => {
          const sku = skuFor(s.slot);
          return (
            <div key={s.slot} style={{ position: "relative" }}>
              <button type="button"
                title={`${s.slot}${sku ? ` — ${sku.name || sku.id}` : ""}`}
                onClick={() => setOpenSlot((cur) => (cur === s.slot ? null : s.slot))}
                style={{ width: cellPx, height: cellPx, padding: 0, border: "1px solid var(--ink-faint)", background: sku?.color || "var(--ink-faint)", cursor: "pointer" }} />
              {openSlot === s.slot && (
                <div role="listbox" aria-label={`SKU for slot ${s.slot}`}
                  style={{ position: "absolute", top: "100%", left: 0, marginTop: 2, zIndex: 80, background: "var(--paper-cream)", border: "1px solid var(--ink)", boxShadow: "var(--shadow-2)", padding: 3, display: "flex", flexDirection: "column", gap: 2, minWidth: 96 }}>
                  {skus.map((sk) => (
                    <button key={sk.id} type="button" onClick={() => paint(s.slot, sk.id)}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 5px", border: "none", background: "transparent", cursor: "pointer", fontSize: 10.5, color: "var(--ink)", textAlign: "left" }}>
                      <span style={{ width: 12, height: 12, flexShrink: 0, background: sk.color || "var(--ink-faint)", border: "1px solid var(--ink-faint)" }} />
                      <span style={{ flex: 1 }}>{sk.name || sk.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One tiled condition's setup + summary — the pattern/size/joint/edge/SKU
// controls plus the figured counts, order, grout, and cut sheet from `ti`
// (a computeTileTakeoff byCond entry).
function ConditionCard({ condId, tag, color, multiplier, ti, onTileSetup }) {
  const ts = ti.tile_setup;
  const patch = (p) => onTileSetup(condId, p);
  // Task 8 (2026-08-29 wall-tile-slice-a) — `ti.hasWallShape` is a REAL
  // per-condition flag (tileTakeoff.js's byCond aggregation, survives to
  // the finalized entry), true iff at least one contributing shape is a
  // `surface_area` wall. NOT `ts.wall_corner_mode` presence — mintTileSetup
  // defaults that field on EVERY condition (floor included, "inert on the
  // floor path"), so it can never tell a wall condition from a floor one.
  // A mixed floor+wall condition (shares a condition_id) still counts as a
  // wall condition here — its corner-mode/edge-finish knobs are real, wall
  // shapes on it will read them.
  const isWall = !!ti.hasWallShape;
  const patchJoint = (width_in) => patch({ joint: { ...(ts.joint || {}), width_in: Math.max(0, width_in) } });
  const patchOrigin = (idx, v) => {
    const o = Array.isArray(ts.origin) ? ts.origin.slice() : [0, 0];
    o[idx] = v;
    patch({ origin: o });
  };
  const patchSku = (skuId, p) => patch({ skus: (ts.skus || []).map((s) => (s.id === skuId ? { ...s, ...p } : s)) });
  const removeSku = (skuId) => patch({ skus: (ts.skus || []).filter((s) => s.id !== skuId) });
  // A new SKU defaults to the FIELD size — tileConfig(ts) (the SAME
  // primaryUsableSku-driven size the solve/order/QA gate all read), not a
  // hardcoded 12x24 — so adding a second color never trips the engine's
  // same-size assignment gate (tileSolve.ts) by accident. This card only
  // ever renders with ts.skus.length >= 1 (hasTileSetup's own guard, and
  // removeSku never lets it drop below 1), so tileConfig's own no-SKU
  // fallback (12x12) is unreachable here — noted, not relied on.
  const addSku = () => {
    const field = tileConfig(ts);
    const color = SKU_PALETTE[(ts.skus || []).length % SKU_PALETTE.length];
    patch({ skus: [...(ts.skus || []), { id: mintSkuId(), name: "Tile", w_in: field.w_in, h_in: field.h_in, color }] });
  };

  const fld = { display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: "var(--ink-muted)" };
  const ip = { padding: "3px 5px", border: "1px solid var(--ink-faint)", fontSize: 11.5, fontFamily: "var(--f-mono)" };

  return (
    <div style={{ borderBottom: "2px solid var(--ink-faint)", padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <span style={{ width: 12, height: 12, flexShrink: 0, background: color || "var(--ink-faint)", border: "1px solid var(--ink-faint)" }} />
        <b style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{tag}</b>
        {multiplier > 1 && <span style={{ color: "var(--ink-muted)", fontSize: 11 }} title="The condition's ×N applies at the report seam — this panel figures one unit">×{multiplier}</span>}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <label style={fld}>Pattern
          <select value={ts.pattern || "grid"} onChange={(e) => patch({ pattern: e.target.value })} style={{ ...ip, background: "var(--paper-bright)" }}>
            {TILE_PATTERNS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label style={fld}>Edge strategy
          <select value={ts.edge_strategy || "balanced"} onChange={(e) => patch({ edge_strategy: e.target.value })} style={{ ...ip, background: "var(--paper-bright)" }}>
            {EDGE_STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label style={fld}>Joint (in)
          <input type="number" min="0" step="0.0625" value={ts.joint?.width_in ?? 0} onChange={(e) => patchJoint(parseFloat(e.target.value) || 0)} style={{ ...ip, width: 56 }} />
        </label>
      </div>

      {isWall && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          <label style={fld}>Corner handling
            <div style={{ display: "flex", gap: 2 }}>
              {WALL_CORNER_MODES.map((m) => {
                const on = (ts.wall_corner_mode || "wrap") === m.value;
                return (
                  <button key={m.value} type="button" onClick={() => patch({ wall_corner_mode: m.value })}
                    title={m.value === "wrap" ? "Tile continuously around every corner" : "Solve each wall segment on its own, split at every corner"}
                    style={{ padding: "3px 7px", border: `1px solid ${on ? "var(--cobalt)" : "var(--ink-faint)"}`, background: on ? "var(--cobalt)" : "var(--paper-bright)", color: on ? "var(--paper-bright)" : "var(--ink-muted)", cursor: "pointer", fontSize: 10.5, fontFamily: "var(--f-mono)" }}>
                    {m.label}
                  </button>
                );
              })}
            </div>
          </label>
          <label style={fld}>Edge finish
            <select value={ts.wall_edge_finish || "profile"} onChange={(e) => patch({ wall_edge_finish: e.target.value })} style={{ ...ip, background: "var(--paper-bright)" }}>
              {WALL_EDGE_FINISHES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <label style={fld}>Origin X (ft)
          <input type="number" step="0.01" value={Array.isArray(ts.origin) ? ts.origin[0] : 0} onChange={(e) => patchOrigin(0, parseFloat(e.target.value) || 0)} style={{ ...ip, width: 64 }} />
        </label>
        <label style={fld}>Origin Y (ft)
          <input type="number" step="0.01" value={Array.isArray(ts.origin) ? ts.origin[1] : 0} onChange={(e) => patchOrigin(1, parseFloat(e.target.value) || 0)} style={{ ...ip, width: 64 }} />
        </label>
        <label style={fld}>Rotation (deg)
          <input type="number" step="1" value={ts.rotation_deg ?? 0} onChange={(e) => patch({ rotation_deg: parseFloat(e.target.value) || 0 })} style={{ ...ip, width: 56 }} />
        </label>
      </div>

      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>SKUs</div>
        {(ts.skus || []).map((s) => (
          <SkuRow key={s.id} sku={s} onChange={(p) => patchSku(s.id, p)} onRemove={() => removeSku(s.id)} removable={(ts.skus || []).length > 1} />
        ))}
        <button onClick={addSku} title="Add a SKU"
          style={{ marginTop: 3, padding: "2px 7px", border: "1px dashed var(--ink-faint)", background: "transparent", color: "var(--ink-muted)", cursor: "pointer", fontSize: 11 }}>+ add SKU</button>
      </div>

      <PaintUnit ts={ts} patch={patch} />

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 10.5, color: "var(--ink-muted)" }}>
          <input type="checkbox" name="tile-reuse-enabled" checked={!!ts.purchase?.reuse?.enabled}
            onChange={(e) => patch({ purchase: { ...(ts.purchase || {}), reuse: { ...(ts.purchase?.reuse || {}), enabled: e.target.checked } } })} />
          Reuse offcuts
        </label>
        {ts.purchase?.reuse?.enabled && (
          <label style={fld}>Sliver threshold (in)
            <input type="number" min="0.25" step="0.25" value={ts.purchase?.reuse?.sliver_threshold_in ?? 2}
              onChange={(e) => patch({ purchase: { ...(ts.purchase || {}), reuse: { ...(ts.purchase?.reuse || {}), sliver_threshold_in: Math.max(0.25, parseFloat(e.target.value) || 2) } } })}
              style={{ ...ip, width: 56 }} />
          </label>
        )}
      </div>

      <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink)", marginBottom: 4 }}>
        {ti.counts.full} full · {ti.counts.cut} cut · {ti.counts.corner} corner{ti.counts.hole ? ` · ${ti.counts.hole} hole` : ""} · {Math.round(ti.counts.keptArea_sf * 100) / 100} SF
      </div>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-secondary)", marginBottom: 4 }}>
        order {ti.order.withMargin} tile{ti.order.withMargin === 1 ? "" : "s"} · {ti.order.boxes} box{ti.order.boxes === 1 ? "" : "es"} · {ti.grout.bags} grout bag{ti.grout.bags === 1 ? "" : "s"}
      </div>

      {/* Task 8 — wall-only trim/joint/corner summary (C1's widened gate,
          tileTakeoff.js:370-ish, is what makes ti.trim/ti.joints populate
          for a wall at all). Gated on isWall too, not just `ti.trim`
          presence, so a floor condition's own trim summary (if any) never
          gains a NEW line here — ruling 5, floor stays byte-identical. */}
      {isWall && ti.trim && ti.joints && (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-secondary)", marginBottom: 4 }}>
          trim {Math.round(ti.trim.length_lf * 100) / 100} LF · joints {Math.round(ti.joints.total_lf * 100) / 100} LF ·{" "}
          {ti.trim.corner_inside + ti.trim.corner_outside} corner{ti.trim.corner_inside + ti.trim.corner_outside === 1 ? "" : "s"}{" "}
          ({ti.trim.corner_inside} in / {ti.trim.corner_outside} out)
        </div>
      )}

      {Array.isArray(ti.band) && ti.band.length > 0 && ti.band.map((b) => {
        const bandSku = (ts.skus || []).find((sk) => sk.id === b.sku_id);
        return (
          <div key={b.sku_id} style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-secondary)", marginBottom: 4 }}>
            band {bandSku?.name || b.sku_id}: {b.tiles} tile{b.tiles === 1 ? "" : "s"} · {b.corner} corner cut{b.corner === 1 ? "" : "s"} · {Math.round(b.lf * 100) / 100} LF
          </div>
        );
      })}

      {ti.reuse ? (
        ti.reuse.downgraded ? (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 4 }}>
            reuse n/a for {ts.pattern} — grain ambiguous
          </div>
        ) : (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-secondary)", marginBottom: 4 }}>
            with reuse {ti.reuseOrder.withMargin} tile{ti.reuseOrder.withMargin === 1 ? "" : "s"} · {ti.reuseOrder.boxes} box{ti.reuseOrder.boxes === 1 ? "" : "es"}
          </div>
        )
      ) : (
        // Task 8's multi-color guard: `purchase.reuse.enabled` was requested
        // but 2+ SKUs are kept on this condition's field, so the engine
        // guards `ti.reuse`/`ti.reuseOrder` off entirely (reuse pools
        // offcuts per SKU but boxes them all as one) — without this branch
        // the block above rendered NOTHING, silently dropping the reuse
        // checkbox's own state from the card.
        ts.purchase?.reuse?.enabled && ti.reuseDowngradedMulti && (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 4 }}>
            reuse n/a — multi-color field
          </div>
        )
      )}

      {ti.cutsheet.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 2 }}>Cut sheet</div>
          {ti.cutsheet.map((row, i) => (
            <div key={i} style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--ink-secondary)", padding: "1px 0" }}>
              {row.count}× {row.w_in}″ × {row.h_in}″{row.lShaped ? " L-shaped" : ""}{row.corner ? " corner" : ""}
            </div>
          ))}
        </div>
      )}

      {ti.warnings.length > 0 && (
        <div style={{ margin: "6px 0 0", padding: "5px 8px", border: "1px solid var(--c-warning)", color: "var(--ink-secondary)", fontSize: 11, lineHeight: 1.45 }}>
          {ti.warnings.join(" ")}
        </div>
      )}
    </div>
  );
}

// The selected room's per-room override — origin/rotation only fall back to
// the condition default when absent (design §4.1); "Follow condition
// default" clears just that field (a shallow-merge `{field: undefined}`
// patch — shapeCommands.js `tileLayout` spreads `patch` over `tile_layout`,
// so an explicit `undefined` leaves the key unset and reads fall through to
// the condition default) without touching sibling override fields. The
// interior band (M7 §3.4) is a THIRD per-room override on the same
// `tile_layout` object, `{ sku_id, width_ft, offset_ft }`; unlike
// origin/rotation it has no condition-level default to fall back to — a
// room either has a band or it doesn't, so its own checkbox drives presence
// rather than a "follow default" reset. `skus` is the selected shape's
// condition's `tile_setup.skus` (threaded from the canvas, where the
// condition is already resolved) — the band SKU picker's option list.
function RoomOverride({ selectedShape, effectiveConfig, skus, onTileLayout }) {
  const tl = selectedShape.tile_layout || {};
  const hasOriginOverride = Array.isArray(tl.origin);
  const hasRotationOverride = tl.rotation != null;
  const origin = hasOriginOverride ? tl.origin : effectiveConfig.origin;
  const rotation = hasRotationOverride ? tl.rotation : effectiveConfig.rotation_deg;
  const band = tl.band || null;
  const setBandField = (field, v) => onTileLayout(selectedShape.id, { band: { ...(band || {}), [field]: v } });
  const enableBand = () => onTileLayout(selectedShape.id, { band: { sku_id: (skus && skus[0] && skus[0].id) || "", width_ft: 0.5, offset_ft: 0 } });
  const removeBand = () => onTileLayout(selectedShape.id, { band: undefined });

  const ip = { padding: "3px 5px", border: "1px solid var(--ink-faint)", fontSize: 11.5, fontFamily: "var(--f-mono)" };
  const fld = { display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: "var(--ink-muted)" };
  const resetBtn = { border: "none", background: "transparent", color: "var(--cobalt)", cursor: "pointer", fontSize: 10, padding: "0 2px", textDecoration: "underline" };

  const setOriginAxis = (idx, v) => {
    const o = Array.isArray(origin) ? origin.slice() : [0, 0];
    o[idx] = v;
    onTileLayout(selectedShape.id, { origin: o });
  };

  return (
    <div style={{ borderBottom: "2px solid var(--ink-faint)", padding: "10px 12px" }}>
      <div style={{ fontSize: 10.5, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>This room</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 4 }}>
        <label style={fld}>Origin X (ft)
          <input type="number" step="0.01" value={Array.isArray(origin) ? origin[0] : 0} onChange={(e) => setOriginAxis(0, parseFloat(e.target.value) || 0)} style={{ ...ip, width: 64 }} />
        </label>
        <label style={fld}>Origin Y (ft)
          <input type="number" step="0.01" value={Array.isArray(origin) ? origin[1] : 0} onChange={(e) => setOriginAxis(1, parseFloat(e.target.value) || 0)} style={{ ...ip, width: 64 }} />
        </label>
        {hasOriginOverride && (
          <button style={resetBtn} onClick={() => onTileLayout(selectedShape.id, { origin: undefined })}
            title="Clear this room's origin override — it follows the condition default again">follow default</button>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={fld}>Rotation (deg)
          <input type="number" step="1" value={rotation ?? 0} onChange={(e) => onTileLayout(selectedShape.id, { rotation: parseFloat(e.target.value) || 0 })} style={{ ...ip, width: 56 }} />
        </label>
        {hasRotationOverride && (
          <button style={resetBtn} onClick={() => onTileLayout(selectedShape.id, { rotation: undefined })}
            title="Clear this room's rotation override — it follows the condition default again">follow default</button>
        )}
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--ink-faint)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--ink-muted)" }}>
          <input type="checkbox" checked={!!band} onChange={(e) => (e.target.checked ? enableBand() : removeBand())} />
          Band (this room)
        </label>
        {band && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginTop: 6 }}>
            <label style={fld}>SKU
              <select value={band.sku_id || ""} onChange={(e) => setBandField("sku_id", e.target.value)} style={{ ...ip, width: 112 }}>
                {(skus || []).map((sk) => <option key={sk.id} value={sk.id}>{sk.name || sk.id}</option>)}
              </select>
            </label>
            <label style={fld}>Width (ft)
              <input type="number" step="0.05" min="0.05" value={band.width_ft ?? 0.5} onChange={(e) => setBandField("width_ft", Math.max(0.05, parseFloat(e.target.value) || 0.5))} style={{ ...ip, width: 56 }} />
            </label>
            <label style={fld}>Offset (ft)
              <input type="number" step="0.05" min="0" value={band.offset_ft ?? 0} onChange={(e) => setBandField("offset_ft", parseFloat(e.target.value) || 0)} style={{ ...ip, width: 56 }} />
            </label>
            <button style={resetBtn} onClick={removeBand} title="Remove this room's band — clears the sku/width/offset override">remove band</button>
          </div>
        )}
      </div>
    </div>
  );
}

// The selected WALL shape's card (Task 8, 2026-08-29 wall-tile-slice-a) —
// the shape-level face-side flip + endpoint-exposed toggles (written via
// `onWallField`, TOP-LEVEL shape fields the wall engine reads directly —
// NOT nested under tile_layout, see shapeCommands.js's `wallFields` policy
// row) plus the per-shape elevation-strip preview. `selectedWall`
// (`{wallStrips, folds, trim, joints, verts_norm}` or `null`, threaded from
// TakeoffCanvas's own `byShape` lookup — M4/ruling 1, NEVER the
// condition's `ti`) drives the SVG via the pure `wallElevationLayout`
// helper (tileWallElevation.ts); this component only converts its FEET
// output to a small fixed-scale px viewBox and draws it — no engine math
// here. Renders the controls even when `selectedWall` is null (an
// unscaled sheet, or a shape excluded this pass — reversing/degenerate
// run) so the panel never throws on an unfigured wall selection.
//
// Task 2 (2026-08-29 wall-tile-slice-c) — an unwrapped/wrapped toggle sits
// above the strip. "Unwrapped" is the Slice A/B flat strip, byte-identical
// to before. "Wrapped" reuses the SAME `elev.tiles`/`elev.folds` (no second
// engine pass) and runs them through `wallWrappedLayout` (wallWrapped.ts)
// with each fold's plan turn angle (`runTurnAngles`, same module, over
// `selectedWall.verts_norm` + the raw per-fold `vertexIndex`) so the strip
// visibly bends at each corner instead of staying a straight seam.
// `verts_norm` absent (defensive) → `runTurnAngles` sees no vertices to
// pair up and returns no bend for any fold; wrapped then draws the same
// flat geometry as unwrapped rather than throwing.
// Target on-screen box the elevation strip fits INSIDE (preserving aspect,
// "contain"-style — the binding dimension, width or height, hits its
// target; the other comes in under). Fixed target dims, NOT a fixed
// feet-per-px rate, are what keeps fontSize/strokeWidth (specified once, in
// viewBox units below) reading at a roughly constant on-screen size no
// matter the wall's real length: a 4ft closet wall and a 40ft corridor wall
// both render into a viewBox close to TARGET_W×TARGET_H, just at different
// feet-per-unit rates — a run-length-dependent fixed EL_UPP would instead
// blow the viewBox out to 40x width at 40ft, shrinking a fixed fontSize to
// illegibility (the exact failure a docked ~300px-wide panel card can't
// afford for its one legibility-critical label: which corner is inside).
const TARGET_W_PX = 260;
const TARGET_H_PX = 140;
// Task 3 (2026-08-29 wall-tile-slice-b) — `wallTag` and `existingSheetKeys`
// are threaded down from TakeoffCanvas.jsx purely so this card can compute
// `elevationButtonState` (wallElevationPdf.ts): `selectedShape` here is
// TilePanel's own narrowed prop (id/measure_role/tile_layout/face_side/
// endpoint_exposed only — condition_id is deliberately omitted, see
// TilePanel's own selectedShape doc comment), so the condition's finish_tag
// isn't otherwise available, and the open sheet-key set lives on the
// canvas, not the panel. `onGenerateElevation` is Task 2's already-bound
// closure (`() => generateWallElevationSheet(selShape)`) — this card calls
// it with no arguments, never re-deriving or re-passing the shape.
function WallShapeCard({ selectedShape, selectedWall, skus, onWallField, wallTag, existingSheetKeys, onGenerateElevation }) {
  // Task 2 (2026-08-29 wall-tile-slice-c) — defaults to unwrapped, so a
  // reselected wall never surprises with the bent view; Slice A/B behavior
  // is unchanged until the user opts in.
  const [wrapView, setWrapView] = useState(false);
  const faceSide = selectedShape.face_side || "left";
  const endpointExposed = Array.isArray(selectedShape.endpoint_exposed) ? selectedShape.endpoint_exposed : [false, false];
  const setFaceSide = (v) => onWallField(selectedShape.id, { face_side: v });
  const toggleEndpoint = (idx) => {
    const next = [endpointExposed[0], endpointExposed[1]];
    next[idx] = !next[idx];
    onWallField(selectedShape.id, { endpoint_exposed: next });
  };
  // "#888888", not the CSS-shorthand "#888" — every fill/stroke below
  // string-concats a 2-hex alpha suffix onto this (color + "40"), and
  // "#888" + "40" is not a valid color. Miss-path only in practice
  // (assignedSkuId, upstream, never dangles a live SKU id), but the concat
  // contract still has to hold on this defensive fallback.
  const skuColor = (skuId) => (skus || []).find((sk) => sk.id === skuId)?.color || "#888888";
  const elev = selectedWall ? wallElevationLayout(selectedWall.wallStrips, selectedWall.folds, skuColor) : null;
  const hasElev = !!elev && elev.width_ft > 0 && elev.height_ft > 0;
  // "?" mirrors generateWallElevationSheet's own fallback (TakeoffCanvas.jsx)
  // for a condition whose finish_tag somehow reads empty — the button's
  // label/enabled state must never disagree with what the handler it
  // triggers would actually name the sheet.
  const btn = elevationButtonState({ selectedWall, existingSheetKeys, tag: wallTag || "?", shapeId: selectedShape.id });

  const fld = { display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: "var(--ink-muted)" };
  const toggleBtn = (on) => ({ padding: "3px 7px", border: `1px solid ${on ? "var(--cobalt)" : "var(--ink-faint)"}`, background: on ? "var(--cobalt)" : "var(--paper-bright)", color: on ? "var(--paper-bright)" : "var(--ink-muted)", cursor: "pointer", fontSize: 10.5, fontFamily: "var(--f-mono)" });

  // PAD-ringed px viewBox so fold labels above the strip have room to draw.
  const PAD = 16;
  // feet-per-viewBox-unit: whichever dimension (width or height) is more
  // demanding relative to its own target wins, so the drawn strip always
  // fits fully inside TARGET_W×TARGET_H (never crops, never blows out).
  const elUpp = hasElev ? Math.max(elev.width_ft / TARGET_W_PX, elev.height_ft / TARGET_H_PX, 0.005) : 0.06;
  const w_px = hasElev ? elev.width_ft / elUpp : 0;
  const h_px = hasElev ? elev.height_ft / elUpp : 0;

  // Task 2 — the wrapped (bent) layout, built from the SAME elev.tiles /
  // elev.folds `wallElevationLayout` already produced above (no second
  // engine pass) plus each fold's plan turn angle. `elev.folds` is the
  // `{x, kind}`-only view the flat strip's dashed lines draw from;
  // `selectedWall.folds` is the raw `Fold[]` (same order/length) carrying
  // the `vertexIndex` `runTurnAngles` needs to pick out each fold's plan
  // vertices from `selectedWall.verts_norm`.
  // Fed straight through, UNNEGATED: `runTurnAngles`'s raw atan2(cross,dot)
  // on `verts_norm` already lines up with wallWrappedLayout's OWN convention
  // — Task 1's test literally names turnAngle=+π/2 "a right turn" — because
  // "positive = a physical right turn (walking the wall in u's direction)"
  // holds for BOTH: checked numerically across east→south, north→east
  // (right turns, +π/2) and south→east, east→north (left turns, -π/2), on
  // this repo's plan convention (x=east, y=south, north up on screen). The
  // wrapped view's own y-axis is wall HEIGHT, not compass north — there's no
  // "plan north should still point up after wrapping" claim to preserve, so
  // no coordinate-frame correction belongs here; the two modules' sign
  // conventions already compose.
  const turnAngles = hasElev ? runTurnAngles(selectedWall?.verts_norm, selectedWall?.folds) : [];
  const wrapped = hasElev
    ? wallWrappedLayout({
        elevationTiles: elev.tiles,
        width_ft: elev.width_ft,
        foldsU: elev.folds.map((f) => f.x),
        foldKinds: elev.folds.map((f) => f.kind),
        turnAngles,
      })
    : null;
  // wallWrappedLayout's own `bbox` is tile-pts-only (Task 1 handoff) — a
  // hinge can land outside every tile's footprint at a sharp fold, so the
  // viewBox has to union both here, not just trust `wrapped.bbox`.
  const wrapBBox = wrapped
    ? (() => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const grow = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
        for (const t of wrapped.tiles) for (const [x, y] of t.pts) grow(x, y);
        for (const h of wrapped.hinges) grow(h.x, h.y);
        return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      })()
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const wrapW_ft = wrapBBox.maxX - wrapBBox.minX;
  const wrapH_ft = wrapBBox.maxY - wrapBBox.minY;
  // Same "contain"-in-a-fixed-target-box scale policy as elUpp above, over
  // the wrapped (post-bend) extent instead of the flat one — a folded run
  // can be taller/narrower than its flat strip, so this is its OWN scale,
  // not elUpp reused.
  const wrUpp = hasElev ? Math.max(wrapW_ft / TARGET_W_PX, wrapH_ft / TARGET_H_PX, 0.005) : 0.06;
  const wrap_w_px = hasElev ? wrapW_ft / wrUpp : 0;
  const wrap_h_px = hasElev ? wrapH_ft / wrUpp : 0;
  const toWrapPx = ([x, y]) => [(x - wrapBBox.minX) / wrUpp, (y - wrapBBox.minY) / wrUpp];

  return (
    <div style={{ borderBottom: "2px solid var(--ink-faint)", padding: "10px 12px" }}>
      <div style={{ fontSize: 10.5, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>This wall</div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 6 }}>
        <label style={fld}>Face side
          <div style={{ display: "flex", gap: 2 }}>
            <button type="button" onClick={() => setFaceSide("left")}
              title="The tiled face lies on the (-dy, dx) side of the drawn run — flips which corner reads inside vs outside"
              style={toggleBtn(faceSide === "left")}>Left</button>
            <button type="button" onClick={() => setFaceSide("right")}
              title="The tiled face lies on the (dy, -dx) side of the drawn run — flips which corner reads inside vs outside"
              style={toggleBtn(faceSide === "right")}>Right</button>
          </div>
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 10.5, color: "var(--ink-muted)" }}>
          <input type="checkbox" checked={!!endpointExposed[0]} onChange={() => toggleEndpoint(0)} />
          Start end exposed
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 10.5, color: "var(--ink-muted)" }}>
          <input type="checkbox" checked={!!endpointExposed[1]} onChange={() => toggleEndpoint(1)} />
          End end exposed
        </label>
      </div>

      {hasElev && (
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          <button type="button" onClick={() => setWrapView(false)}
            title="The flat elevation strip, corners marked as dashed fold-lines"
            style={toggleBtn(!wrapView)}>Unwrapped</button>
          <button type="button" onClick={() => setWrapView(true)}
            title="The strip folded at each corner's plan turn angle, like the wall run itself"
            style={toggleBtn(wrapView)}>Wrapped</button>
        </div>
      )}

      {hasElev && !wrapView && (
        <svg viewBox={`${-PAD} ${-PAD} ${w_px + PAD * 2} ${h_px + PAD * 2}`} width="100%" style={{ display: "block", border: "1px solid var(--ink-faint)", background: "var(--paper-cream)" }}>
          {/* Floor-at-bottom V-flip (a wall elevation reads floor-up, SVG
              draws top-down): strip y=0 (floor) -> SVG y=h_px (box bottom). */}
          <g transform={`matrix(1,0,0,-1,0,${h_px})`}>
            {elev.tiles.map((t, i) => {
              const isCut = t.cls === "cut";
              const color = t.color;
              return (
                <rect key={i} x={t.x / elUpp} y={t.y / elUpp} width={t.w / elUpp} height={t.h / elUpp}
                  fill={color + (isCut ? "40" : "88")} stroke={color}
                  strokeWidth={t.cls === "corner" ? 2 : 1}
                  strokeDasharray={isCut ? "3 2" : undefined} />
              );
            })}
            {elev.folds.map((f, i) => (
              <line key={i} x1={f.x / elUpp} y1={0} x2={f.x / elUpp} y2={h_px}
                stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="5 4" />
            ))}
          </g>
          {/* Fold labels drawn OUTSIDE the flipped group — text stays upright. */}
          {elev.folds.map((f, i) => (
            <text key={i} x={f.x / elUpp} y={-5} textAnchor="middle" fontSize={10} fontFamily="var(--f-mono)"
              fill={f.kind === "inside" ? "var(--cobalt)" : "var(--ink-secondary)"}>
              {f.kind}
            </text>
          ))}
        </svg>
      )}

      {hasElev && wrapView && (
        // Task 2 — the wrapped/fanned view: SAME V-flip convention as the
        // unwrapped strip above (wallWrappedLayout's tiles/hinges are in the
        // SAME y-up "natural" elevation frame tileWallElevation.ts's tiles
        // are, un-rotated segments included — only rotated ones move), just
        // over `wrapBBox`'s own (possibly off-origin, a rotated segment can
        // land anywhere) extent instead of the flat [0,width]x[0,height] box.
        <svg viewBox={`${-PAD} ${-PAD} ${wrap_w_px + PAD * 2} ${wrap_h_px + PAD * 2}`} width="100%" style={{ display: "block", border: "1px solid var(--ink-faint)", background: "var(--paper-cream)" }}>
          <g transform={`matrix(1,0,0,-1,0,${wrap_h_px})`}>
            {wrapped.tiles.map((t, i) => {
              const isCut = t.cls === "cut";
              const color = t.color;
              const pts = t.pts.map((p) => toWrapPx(p).join(",")).join(" ");
              return (
                <polygon key={i} points={pts}
                  fill={color + (isCut ? "40" : "88")} stroke={color}
                  strokeWidth={t.cls === "corner" ? 2 : 1}
                  strokeDasharray={isCut ? "3 2" : undefined} />
              );
            })}
            {wrapped.hinges.map((h, i) => {
              const [hx, hy] = toWrapPx([h.x, h.y]);
              return (
                <circle key={i} cx={hx} cy={hy} r={3}
                  fill={h.kind === "inside" ? "var(--cobalt)" : "var(--ink-secondary)"}
                  stroke="var(--paper-bright)" strokeWidth={1} />
              );
            })}
          </g>
        </svg>
      )}

      {!hasElev && (
        <div style={{ fontSize: 10.5, color: "var(--ink-muted)", padding: "8px 0", lineHeight: 1.5 }}>
          No elevation preview yet — this wall isn't figured (unscaled sheet, or a reversing/degenerate run).
        </div>
      )}

      {/* Task 3 (2026-08-29 wall-tile-slice-b) — draws this wall's tiled
          elevation strip into a real sheet (buildWallElevationPdf via
          onGenerateElevation, already bound to THIS shape by TakeoffCanvas
          — no argument needed here). Disabled rather than absent when the
          wall isn't figured yet, matching the preview's own "no elevation
          preview yet" messaging above instead of the control just vanishing. */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--ink-faint)" }}>
        <button type="button" disabled={!btn.enabled} onClick={() => onGenerateElevation?.()}
          title={btn.enabled ? "Draw this wall's tiled elevation into a new sheet, scaled and ready to mark up" : "This wall isn't figured yet — nothing to draw"}
          style={{ width: "100%", padding: "5px 10px", border: "1px solid var(--ink-faint)", background: btn.enabled ? "var(--cobalt)" : "var(--paper-bright)", color: btn.enabled ? "var(--paper-bright)" : "var(--ink-muted)", cursor: btn.enabled ? "pointer" : "not-allowed", fontSize: 11, fontFamily: "var(--f-mono)" }}>
          {btn.label}
        </button>
      </div>
    </div>
  );
}

// The cross-room QA list (Task 4 tileWarnings): a sliver, an unscaled sheet,
// a straddled hole, a seam-crossing room needing a human stitch — every row
// carries an `at_norm` focus target for click-to-pan.
function QaList({ warnings, onFocusWarning }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div style={{ padding: "10px 12px" }}>
      <div style={{ fontSize: 10.5, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        QA — {warnings.length} item{warnings.length === 1 ? "" : "s"}
      </div>
      {warnings.map((w, i) => (
        <div key={i} onClick={() => onFocusWarning?.(w)}
          title={w.at_norm ? "Click to pan/zoom to this room" : undefined}
          style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "4px 0", borderTop: i ? "1px solid var(--ink-faint)" : "none", cursor: w.at_norm ? "pointer" : "default" }}>
          <span style={{ color: "var(--c-danger)", fontSize: 10, fontFamily: "var(--f-mono)", textTransform: "uppercase", flexShrink: 0 }}>{w.kind}</span>
          <span style={{ fontSize: 11, color: "var(--ink-secondary)", lineHeight: 1.4 }}>
            {w.finish_tag ? `${w.finish_tag} — ` : ""}{w.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TilePanel({
  layouts, // [{ condId, tag, color, multiplier, ti }] — ti = computeTileTakeoff byCond entry
  selectedShape, // { id, measure_role, tile_layout?, face_side?, endpoint_exposed? } | null
  effectiveConfig, // resolved TileConfig for selectedShape, or null
  // Task 8 (2026-08-29 wall-tile-slice-a, M4/ruling 1) — the SELECTED wall
  // shape's OWN byShape summary: `{ wallStrips, folds, trim, joints }` or
  // `null`. PER-SHAPE, never the condition's `ti` (a byCond entry has no
  // wallStrips/folds — a condition can hold several wall shapes with
  // different geometry). `null` on a floor selection, no selection, or a
  // wall shape this pass hasn't figured yet (unscaled sheet, excluded
  // run) — WallShapeCard must render its controls without it.
  selectedWall,
  // Task 3 (2026-08-29 wall-tile-slice-b) — the selected wall shape's
  // condition finish_tag and the current open sheet-key set, threaded down
  // purely so WallShapeCard's Generate/Regenerate button can compute
  // elevationButtonState (wallElevationPdf.ts) — neither is otherwise
  // available inside this panel (`selectedShape` above deliberately omits
  // condition_id; the sheet list lives on the canvas, not here). `null`/`[]`
  // on a floor selection or no selection, same as `selectedWall`.
  wallTag,
  existingSheetKeys,
  roomSkus, // selectedShape's condition's tile_setup.skus — the band SKU picker's option list (M7 Task 7.3)
  show, onShow,
  onTileSetup, onTileLayout,
  // Task 8 — top-level shape-field writer (face_side, endpoint_exposed),
  // DISTINCT from onTileLayout: those fields live on the shape directly,
  // not nested under tile_layout (shapeCommands.js's `wallFields` command).
  onWallField,
  // Task 2's already-bound handler (TakeoffCanvas.jsx:
  // `() => generateWallElevationSheet(selShape)`) — WallShapeCard calls it
  // with no arguments; this panel does no shape lookup of its own.
  onGenerateElevation,
  warnings, onFocusWarning,
  onClose,
}) {
  const ctl = (on) => ({ padding: "2px 8px", border: `1px solid ${on ? "var(--cobalt)" : "var(--ink-faint)"}`, background: on ? "var(--cobalt)" : "transparent", color: on ? "var(--paper-bright)" : "var(--ink-muted)", cursor: "pointer", fontSize: 10.5, fontFamily: "var(--f-mono)", lineHeight: 1.5 });
  return (
    <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--ink-faint)", background: "var(--paper-bright)", overflow: "hidden", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "var(--ink)", color: "var(--paper-cream)" }}>
        <Icon name="sheets" size={15} />
        <strong style={{ flex: 1, fontSize: 12.5 }}>Tile</strong>
        <button onClick={() => onShow(!show)} title="Draw the tile grid over the plan" style={ctl(show)}>grid</button>
        <button onClick={onClose} title="Close panel" style={{ border: "none", background: "transparent", color: "var(--paper-cream)", fontSize: 16, cursor: "pointer", padding: "0 2px" }}>×</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", fontSize: 12 }}>
        {(!layouts || layouts.length === 0) && (
          <div style={{ padding: 14, color: "var(--ink-muted)", lineHeight: 1.6 }}>
            No tile conditions yet. Open a condition's properties in the Takeoffs
            panel and add a tile setup — its floor areas get figured into tiles here.
          </div>
        )}
        {(layouts || []).map(({ condId, tag, color, multiplier, ti }) => (
          <ConditionCard key={condId} condId={condId} tag={tag} color={color} multiplier={multiplier} ti={ti} onTileSetup={onTileSetup} />
        ))}
        {/* Wall vs floor selection: mutually exclusive cards. A wall shape
            (measure_role "surface_area") gets WallShapeCard (face flip,
            endpoint toggles, elevation preview) instead of RoomOverride —
            origin/rotation/band are a floor room's own per-room knobs and
            don't apply to a wall run. Ruling 5: a floor selection renders
            RoomOverride exactly as before, gated the same way it always was. */}
        {selectedShape && selectedShape.measure_role === "surface_area" ? (
          <WallShapeCard selectedShape={selectedShape} selectedWall={selectedWall} skus={roomSkus} onWallField={onWallField}
            wallTag={wallTag} existingSheetKeys={existingSheetKeys} onGenerateElevation={onGenerateElevation} />
        ) : (
          selectedShape && effectiveConfig && (
            <RoomOverride selectedShape={selectedShape} effectiveConfig={effectiveConfig} skus={roomSkus} onTileLayout={onTileLayout} />
          )
        )}
        <QaList warnings={warnings} onFocusWarning={onFocusWarning} />
      </div>
    </div>
  );
}
