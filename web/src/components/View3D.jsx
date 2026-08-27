// 3D takeoff view — lazy renderer overlay over a scene3d.js scene spec.
// Doctrine: docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md.
// Read-only projection of committed shapes; nothing here feeds back into
// quantities. Axis contract: THREE.Vector3(x, up, w) from scene3d's already-
// final [x, up, w] tuples — no further negation anywhere in this file.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildScene, buildRibbon, RIBBON_HALF_FT, FLUSH_HALF_FT, EXCLUDED_COLOR, planPlane } from "../lib/scene3d.js";
import { STANDARD_SCALES } from "../lib/sheets.ts";
import { Z, S, SVG } from "../lib/ui.js";

const LIMITATIONS_TEXT =
  "Schematic view — no wall thickness, no door frames, no casework, flat single-elevation floors, generic base profile, openings deducted-not-shown.";
const EXPORT_FOOTER = "schematic — not as-built; openings deducted, not shown; verify in field";
const MAX_EXPLODE_FT = 6;
const PLAN_SKIN_OPACITY = 0.4;
const PLAN_SKIN_DROPOPEN_FT = 0.05;
const PLAN_SKIN_RENDER_ORDER = -1;
const PLAN_SKIN_TINT = new THREE.Color(SVG.cobalt).lerp(new THREE.Color("#ffffff"), 0.6);
const EMPTY_SCENE = { slabs: [], ribbons: [], posts: [], notes: [] }; // stable fallback — never a fresh object per render

// Unit post primitive, base-anchored along +Y (this renderer's "up" axis, per
// the Vector3(x, up, w) contract every other mesh here honors), radius 1 —
// the pinned CylinderGeometry(1,1,1,12) dimensions, unit footprint. Read
// literally, rotateX(pi/2)+translate(0,0,0.5) moves the cylinder's long axis
// onto local Z — the SAME slot a per-instance translate.z would need for
// pt[1]/w, and scale(1,1,h) bakes height into that shared slot too, so a
// post's world position drifts with its own height (verified numerically:
// see task-5-report.md). Anchoring along Y instead needs no instance-level
// axis remap and matches every other mesh in the scene.
const POST_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0);

// Floor/excluded slabs: verts_ft/holes_ft are already-final world (x,w) pairs.
// Building the Shape from (x,-w) keeps outer/hole relative winding intact
// (both flip together) while rotateX(-90) on the extrusion lands local
// (x, extrudeDepth, -(-w)) = (x, up, w) — a proper rotation, not a reflection.
function slabGeometry(slab) {
  const shape = new THREE.Shape(slab.verts_ft.map(([x, w]) => new THREE.Vector2(x, -w)));
  for (const hole of slab.holes_ft) shape.holes.push(new THREE.Path(hole.map(([x, w]) => new THREE.Vector2(x, -w))));
  const depth = Math.max(slab.z1 - slab.z0, 1e-6);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, slab.z0, 0);
  geo.deleteAttribute("uv");
  return geo;
}

