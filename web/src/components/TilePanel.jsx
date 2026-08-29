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
  const skuFor = (slot) => {
    const id = slots[slot];
    const found = id && skus.find((s) => s.id === id);
    return found || defaultSku;
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
  selectedShape, // { id, tile_layout? } | null
  effectiveConfig, // resolved TileConfig for selectedShape, or null
  roomSkus, // selectedShape's condition's tile_setup.skus — the band SKU picker's option list (M7 Task 7.3)
  show, onShow,
  onTileSetup, onTileLayout,
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
        {selectedShape && effectiveConfig && (
          <RoomOverride selectedShape={selectedShape} effectiveConfig={effectiveConfig} skus={roomSkus} onTileLayout={onTileLayout} />
        )}
        <QaList warnings={warnings} onFocusWarning={onFocusWarning} />
      </div>
    </div>
  );
}
