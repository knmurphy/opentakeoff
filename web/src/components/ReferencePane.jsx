// Read-only second surface (split screen, Task 3). Owns its OWN display
// transform (a local tfRef, NOT the primary pane's tfRef) and its OWN
// wheel/drag pan-zoom scoped to its element — panning/zooming this pane never
// touches the primary pane's transform, and vice versa. Renders the referenced
// sheet's BASE raster (Task 3) plus a read-only mirror of its committed shapes
// (Task 5); crisp detail (Task 6) layers on later. It NEVER handles
// measurement/keyboard/tools — no selection, no vertex handles, no click
// handlers reach the shape overlay below.
//
// `refKey` arrives already validated by the caller (TakeoffCanvas): a
// dangling/unresolvable refKey is reported as `null` here, not as a raw
// string that fails to paint — this component's only "no sheet" branch is
// "refKey is falsy", so validation lives entirely on the caller's side.
// `shapes` likewise arrives already filtered to this refKey and paint-order
// sorted (TakeoffCanvas's `refStackedShapes`, the reference-pane analog of
// the primary's `stackedShapes` — NOT scoped to the primary's sheetGroup, so
// a shape on a sheet the primary isn't even displaying still mirrors here).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MIN_SCALE, MAX_SCALE, SYNC_MS } from "../lib/canvasConstants";
import { HatchPattern } from "./hatches.jsx";
import { renderShapeGlyph } from "./shapeGlyphs.jsx";