// buildRibbon's flat (x,w) quad strip is the ribbon's plan-view footprint
// (mitered at joints); each segment's quad (aL,bL,bR,aR) is stood up into a
// closed box spanning z0..z1 to render as a wall/base run.
function ribbonGeometry(ribbon, halfWidth) {
  const { positions } = buildRibbon(ribbon.path_ft, halfWidth);
  const { z0, z1 } = ribbon;
  const verts = [];
  const put = (p, h) => verts.push(p[0], h, p[1]);
  const quad = (a, ah, b, bh, c, ch, d, dh) => { put(a, ah); put(b, bh); put(c, ch); put(a, ah); put(c, ch); put(d, dh); };
  for (let o = 0; o + 12 <= positions.length; o += 12) {
    const aL = [positions[o], positions[o + 1]], bL = [positions[o + 2], positions[o + 3]];
    const bR = [positions[o + 4], positions[o + 5]], aR = [positions[o + 10], positions[o + 11]];
    quad(aL, z1, bL, z1, bR, z1, aR, z1); // top
    quad(aL, z0, aR, z0, bR, z0, bL, z0); // bottom (reversed)
    quad(aL, z0, aL, z1, bL, z1, bL, z0); // sides
    quad(bL, z0, bL, z1, bR, z1, bR, z0);
    quad(bR, z0, bR, z1, aR, z1, aR, z0);
    quad(aR, z0, aR, z1, aL, z1, aL, z0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

const ribbonHalf = (r) => (r.mode === "flush" ? FLUSH_HALF_FT : RIBBON_HALF_FT);

// Focus isolation, two-batch: in-set stays visible, out-of-set is hidden (not
// dimmed) — a separate merged mesh per batch so toggling needs no rebuild.
function splitByFocus(items, focusIds) {
  if (!focusIds) return [{ list: items, visible: true }];
  const inSet = items.filter((i) => focusIds.has(i.shapeId));
  const outSet = items.filter((i) => !focusIds.has(i.shapeId));
  const batches = [];
  if (inSet.length) batches.push({ list: inSet, visible: true });
  if (outSet.length) batches.push({ list: outSet, visible: false });
  return batches;
}

function mergeToGeometry(geoms) {
  if (geoms.length === 1) return geoms[0];
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged;
}

function addMesh(group, items, toGeo, material, focusIds) {
  for (const { list, visible } of splitByFocus(items, focusIds)) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(mergeToGeometry(list.map(toGeo)), material);
    mesh.visible = visible;
    group.add(mesh);
  }
}

function disposeObject3D(root) {
  root.traverse((child) => {
    child.geometry?.dispose();
    const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const m of mats) { m.map?.dispose(); m.dispose(); }
  });
}

function computeVisibleBox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const walk = (obj) => {
    if (!obj.visible || obj.userData.excludeFromFit) return;
    if (obj.isInstancedMesh) {
      obj.computeBoundingBox();
      box.union(obj.boundingBox.clone().applyMatrix4(obj.matrixWorld));
    } else if (obj.isMesh) {
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld));
    } else if (obj.isSprite) {
      box.expandByPoint(obj.getWorldPosition(new THREE.Vector3()));
    }
    for (const c of obj.children) walk(c);
  };
  walk(root);
  return box;
}

// Fit-to-content: bounding sphere + FOV, near-top-down (tiny epsilon off pure
// vertical to dodge the OrbitControls pole singularity) so the initial framing
// reads as the 2D sheet's orientation before the user orbits.
function fitToContent(camera, controls, root) {
  const box = computeVisibleBox(root);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = Math.max(sphere.radius / Math.sin((camera.fov * Math.PI) / 360), 0.5) * 1.2;
  camera.position.set(sphere.center.x, sphere.center.y + dist, sphere.center.z + dist * 1e-3);
  camera.near = Math.max(dist / 200, 0.05);
  camera.far = dist * 30;
  camera.updateProjectionMatrix();
  controls.target.copy(sphere.center);
  controls.update();
}

function makeCaptionSprite(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "26px monospace";
  const padX = 12;
  // Size to the text (plus padding) instead of a fixed 320×56 — a longer
  // note (e.g. "excluded area — see plan") was silently clipped at the old
  // fixed width. measureText needs a font set on the context BEFORE sizing;
  // resizing the canvas afterward resets all context state, so font/fill
  // are re-applied below.
  ctx.font = font;
  const textW = Math.ceil(ctx.measureText(text).width);
  canvas.width = Math.max(textW + padX * 2, 80);
  canvas.height = 56;
  ctx.font = font;
  ctx.fillStyle = "rgba(13,21,38,.85)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8eef8"; ctx.textBaseline = "middle";
  ctx.fillText(text, padX, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  // World scale stays pinned to the original 320×56 → 2.4×0.42 ratio (both
  // axes work out to 0.0075 world units per canvas px), so a wider canvas
  // grows the caption's width in-scene without distorting glyph size.
  sprite.scale.set(canvas.width * (2.4 / 320), 0.42, 1);
  return sprite;
}

export default function View3D({ shapes, conditions, sheet, focusIds, sheetLabel, onClose, planSkin }) {
  const mountRef = useRef(null);
  const engineRef = useRef(null); // { renderer, camera, scene, controls, plane }
  const groupsRef = useRef(new Map()); // conditionId -> Group
  const orderRef = useRef([]); // conditionId order, for explode
  const planeRef = useRef(null); // plan-skin mesh, a direct scene child — covered by the mount effect's disposeObject3D(threeScene) walk on unmount
  const [hidden, setHidden] = useState(() => new Set());
  const [explode, setExplode] = useState(0);
  const [cut, setCut] = useState(null);
  const [cutOn, setCutOn] = useState(false);
  const [planOn, setPlanOn] = useState(true);
  const [planTint, setPlanTint] = useState(false);
  const [planOpacity, setPlanOpacity] = useState(PLAN_SKIN_OPACITY);

  const sceneResult = useMemo(() => {
    try { return { data: buildScene({ shapes, conditions, sheet }) }; }
    catch (err) { return { error: err.message }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sheet is scale-gated on its own primitives
  }, [shapes, conditions, sheet.widthPx, sheet.heightPx, sheet.upp]);
  const built = sceneResult.data || EMPTY_SCENE;

  const shapeCond = useMemo(() => new Map(shapes.map((s) => [s.id, s.condition_id])), [shapes]);
  const activeConditions = useMemo(() => {
    const ids = new Set();
    for (const list of [built.slabs, built.ribbons, built.posts]) for (const it of list) { const c = shapeCond.get(it.shapeId); if (c) ids.add(c); }
    return conditions.filter((c) => ids.has(c.id));
  }, [built, shapeCond, conditions]);

  const maxCut = useMemo(() => {
    let max = 4;
    for (const s of built.slabs) max = Math.max(max, s.z1);
    for (const r of built.ribbons) max = Math.max(max, r.z1);
    for (const p of built.posts) max = Math.max(max, p.z1);
    return max;
  }, [built]);

  // Mount: renderer/scene/camera/controls once. Owns the animation loop, DPI
  // cap and resize. Unmount runs the pinned dispose chain in order.
  useEffect(() => {
    const mount = mountRef.current;
    const groups = groupsRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);
    const threeScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
    engineRef.current = { renderer, camera, scene: threeScene, controls, plane };

    const resize = () => {
      const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf;
    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(threeScene, camera); };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      controls.dispose();
      disposeObject3D(threeScene);
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      engineRef.current = null;
      groups.clear();
    };
  }, []);

  // Plan skin: rebuilds the textured floor plane whenever the source canvas
  // or sheet geometry changes. Runs after the mount effect so the guard
  // below absorbs a first mount that already carries a planSkin prop.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (planeRef.current) {
      engine.scene.remove(planeRef.current);
      disposeObject3D(planeRef.current);
      planeRef.current = null;
    }
    if (!planSkin) return;
    const { wFt, hFt, cx, cw } = planPlane(sheet);
    const geo = new THREE.PlaneGeometry(wFt, hFt).rotateX(-Math.PI / 2);
    const tex = new THREE.CanvasTexture(planSkin.canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, engine.renderer.capabilities.getMaxAnisotropy());
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: planOpacity, depthWrite: false, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, -PLAN_SKIN_DROPOPEN_FT, cw);
    mesh.renderOrder = PLAN_SKIN_RENDER_ORDER;
    mesh.userData.excludeFromFit = true;
    mesh.visible = planOn;
    engine.scene.add(mesh);
    planeRef.current = mesh;
    // planOn/planOpacity read once at build time as the mesh's initial
    // values — the control effect below owns their live updates in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSkin, sheet.widthPx, sheet.heightPx, sheet.upp]);

  // Content: rebuild per-condition Groups from the scene + focus split. A
  // transform-only state change (hidden/explode/cut) never lands here.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { scene: threeScene, plane, camera, controls } = engine;
    for (const g of groupsRef.current.values()) { threeScene.remove(g); disposeObject3D(g); }
    groupsRef.current.clear();
    orderRef.current = activeConditions.map((c) => c.id);
    const clippingPlanes = [plane];

    for (const cond of activeConditions) {
      const group = new THREE.Group();
      const mine = (it) => shapeCond.get(it.shapeId) === cond.id;
      const floor = built.slabs.filter((s) => s.kind === "floor" && mine(s));
      const excluded = built.slabs.filter((s) => s.kind === "excluded" && mine(s));
      const ribbons = built.ribbons.filter(mine);
      const posts = built.posts.filter(mine);
      const color = (floor[0] || ribbons[0] || posts[0])?.color || cond.color || "#888";

      addMesh(group, floor, slabGeometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, clippingPlanes }), focusIds);
      addMesh(group, ribbons.filter((r) => !r.translucent && !r.derived), (r) => ribbonGeometry(r, ribbonHalf(r)),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, clippingPlanes }), focusIds);
      addMesh(group, ribbons.filter((r) => r.translucent), (r) => ribbonGeometry(r, ribbonHalf(r)),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.35, clippingPlanes }), focusIds);
      addMesh(group, ribbons.filter((r) => r.derived && !r.translucent), (r) => ribbonGeometry(r, ribbonHalf(r)),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.7, clippingPlanes }), focusIds);
      if (excluded.length) addMesh(group, excluded, slabGeometry,
        new THREE.MeshBasicMaterial({ color: EXCLUDED_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false, clippingPlanes }), focusIds);

      for (const [list, opacity] of [[posts.filter((p) => !p.translucent), 1], [posts.filter((p) => p.translucent), 0.35]]) {
        for (const { list: batch, visible } of splitByFocus(list, focusIds)) {
          if (!batch.length) continue;
          const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: opacity < 1, opacity, clippingPlanes });
          const inst = new THREE.InstancedMesh(POST_GEOMETRY, material, batch.length);
          const m = new THREE.Matrix4();
          batch.forEach((p, i) => { m.makeScale(1, Math.max(p.z1 - p.z0, 1e-3), 1).setPosition(p.pt_ft[0], 0, p.pt_ft[1]); inst.setMatrixAt(i, m); });
          inst.instanceMatrix.needsUpdate = true;
          inst.userData.shapeIds = batch.map((p) => p.shapeId); // for future picking consumers
          inst.visible = visible;
          group.add(inst);
        }
      }
      threeScene.add(group);
      groupsRef.current.set(cond.id, group);
    }

    const tagToCond = new Map(conditions.map((c) => [c.finish_tag, c]));
    for (const note of built.notes) {
      if (note.kind !== "excluded" || !note.at) continue;
      const cond = tagToCond.get(note.tag);
      const group = cond && groupsRef.current.get(cond.id);
      const slab = built.slabs.find((s) => s.kind === "excluded" && s.tag === note.tag);
      if (!group || !slab) continue;
      const sprite = makeCaptionSprite(note.text);
      sprite.material.clippingPlanes = clippingPlanes;
      sprite.position.set(note.at[0], slab.z1, note.at[1]);
      group.add(sprite);
    }

    for (const [id, group] of groupsRef.current) group.visible = !hidden.has(id);
    fitToContent(camera, controls, threeScene);
    // hidden intentionally excluded — a rebuild re-applies its current value
    // from closure; legend toggles alone never trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, focusIds, activeConditions, shapeCond, conditions]);

  // Legend toggles: visibility only, then refit (visible content changed).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const [id, group] of groupsRef.current) group.visible = !hidden.has(id);
    fitToContent(engine.camera, engine.controls, engine.scene);
  }, [hidden]);

  // Explode: a per-group transform, never a rebuild; framing stays static.
  useEffect(() => {
    orderRef.current.forEach((id, i) => { const g = groupsRef.current.get(id); if (g) g.position.y = i * explode; });
  }, [explode, built]);

  // Section cut: one shared clipping plane; mutually exclusive with explode.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.plane.constant = cutOn && explode === 0 && cut != null ? cut : 1e6;
  }, [cut, cutOn, explode]);

  // Plan skin controls: mutate the existing mesh in place, never a rebuild.
  useEffect(() => {
    const m = planeRef.current;
    if (!m) return;
    m.visible = planOn;
    m.material.color.set(planTint ? PLAN_SKIN_TINT : "#ffffff");
    m.material.opacity = planOpacity;
  }, [planOn, planTint, planOpacity]);

  const resetView = () => { const e = engineRef.current; if (e) fitToContent(e.camera, e.controls, e.scene); };

  const exportPng = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.renderer.render(engine.scene, engine.camera);
    const raw = engine.renderer.domElement.toDataURL("image/png"); // same call stack as render()
    const img = new Image();
    img.onload = () => {
      const footerH = 46;
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height + footerH;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#0d1526"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "#0d1526"; ctx.fillRect(0, img.height, canvas.width, footerH);
      ctx.fillStyle = "#e8eef8"; ctx.font = "13px monospace";
      const scaleLabel = STANDARD_SCALES.find((s) => Math.abs(s.upp - sheet.upp) < 1e-9)?.label || `${sheet.upp} ft/px`;
      ctx.fillText(`${sheetLabel || "sheet"} · ${scaleLabel} · ${new Date().toLocaleDateString()}`, 14, img.height + 18);
      ctx.fillText(EXPORT_FOOTER, 14, img.height + 36);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${sheetLabel || "sheet"}-3d.png`;
      a.click();
    };
    img.src = raw;
  };

  const toggleHidden = (id) => setHidden((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: Z.modal, background: "var(--ink)", display: "flex" }}>
      <div ref={mountRef} style={{ flex: 1, position: "relative" }} />
      <div style={{ width: 260, background: "var(--paper-bright)", borderLeft: "1px solid var(--ink-faint)", overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ ...S.panelSection, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <strong style={{ fontFamily: "var(--f-display)", fontSize: 14 }}>{sheetLabel || "3D view"}</strong>
          <button onClick={onClose} className="btn-ghost" style={{ padding: "3px 8px" }} title="Close">×</button>
        </div>

        {sceneResult.error ? (
          <div style={{ ...S.panelSection, color: "var(--c-danger)", fontSize: 12.5 }}>{sceneResult.error}</div>
        ) : (
          <>
            <div style={S.panelSection}>
              <div style={S.monoLabel}>Conditions</div>
              {activeConditions.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                  <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggleHidden(c.id)} />
                  <span style={{ width: 10, height: 10, background: c.color, display: "inline-block", flexShrink: 0 }} />
                  {c.finish_tag}
                </label>
              ))}
              {!activeConditions.length && <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>Nothing measured on this sheet.</div>}
            </div>

            <div style={S.panelSection}>
              <div style={S.monoLabel}>Plan</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                <input type="checkbox" checked={planOn} onChange={(e) => setPlanOn(e.target.checked)} />
                Show plan
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                <input type="checkbox" checked={planTint} disabled={!planOn} onChange={(e) => setPlanTint(e.target.checked)} />
                Tint
              </label>
              <input type="range" min={0} max={1} step={0.05} value={planOpacity} disabled={!planOn}
                onChange={(e) => setPlanOpacity(Number(e.target.value))} style={{ width: "100%" }} />
              <div style={S.monoReadout}>{Math.round(planOpacity * 100)}%</div>
            </div>

            <div style={S.panelSection}>
              <div style={S.monoLabel}>Explode</div>
              <input type="range" min={0} max={MAX_EXPLODE_FT} step={0.25} value={explode}
                onChange={(e) => setExplode(Number(e.target.value))} disabled={cutOn} style={{ width: "100%" }} />
              <div style={S.monoReadout}>{explode.toFixed(2)} ft</div>
            </div>

            <div style={S.panelSection}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <input type="checkbox" checked={cutOn} disabled={explode > 0}
                  onChange={(e) => { setCutOn(e.target.checked); if (e.target.checked && cut == null) setCut(maxCut / 2); }} />
                <span style={S.monoLabel}>Section cut</span>
              </label>
              <input type="range" min={0} max={maxCut} step={0.05} value={cut ?? maxCut / 2}
                onChange={(e) => setCut(Number(e.target.value))} disabled={!cutOn || explode > 0} style={{ width: "100%" }} />
              <div style={S.monoReadout}>{(cut ?? maxCut / 2).toFixed(2)} ft</div>
            </div>

            {built.notes.length > 0 && (
              <div style={S.panelSection}>
                <div style={S.monoLabel}>Notes</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {built.notes.map((n) => (
                    <span key={`${n.kind}:${n.tag}`} style={{ ...S.chip, width: "fit-content" }}>
                      {n.text.startsWith(n.tag) ? n.text : `${n.tag}: ${n.text}`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ ...S.panelSection, display: "flex", gap: 8 }}>
              <button onClick={resetView} className="btn-ghost" style={{ flex: 1 }}>Reset view</button>
              <button onClick={exportPng} className="btn-primary" style={{ flex: 1 }}>Export PNG</button>
            </div>
          </>
        )}

        <div style={{ ...S.panelSection, marginTop: "auto", fontSize: 11, color: "var(--ink-muted)", lineHeight: 1.5 }}>
          {LIMITATIONS_TEXT}
        </div>
      </div>
    </div>
  );
}