export default function ReferencePane({ refKey, panelImg, paintBase, epoch, onFrame, shapes = [], conditions = [], condById = {}, darkMode = false, patId }) {
  const stageRef = useRef(null);
  const tfRef = useRef({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef(null);
  // Throttled mirror of tfRef.current.scale — ONLY for the shape overlay's
  // screen-constant stroke widths below (dividing by scale keeps outlines a
  // constant screen size the way the primary pane's `tf` React-state mirror
  // does). A drag/wheel gesture calls applyTf many times a tick; syncing a
  // React state write on every one of those would reconcile the whole shape
  // overlay that often. ~11Hz (SYNC_MS) matches the primary's own tf-mirror
  // cadence (TakeoffCanvas's scheduleSync).
  const [scale, setScale] = useState(1);
  const scaleSyncRef = useRef({ timer: 0, last: 0, lastScale: 1 });

  const applyTf = useCallback(() => {
    const { x, y, scale: s } = tfRef.current;
    if (stageRef.current) stageRef.current.style.transform = `translate(${x}px,${y}px) scale(${s})`;
    onFrame?.(tfRef.current);
    const sync = scaleSyncRef.current;
    if (s === sync.lastScale || sync.timer) return;
    const wait = Math.max(0, SYNC_MS - (performance.now() - sync.last));
    sync.timer = setTimeout(() => {
      sync.timer = 0; sync.last = performance.now(); sync.lastScale = tfRef.current.scale;
      setScale(tfRef.current.scale);
    }, wait);
  }, [onFrame]);
  useEffect(() => () => { if (scaleSyncRef.current.timer) clearTimeout(scaleSyncRef.current.timer); }, []);
  // Re-apply after every React render so an unrelated re-render (e.g. the
  // primary committing a shape, which re-renders this pane's new `shapes`
  // prop) can never strand the transform at a stale value mid-gesture — same
  // guard the primary pane's own stage keeps (TakeoffCanvas.jsx).
  useLayoutEffect(() => { applyTf(); });

  // fit-to-view when the framed sheet changes (or its dims resolve/change) —
  // deliberately NOT keyed on `epoch`: a repaint-only resync (the primary
  // pane's group changing under it, which tears down and reopens every
  // `ref::`-prefixed compositor entry) must not undo the user's own pan/zoom
  // on this pane.
  useEffect(() => {
    const vp = viewportRef.current; const img = panelImg;
    if (!vp || !img) return;
    const r = vp.getBoundingClientRect();
    const fitScale = Math.min(r.width / img.w, r.height / img.h) * 0.95;
    tfRef.current = { scale: fitScale, x: (r.width - img.w * fitScale) / 2, y: (r.height - img.h * fitScale) / 2 };
    applyTf();
  }, [refKey, panelImg, applyTf]);

  // Imperative addEventListener with { passive: false }, NOT the React
  // onWheel prop — React's synthetic wheel listener is registered passive
  // (matching the browser's own default for `wheel`), so e.preventDefault()
  // inside a JSX onWheel handler throws "Unable to preventDefault inside a
  // passive event listener invocation" instead of blocking page scroll. The
  // primary pane's own wheel handler (TakeoffCanvas.jsx) uses this exact
  // pattern for the same reason.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const vp = el.getBoundingClientRect();
      const t = tfRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
      const k = next / t.scale;
      const cx = e.clientX - vp.left, cy = e.clientY - vp.top;
      tfRef.current = { scale: next, x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k };
      applyTf();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyTf, refKey]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY, tx: tfRef.current.x, ty: tfRef.current.y };
    const move = (ev) => {
      tfRef.current = { ...tfRef.current, x: start.tx + (ev.clientX - start.x), y: start.ty + (ev.clientY - start.y) };
      applyTf();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }, [applyTf]);

  // paint the base raster into our own canvas whenever the sheet changes OR
  // the caller signals a fresh compositor entry (epoch) — e.g. after the
  // primary pane's sheet/group change reset the shared tile compositor and
  // reopened this pane's `ref::`-prefixed entry. paintBase mutates the
  // canvas's pixels/backing store directly — no React re-render needed to
  // reflect it, so no local state tracks the paint itself.
  const canvasRef = useRef(null);
  useEffect(() => {
    if (refKey && canvasRef.current) paintBase(`ref::${refKey}`, canvasRef.current);
  }, [refKey, epoch, paintBase]);

  if (!refKey) return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--ink-soft,#888)" }}>Drop a sheet here</div>
  );

  return (
    <div ref={viewportRef} onPointerDown={onPointerDown}
      style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none", background: "var(--paper, #f4f1ea)" }}>
      <div ref={stageRef} style={{ position: "absolute", transformOrigin: "0 0", width: panelImg?.w, height: panelImg?.h }}>
        {/* CSS width/height stretch the (bounded, coarse-then-budget) base
            backing store up to the sheet's full logical footprint — the same
            "small backing store, CSS-stretched" contract the primary pane's
            base canvases use (TakeoffCanvas's drawPanels base layer). Without
            this the canvas would render at its raw pixel size instead of
            filling the stage. */}
        <canvas ref={canvasRef}
          style={{ position: "absolute", left: 0, top: 0, width: panelImg?.w, height: panelImg?.h, boxShadow: "0 2px 20px rgba(0,0,0,.18)" }} />
        {/* Read-only shape mirror (Task 5). pointerEvents:none end to end —
            no selection, no vertex handles, no click/drag reaches a shape
            here. Sits in the SAME transformed stage as the base canvas above
            (this div's CSS pan/zoom), in the sheet's own local px frame, so
            shapes track the raster under this pane's independent transform
            exactly like the primary's overlay tracks its own stage.
            Every <pattern> id is "ref-"-prefixed (patId(c, "ref-")) so this
            <defs> can NEVER collide with the primary's own <defs> — a
            collision would make url(#…) resolution document-order-dependent
            and corrupt one pane's fills (the reason this task exists). */}
        {panelImg && (
          <svg width={panelImg.w} height={panelImg.h} viewBox={`0 0 ${panelImg.w} ${panelImg.h}`}
            style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }}>
            <defs>
              {conditions.map((c) => <HatchPattern key={patId(c, "ref-")} id={patId(c, "ref-")} type={c.hatch || "solid"} line={c.color} fill={c.fill} dark={darkMode} />)}
            </defs>
            {shapes.map((s) => renderShapeGlyph(s, {
              dn: (vn) => vn.map(([x, y]) => [x * panelImg.w, y * panelImg.h]),
              cond: condById[s.condition_id], sel: false, z: scale, darkMode,
              patId: (c) => patId(c, "ref-"),
            }))}
          </svg>
        )}
      </div>
    </div>
  );
}
