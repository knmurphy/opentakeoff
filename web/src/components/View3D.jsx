// 3D takeoff view — lazy renderer overlay over a scene3d.js scene spec.
// Doctrine: docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md.
// Read-only projection of committed shapes; nothing here feeds back into
// quantities. Axis contract: THREE.Vector3(x, up, w) from scene3d's already-
// final [x, up, w] tuples — no further negation anywhere in this file.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  buildScene, buildRibbon, RIBBON_HALF_FT, FLUSH_HALF_FT, EXCLUDED_COLOR, planPlane,
  ROLL_BAND_ALPHA, ROLL_SEAM_INK_DARK, ROLL_SEAM_INK_LIGHT, ROLL_BAND_RENDER_ORDER, ROLL_SEAM_RENDER_ORDER,
  uvPlanar, gridLines, buildShapeRanges, resolveShapeAt, assertNonIndexed, centroid2,
} from "../lib/scene3d.js";
import { STANDARD_SCALES } from "../lib/sheets.ts";
import { luminance } from "../lib/lineStyles.js";
import { Z, S, SVG } from "../lib/ui.js";
import { areaVal, areaUnit, lenVal, lenUnit, heightVal, heightUnit, thickVal, thickUnit } from "../lib/units.ts";

const LIMITATIONS_TEXT =
  "Schematic view — no wall thickness, no door frames, no casework, flat single-elevation floors, generic base profile, openings deducted-not-shown.";
const EXPORT_FOOTER = "schematic — not as-built; openings deducted, not shown; verify in field";
// Roll-good lane disclosures (spec addendum r3 rev 3): the overlay note shown
// while Rolls is on, and the narrower seam-only caveat appended to the
// EXPORT PNG footer when a roll band/seam is actually visible in the render.
const ROLLS_LIMITS_TEXT =
  "Roll cuts ignore slab holes — bands stripe across holes (existing 2D behavior). Bands show the coverage slab (finished goods) while the 2D cut overlay shows physical cut pieces (which overlap by seam allowance and tuck past walls) — both correct, deliberately different questions. A seam drawn across a concave notch clips to the room, so drawn seam length can be shorter than the priced seam LF when a notch intervenes.";
const ROLLS_EXPORT_CAVEAT = "rolls: drawn seam length may be shorter than the priced seam LF across a concave notch";
const MAX_EXPLODE_FT = 6;
const PLAN_SKIN_OPACITY = 0.4;
const PLAN_SKIN_DROPOPEN_FT = 0.05;
const PLAN_SKIN_RENDER_ORDER = -1;
const PLAN_SKIN_TINT = new THREE.Color(SVG.cobalt).lerp(new THREE.Color("#ffffff"), 0.6);
const EMPTY_SCENE = { slabs: [], ribbons: [], posts: [], notes: [], rolls: { bands: [], seams: [] } }; // stable fallback — never a fresh object per render

// ── Studio aesthetic + picking + labels + textures (spec addendum r4 rev 3) ─
const COLOR_WHITE = new THREE.Color("#ffffff");
const COLOR_BLACK = new THREE.Color("#000000");
const PASTEL_LERP = 0.35;       // part D — fill toward white when Pastel is on
const EDGE_BLACK_LERP = 0.35;   // part D — edge ink = fill lerped toward black
const SELECTION_LERP = 0.5;     // part A — highlight = shape color lerped toward white
const SELECTION_OPACITY = 0.85;
const GRID_Y_FT = -0.045;       // part C — above the plan-skin paper, below slabs
const DEFAULT_TEXTURE_PERIOD_FT = 3; // part B
const CLICK_MAX_TRAVEL_PX = 5;  // part A — pointerdown/up click-vs-drag discriminator
const CLICK_MAX_MS = 400;
const LEADER_LEN_PX = 14;       // part A — label leader line, point → chip corner
const LEADER_GAP_PX = 4;
// Backdrop (part D) — SVG/canvas-context literals mirroring tokens.css, the
// ui.js SVG-literal precedent (var() doesn't resolve in a 2D canvas either).
const HUD_NEAR_BLACK = "#0d1526";   // dark theme — the pre-feature export/caption tone, reused verbatim
const BACKDROP_LIGHT_TOP = "#ffffff";    // --paper-cream
const BACKDROP_LIGHT_BOTTOM = "#e3e9f1"; // --paper-shadow, read as "pale cool-gray"
const FOOTER_INK_LIGHT = "#0d1526"; // --ink (light theme)
const FOOTER_INK_DARK = "#e8eef8";  // pre-existing export footer ink — legible on HUD near-black or plain black

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
// periodFt (spec addendum r4 rev 3, part B) is opt-in: when a manufacturer
// texture is active for this slab's condition, the UV attribute populates
// from uvPlanar fed the BUILT GEOMETRY's own (x, z) position pairs PER
// GEOMETRY VERTEX (post rotate/translate — this IS world space already);
// untextured path deletes the attribute exactly as before (byte-identical).
function slabGeometry(slab, periodFt) {
  const shape = new THREE.Shape(slab.verts_ft.map(([x, w]) => new THREE.Vector2(x, -w)));
  for (const hole of slab.holes_ft) shape.holes.push(new THREE.Path(hole.map(([x, w]) => new THREE.Vector2(x, -w))));
  const depth = Math.max(slab.z1 - slab.z0, 1e-6);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, slab.z0, 0);
  if (periodFt) {
    const pos = geo.attributes.position;
    const pts = [];
    for (let i = 0; i < pos.count; i++) pts.push([pos.getX(i), pos.getZ(i)]);
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvPlanar(pts, periodFt).flat(), 2));
  } else {
    geo.deleteAttribute("uv");
  }
  return geo;
}

// Roll bands/seams: pre-clipped flat polygons (the engine's clipRingToLaneSlab
// output) at slab-top+eps — same (x,-w) winding + rotateX(-90) convention as
// slabGeometry (lands (x, up, w)), but NO extrusion: a coverage/seam stripe
// is a flat decal, not a volume.
function rollPolyGeometry(entry) {
  const shape = new THREE.Shape(entry.poly.map(([x, w]) => new THREE.Vector2(x, -w)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, entry.z, 0);
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

// renderOrder is an ADDITIVE optional param (existing callers omit it and
// keep three's default 0) — the roll bands/seams content effect uses it to
// stack coplanar transparent stripes (bands under seams) without depth-sort.
// recordRanges (spec addendum r4 rev 3, part A) is a further opt-in, 7th
// positional param: ONLY the slab/ribbon/excluded call sites pass it — roll
// band/seam meshes are indexed ShapeGeometry (assertNonIndexed would fire)
// and must stay unreachable by the picking whitelist, so they never pass it.
// Returns the created {mesh, focusVisible} entries so a caller can later
// re-apply a visibility-only toggle (e.g. the Rolls checkbox) without a
// rebuild.
function addMesh(group, items, toGeo, material, focusIds, renderOrder, recordRanges) {
  const created = [];
  for (const { list, visible } of splitByFocus(items, focusIds)) {
    if (!list.length) continue;
    const pairs = recordRanges ? list.map((it) => ({ shapeId: it.shapeId, geometry: toGeo(it) })) : null;
    const geoms = pairs ? pairs.map((p) => p.geometry) : list.map(toGeo);
    const mesh = new THREE.Mesh(mergeToGeometry(geoms), material);
    mesh.visible = visible;
    if (renderOrder != null) mesh.renderOrder = renderOrder;
    if (recordRanges) {
      assertNonIndexed(mesh.geometry, "addMesh"); // resolve-side guard's mirror — record time, per the spec's two-guarded-entry-points contract
      mesh.userData.shapeRanges = buildShapeRanges(pairs);
    }
    group.add(mesh);
    created.push({ mesh, focusVisible: visible });
  }
  return created;
}

// Tags a material with its family + raw (never-pastel-adjusted) color so the
// Pastel walk (applyPastel) can discriminate exempt materials (excluded,
// roll-seam ink, texture-mapped floors) from ordinary fills without guessing
// from other state (spec addendum r4 rev 3, part D).
function tagMaterial(material, family, rawColor) {
  material.userData.family = family;
  material.userData.rawColor = rawColor instanceof THREE.Color ? rawColor.clone() : new THREE.Color(rawColor);
  return material;
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

// ── Picking whitelist (spec addendum r4 rev 3, part A) ──────────────────────
// A mesh qualifies only by carrying the opt-in tags addMesh/posts attach at
// creation — roll bands/seams, the plan plane, grid, edges, highlight, and
// caption sprites carry neither and are unreachable by construction, not by
// a runtime exclusion list.
function collectPickable(scene) {
  const list = [];
  scene.traverse((obj) => {
    if (obj.userData?.shapeRanges || (obj.isInstancedMesh && obj.userData?.shapeIds)) list.push(obj);
  });
  return list;
}

// three's raycaster tests layers, never visibility (Raycaster.intersectObject
// walks children regardless of `.visible`) — every hit needs this explicit
// full parent-chain walk before it can select anything.
function isVisibleChain(obj) {
  let o = obj;
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

function findMeshForShape(scene, shapeId) {
  return collectPickable(scene).find((obj) =>
    obj.isInstancedMesh ? obj.userData.shapeIds.includes(shapeId) : obj.userData.shapeRanges.some((r) => r.shapeId === shapeId)
  ) || null;
}

// The built-scene item (slab/ribbon/post) owning a shapeId, plus which list
// it came from — shared by the selection overlay and the label.
function findBuiltItem(built, shapeId) {
  const slab = built.slabs.find((s) => s.shapeId === shapeId);
  if (slab) return { type: "slab", item: slab };
  const ribbon = built.ribbons.find((r) => r.shapeId === shapeId);
  if (ribbon) return { type: "ribbon", item: ribbon };
  const post = built.posts.find((p) => p.shapeId === shapeId);
  if (post) return { type: "post", item: post };
  return null;
}

function selectionCentroid(found) {
  const { type, item } = found;
  if (type === "post") return new THREE.Vector3(item.pt_ft[0], (item.z0 + item.z1) / 2, item.pt_ft[1]);
  const [x, w] = centroid2(type === "slab" ? item.verts_ft : item.path_ft);
  return new THREE.Vector3(x, (item.z0 + item.z1) / 2, w);
}

// ── Label content (spec addendum r4 rev 3, part A) ──────────────────────────
const fmtNum = (v, d = 2) => v.toLocaleString(undefined, { maximumFractionDigits: d });

function roleQuantityLabel(shape, units) {
  const c = shape.computed || {};
  switch (shape.measure_role) {
    case "floor_area":
    case "deduct":
    case "surface_area":
      return c.area_sf != null ? `${fmtNum(areaVal(c.area_sf, units))} ${areaUnit(units)}` : null;
    case "linear":
      return c.perimeter_lf != null ? `${fmtNum(lenVal(c.perimeter_lf, units))} ${lenUnit(units)}` : null;
    case "count":
      return `${fmtNum(c.count ?? 1, 0)} EA`;
    default:
      return null;
  }
}

// height/thickness ONLY when a real value exists — floors and flush strips
// key off the condition's own thickness_in (the same test buildScene used to
// pick the value in the first place); vertical ribbons and posts key off
// their own `translucent` flag, already set by buildScene when it fell back
// to the nominal visual constant.
function dimensionLabel(item, kind, cond, units) {
  if (kind === "slab" || (kind === "ribbon" && item.mode === "flush")) {
    return Number(cond.thickness_in) > 0
      ? `${fmtNum(thickVal(cond.thickness_in, units), units === "metric" ? 0 : 2)} ${thickUnit(units)}`
      : "nominal";
  }
  return item.translucent ? "nominal" : `${fmtNum(heightVal(item.z1 - item.z0, units), 2)} ${heightUnit(units)}`;
}

function buildLabelLines(shape, item, kind, cond, units) {
  const lines = [];
  if (shape.label) lines.push(String(shape.label));
  lines.push(cond.finish_tag);
  const qty = roleQuantityLabel(shape, units);
  if (qty) lines.push(qty);
  const dim = dimensionLabel(item, kind, cond, units);
  if (dim) lines.push(dim);
  if ((cond.multiplier || 1) > 1) lines.push(`×${cond.multiplier}`);
  return lines;
}

// ── Manufacturer finish textures (spec addendum r4 rev 3, part B) ──────────
function buildFloorTexture(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width || 1;
  canvas.height = img.naturalHeight || img.height || 1;
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // required — ClampToEdge smears instead of tiling
  tex.repeat.set(1, 1);
  return tex;
}

// ── Pastel fills (spec addendum r4 rev 3, part D) ───────────────────────────
// ALL shape materials lerp toward white uniformly EXCEPT: excluded volumes
// (keep the danger read), roll-seam ink (exists for contrast), and a
// texture-mapped floor (the pastel toggle must never wash the texture — it
// is the product). Edge lines recompute from their sibling fill's raw color
// (and that sibling's own exemption, carried as pastelExempt) so an edge
// always reads as "this fill, darkened" rather than drifting independently.
function applyPastel(scene, pastelOn) {
  scene.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      const fam = m.userData?.family;
      if (!fam) continue;
      if (fam === "edge") {
        const fill = m.userData.rawColor.clone();
        if (pastelOn && !m.userData.pastelExempt) fill.lerp(COLOR_WHITE, PASTEL_LERP);
        m.color.copy(fill).lerp(COLOR_BLACK, EDGE_BLACK_LERP);
        continue;
      }
      if (fam === "excluded" || fam === "rollSeam") continue;
      if (fam === "floor" && m.map) continue;
      m.color.copy(m.userData.rawColor);
      if (pastelOn) m.color.lerp(COLOR_WHITE, PASTEL_LERP);
    }
  });
}

export default function View3D({
  shapes, conditions, sheet, focusIds, sheetLabel, onClose, planSkin, rolls,
  onSelectShape, selectedId, isDark, units,
}) {
  const mountRef = useRef(null);
  const labelElRef = useRef(null); // DOM chip wrapper — position mutated every rAF tick, content driven by React (labelData)
  const engineRef = useRef(null); // { renderer, camera, scene, controls, plane }
  const groupsRef = useRef(new Map()); // conditionId -> Group
  const orderRef = useRef([]); // conditionId order, for explode
  const planeRef = useRef(null); // plan-skin mesh, a direct scene child — covered by the mount effect's disposeObject3D(threeScene) walk on unmount
  const rollMeshesRef = useRef([]); // {mesh, focusVisible}[] — rebuilt with content, walked by the Rolls-toggle effect (visibility-only, never a rebuild)
  const highlightRef = useRef(null); // selection-overlay mesh, parented under its shape's own batch mesh
  const structuralRef = useRef({}); // last non-texture content-effect deps, so a texture-only rebuild can skip fitToContent
  const [hidden, setHidden] = useState(() => new Set());
  const [explode, setExplode] = useState(0);
  const [cut, setCut] = useState(null);
  const [cutOn, setCutOn] = useState(false);
  const [planOn, setPlanOn] = useState(true);
  const [planTint, setPlanTint] = useState(false);
  const [planOpacity, setPlanOpacity] = useState(PLAN_SKIN_OPACITY);
  const [rollsOn, setRollsOn] = useState(true); // non-persistent — resets to ON each time the overlay opens (fresh mount)
  const [texState, setTexState] = useState(() => new Map()); // conditionId -> { url, img, period } — runtime-only, never persisted
  const [backdropOn, setBackdropOn] = useState(true);
  const [pastelOn, setPastelOn] = useState(true);
  const [edgesOn, setEdgesOn] = useState(true);
  const [gridOn, setGridOn] = useState(true);

  // Render-body-synced mirrors (the dsRef pattern) for values a persistent
  // rAF/DOM-listener closure (defined once in the mount effect) must read
  // LIVE without re-registering the listener/loop on every render.
  const onSelectShapeRef = useRef(onSelectShape);
  onSelectShapeRef.current = onSelectShape;
  const texStateRef = useRef(texState);
  texStateRef.current = texState;

  const sceneResult = useMemo(() => {
    try { return { data: buildScene({ shapes, conditions, sheet, rolls }) }; }
    catch (err) { return { error: err.message }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sheet is scale-gated on its own primitives
  }, [shapes, conditions, sheet.widthPx, sheet.heightPx, sheet.upp, rolls]);
  const built = sceneResult.data || EMPTY_SCENE;

  const shapeCond = useMemo(() => new Map(shapes.map((s) => [s.id, s.condition_id])), [shapes]);
  const activeConditions = useMemo(() => {
    const ids = new Set();
    for (const list of [built.slabs, built.ribbons, built.posts]) for (const it of list) { const c = shapeCond.get(it.shapeId); if (c) ids.add(c); }
    return conditions.filter((c) => ids.has(c.id));
  }, [built, shapeCond, conditions]);
  const floorConditions = useMemo(() => {
    const ids = new Set();
    for (const s of built.slabs) if (s.kind === "floor") { const c = shapeCond.get(s.shapeId); if (c) ids.add(c); }
    return activeConditions.filter((c) => ids.has(c.id));
  }, [built, shapeCond, activeConditions]);

  const maxCut = useMemo(() => {
    let max = 4;
    for (const s of built.slabs) max = Math.max(max, s.z1);
    for (const r of built.ribbons) max = Math.max(max, r.z1);
    for (const p of built.posts) max = Math.max(max, p.z1);
    return max;
  }, [built]);

  // Selected-shape label: content is a pure derivation (shape + built item +
  // condition + units), memoized so React only re-renders the chip's TEXT
  // when something relevant changes; its SCREEN POSITION is mutated directly
  // on the DOM node every rAF tick (see the mount effect) since the camera
  // moves every frame even when nothing else does.
  const shapes3dById = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);
  const condById = useMemo(() => new Map(conditions.map((c) => [c.id, c])), [conditions]);
  const labelData = useMemo(() => {
    if (selectedId == null) return null;
    const found = findBuiltItem(built, selectedId);
    const shape = found && shapes3dById.get(selectedId);
    const cond = shape && condById.get(shape.condition_id);
    if (!found || !shape || !cond) return null;
    return { worldPos: selectionCentroid(found), lines: buildLabelLines(shape, found.item, found.type, cond, units) };
  }, [selectedId, built, shapes3dById, condById, units]);
  const labelDataRef = useRef(labelData);
  labelDataRef.current = labelData;

  // Mount: renderer/scene/camera/controls once. Owns the animation loop, DPI
  // cap, resize, and the click-to-select pointer discriminator. Unmount runs
  // the pinned dispose chain in order.
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

    // Click-to-select (spec addendum r4 rev 3, part A): OrbitControls owns
    // pointer capture for orbit/pan/zoom; this is a SEPARATE, non-interfering
    // pointerdown/up pair that only decides "was this a click" and, if so,
    // raycasts the shapeRanges/instanceId whitelist.
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 0; // default 1 world ft would swallow ribbon clicks
    const ndc = new THREE.Vector2();
    const pickShapeIdAt = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(collectPickable(threeScene), false);
      for (const hit of hits) {
        if (!isVisibleChain(hit.object)) continue;
        if (hit.object.isInstancedMesh) {
          const shapeId = hit.object.userData.shapeIds?.[hit.instanceId];
          if (shapeId != null) return shapeId;
          continue;
        }
        assertNonIndexed(hit.object.geometry, "View3D pick");
        const shapeId = resolveShapeAt(hit.object.userData.shapeRanges, hit.faceIndex);
        if (shapeId != null) return shapeId;
      }
      return null;
    };
    let pointerDown = null;
    const onPointerDown = (e) => { pointerDown = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; };
    const onPointerUp = (e) => {
      const start = pointerDown;
      pointerDown = null;
      if (e.button !== 0 || !start) return; // right/middle never select
      const travel = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (travel >= CLICK_MAX_TRAVEL_PX || performance.now() - start.t >= CLICK_MAX_MS) return; // a drag, not a click
      onSelectShapeRef.current?.(pickShapeIdAt(e.clientX, e.clientY));
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    // Label reprojection, in the SAME rAF loop that already renders every
    // frame — the camera moves every frame under OrbitControls damping even
    // when nothing else does, so this can't be an effect keyed on selection.
    const updateLabel = () => {
      const el = labelElRef.current;
      if (!el) return;
      const data = labelDataRef.current;
      const highlight = highlightRef.current;
      if (!data || !highlight || !isVisibleChain(highlight)) { el.style.display = "none"; return; }
      const camSpace = data.worldPos.clone().applyMatrix4(camera.matrixWorldInverse);
      if (camSpace.z > 0) { el.style.display = "none"; return; } // behind the camera
      const ndcPos = data.worldPos.clone().project(camera);
      const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
      el.style.display = "block";
      el.style.transform = `translate(${((ndcPos.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-ndcPos.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    };

    let raf;
    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(threeScene, camera); updateLabel(); };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.dispose();
      renderer.forceContextLoss();
      controls.dispose();
      disposeObject3D(threeScene);
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      engineRef.current = null;
      groups.clear();
    };
  }, []);

  // Manufacturer textures (part B): revoke every held object URL on unmount.
  // Clear/switch revoke immediately (see onLoadTexture/onClearTexture below);
  // this is the final backstop for whatever is still loaded when the overlay
  // closes.
  useEffect(() => () => { for (const t of texStateRef.current.values()) URL.revokeObjectURL(t.url); }, []);

  const onLoadTexture = (condId, file) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setTexState((prev) => {
        const old = prev.get(condId);
        if (old) URL.revokeObjectURL(old.url); // switching textures on the same condition
        const next = new Map(prev);
        next.set(condId, { url, img, period: old?.period ?? DEFAULT_TEXTURE_PERIOD_FT });
        return next;
      });
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };
  const onClearTexture = (condId) => {
    setTexState((prev) => {
      const old = prev.get(condId);
      if (!old) return prev;
      URL.revokeObjectURL(old.url);
      const next = new Map(prev);
      next.delete(condId);
      return next;
    });
  };
  const onTexturePeriod = (condId, period) => {
    setTexState((prev) => {
      const old = prev.get(condId);
      if (!old) return prev;
      const next = new Map(prev);
      next.set(condId, { ...old, period });
      return next;
    });
  };

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
    mat.color.set(planTint ? PLAN_SKIN_TINT : "#ffffff");
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
  // texState is a real dependency (a texture toggle repopulates UVs and the
  // floor material's map — a structural rebuild), but fitToContent below
  // only fires when something OTHER than texState changed, so loading a
  // texture never refits the camera mid-orbit (the r3 trap).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { scene: threeScene, plane, camera, controls } = engine;
    for (const g of groupsRef.current.values()) { threeScene.remove(g); disposeObject3D(g); }
    groupsRef.current.clear();
    rollMeshesRef.current = [];
    orderRef.current = activeConditions.map((c) => c.id);
    const clippingPlanes = [plane];

    // Edges (part D): EdgesGeometry per focus BATCH's merged geometry, added
    // as a CHILD of that batch mesh so focus/legend visibility inherits for
    // free. pastelExempt mirrors the sibling fill's OWN pastel exemption so
    // an edge always reads as "this fill, darkened" rather than drifting
    // independently when Pastel toggles.
    const withEdges = (created, pastelExempt) => {
      for (const { mesh } of created) {
        const edgeMat = new THREE.LineBasicMaterial({ clippingPlanes, linewidth: 1 });
        edgeMat.userData.family = "edge";
        edgeMat.userData.rawColor = mesh.material.userData.rawColor.clone();
        edgeMat.userData.pastelExempt = !!pastelExempt;
        const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat);
        line.visible = edgesOn; // toggle effect below mutates this in place; read once at build time
        mesh.add(line);
      }
      return created;
    };

    for (const cond of activeConditions) {
      const group = new THREE.Group();
      const mine = (it) => shapeCond.get(it.shapeId) === cond.id;
      const floor = built.slabs.filter((s) => s.kind === "floor" && mine(s));
      const excluded = built.slabs.filter((s) => s.kind === "excluded" && mine(s));
      const ribbons = built.ribbons.filter(mine);
      const posts = built.posts.filter(mine);
      const color = (floor[0] || ribbons[0] || posts[0])?.color || cond.color || "#888";

      // Floor — manufacturer texture (part B): map on the floor material,
      // tinted by the RAW condition color; UVs populate only when textured.
      const tex = texState.get(cond.id);
      const floorMap = tex ? buildFloorTexture(tex.img) : null;
      const floorMat = tagMaterial(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, clippingPlanes, map: floorMap }), "floor", color);
      withEdges(addMesh(group, floor, (s) => slabGeometry(s, tex?.period), floorMat, focusIds, undefined, true), !!floorMap);

      const ribbonMatSolid = tagMaterial(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, clippingPlanes }), "shape", color);
      withEdges(addMesh(group, ribbons.filter((r) => !r.translucent && !r.derived), (r) => ribbonGeometry(r, ribbonHalf(r)), ribbonMatSolid, focusIds, undefined, true), false);

      const ribbonMatTranslucent = tagMaterial(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.35, clippingPlanes }), "shape", color);
      withEdges(addMesh(group, ribbons.filter((r) => r.translucent), (r) => ribbonGeometry(r, ribbonHalf(r)), ribbonMatTranslucent, focusIds, undefined, true), false);

      const ribbonMatDerived = tagMaterial(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.7, clippingPlanes }), "shape", color);
      withEdges(addMesh(group, ribbons.filter((r) => r.derived && !r.translucent), (r) => ribbonGeometry(r, ribbonHalf(r)), ribbonMatDerived, focusIds, undefined, true), false);

      if (excluded.length) {
        const excludedMat = tagMaterial(new THREE.MeshBasicMaterial({ color: EXCLUDED_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false, clippingPlanes }), "excluded", EXCLUDED_COLOR);
        withEdges(addMesh(group, excluded, slabGeometry, excludedMat, focusIds, undefined, true), true);
      }

      for (const [list, opacity] of [[posts.filter((p) => !p.translucent), 1], [posts.filter((p) => p.translucent), 0.35]]) {
        for (const { list: batch, visible } of splitByFocus(list, focusIds)) {
          if (!batch.length) continue;
          const material = tagMaterial(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: opacity < 1, opacity, clippingPlanes }), "post", color);
          const inst = new THREE.InstancedMesh(POST_GEOMETRY, material, batch.length);
          const m = new THREE.Matrix4();
          batch.forEach((p, i) => { m.makeScale(1, Math.max(p.z1 - p.z0, 1e-3), 1).setPosition(p.pt_ft[0], 0, p.pt_ft[1]); inst.setMatrixAt(i, m); });
          inst.instanceMatrix.needsUpdate = true;
          inst.userData.shapeIds = batch.map((p) => p.shapeId); // picking + selection-overlay lookup
          inst.visible = visible;
          group.add(inst);
        }
      }
      // Roll-good bands/seams: merged mesh per family, parented under this
      // condition's Group via the addMesh -> splitByFocus path (shapeId-
      // keyed — worst case 4 meshes/cond). fill/ink are condition-level
      // (one material per roll-goods condition), so a single merged mesh per
      // family+focus-batch is correct.
      const bands = built.rolls.bands.filter((b) => b.condId === cond.id);
      const seams = built.rolls.seams.filter((s) => s.condId === cond.id);
      if (bands.length) {
        const bandMat = tagMaterial(new THREE.MeshBasicMaterial({
          color: bands[0].fill, side: THREE.DoubleSide, transparent: true, opacity: ROLL_BAND_ALPHA, depthWrite: false, clippingPlanes,
        }), "rollBand", bands[0].fill);
        rollMeshesRef.current.push(...withEdges(addMesh(group, bands, rollPolyGeometry, bandMat, focusIds, ROLL_BAND_RENDER_ORDER), false));
      }
      if (seams.length) {
        const ink = luminance(cond.color) < 0.5 ? ROLL_SEAM_INK_LIGHT : ROLL_SEAM_INK_DARK;
        const seamMat = tagMaterial(new THREE.MeshBasicMaterial({
          color: ink, side: THREE.DoubleSide, transparent: true, depthWrite: false, clippingPlanes,
        }), "rollSeam", ink);
        rollMeshesRef.current.push(...withEdges(addMesh(group, seams, rollPolyGeometry, seamMat, focusIds, ROLL_SEAM_RENDER_ORDER), true));
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
    for (const { mesh, focusVisible } of rollMeshesRef.current) mesh.visible = focusVisible && rollsOn;
    applyPastel(threeScene, pastelOn);

    const prev = structuralRef.current;
    const structuralChanged = prev.built !== built || prev.focusIds !== focusIds || prev.activeConditions !== activeConditions
      || prev.shapeCond !== shapeCond || prev.conditions !== conditions;
    structuralRef.current = { built, focusIds, activeConditions, shapeCond, conditions };
    if (structuralChanged) fitToContent(camera, controls, threeScene);
    // hidden/rollsOn/edgesOn/pastelOn intentionally excluded — a rebuild
    // re-applies their current values from closure; toggling any one alone
    // never lands here (their own effects below mutate in place).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, focusIds, activeConditions, shapeCond, conditions, texState]);

  // Ground grid + axes (part C): declared AFTER the content effect — it
  // measures the just-rebuilt batches via computeVisibleBox. Rebuilt on
  // structural/theme change; the Grid checkbox mutates visibility in place
  // (below), never triggering this rebuild.
  const gridRef = useRef(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (gridRef.current) {
      engine.scene.remove(gridRef.current);
      disposeObject3D(gridRef.current);
      gridRef.current = null;
    }
    const box = computeVisibleBox(engine.scene);
    if (box.isEmpty()) return;
    const { positions, colors } = gridLines({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z }, isDark);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false })); // no clippingPlanes — stated carve-out
    grid.position.y = GRID_Y_FT;
    grid.userData.excludeFromFit = true;
    grid.visible = gridOn; // toggle effect below mutates this in place; read once at build time
    engine.scene.add(grid);
    gridRef.current = grid;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gridOn read once at build; its own toggle effect mutates visibility
  }, [built, focusIds, activeConditions, shapeCond, conditions, isDark]);

  // Selection overlay (part A): declared AFTER content + grid, keyed
  // [selectedId, built] — decoupled from focus/fitToContent entirely. A
  // dedicated highlight mesh, parented under the shape's OWN focus-batch
  // mesh (or InstancedMesh, for a post) so the visibility chain — legend
  // hide, focus isolation — inherits for free. Never a material tint: merged
  // batches share one material per condition, and a tint would light up the
  // whole condition.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (highlightRef.current) {
      highlightRef.current.parent?.remove(highlightRef.current);
      disposeObject3D(highlightRef.current);
      highlightRef.current = null;
    }
    if (selectedId == null) return;
    const found = findBuiltItem(built, selectedId);
    if (!found) return;
    const host = findMeshForShape(engine.scene, selectedId);
    if (!host) return;
    const clippingPlanes = [engine.plane];
    const highlightColor = new THREE.Color(found.item.color || "#ffffff").lerp(COLOR_WHITE, SELECTION_LERP);
    const material = new THREE.MeshBasicMaterial({
      color: highlightColor, side: THREE.DoubleSide, transparent: true, opacity: SELECTION_OPACITY, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, clippingPlanes,
    });
    let mesh;
    if (found.type === "slab") mesh = new THREE.Mesh(slabGeometry(found.item), material);
    else if (found.type === "ribbon") mesh = new THREE.Mesh(ribbonGeometry(found.item, ribbonHalf(found.item)), material);
    else {
      mesh = new THREE.Mesh(POST_GEOMETRY, material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeScale(1, Math.max(found.item.z1 - found.item.z0, 1e-3), 1).setPosition(found.item.pt_ft[0], 0, found.item.pt_ft[1]);
    }
    host.add(mesh);
    highlightRef.current = mesh;
  }, [selectedId, built]);

  // Legend toggles: visibility only, then refit (visible content changed).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const [id, group] of groupsRef.current) group.visible = !hidden.has(id);
    fitToContent(engine.camera, engine.controls, engine.scene);
  }, [hidden]);

  // Rolls toggle: visibility only, mutate in place (the plan-controls
  // pattern) — never a content rebuild or fitToContent (a cosmetic toggle
  // must not reframe the camera). Re-applies each mesh's OWN focus-derived
  // visibility so toggling back ON never un-hides an out-of-focus batch.
  useEffect(() => {
    for (const { mesh, focusVisible } of rollMeshesRef.current) mesh.visible = focusVisible && rollsOn;
  }, [rollsOn]);

  // Pastel toggle: mutate every tagged material's color in place — no
  // rebuild, no refit.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    applyPastel(engine.scene, pastelOn);
  }, [pastelOn]);

  // Edges toggle: visibility only, on the tagged "edge" family LineSegments
  // (never the ground grid, which carries no family tag).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.scene.traverse((obj) => { if (obj.isLineSegments && obj.material?.userData?.family === "edge") obj.visible = edgesOn; });
  }, [edgesOn]);

  // Grid toggle: visibility only.
  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = gridOn;
  }, [gridOn]);

  // Backdrop (part D): scene.background per theme. Off → null (the
  // pre-feature default: renderer's plain black clear). The light gradient
  // is a small CanvasTexture (2 stops, replicated again at export time,
  // since ctx.fillStyle can't take a Texture); dark theme is a flat near-
  // black Color, no texture to dispose.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return undefined;
    if (!backdropOn) { engine.scene.background = null; return undefined; }
    if (isDark) { engine.scene.background = new THREE.Color(HUD_NEAR_BLACK); return undefined; }
    const canvas = document.createElement("canvas");
    canvas.width = 2; canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, BACKDROP_LIGHT_TOP);
    grad.addColorStop(1, BACKDROP_LIGHT_BOTTOM);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; // WebGLBackground reads this — NoColorSpace washes the gradient out
    engine.scene.background = tex;
    return () => tex.dispose();
  }, [backdropOn, isDark]);

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
    // A roll band/seam mesh's OWN .visible already folds rollsOn and focus
    // isolation; its parent condition Group's .visible folds the legend
    // toggle — both must hold for a stripe to actually be in the picture.
    const rollsVisible = rollMeshesRef.current.some(({ mesh }) => mesh.visible && (!mesh.parent || mesh.parent.visible));
    const lightBg = backdropOn && !isDark;
    const img = new Image();
    img.onload = () => {
      const footerH = rollsVisible ? 64 : 46;
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height + footerH;
      const ctx = canvas.getContext("2d");
      // Composites the ACTUAL scene background (part D export fix) so the
      // PNG's footer band matches what's on screen in every Backdrop/theme
      // combination — the image itself already carries the real render.
      if (!backdropOn) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (isDark) {
        ctx.fillStyle = HUD_NEAR_BLACK;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, BACKDROP_LIGHT_TOP);
        grad.addColorStop(1, BACKDROP_LIGHT_BOTTOM);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = lightBg ? FOOTER_INK_LIGHT : FOOTER_INK_DARK;
      ctx.font = "13px monospace";
      const scaleLabel = STANDARD_SCALES.find((s) => Math.abs(s.upp - sheet.upp) < 1e-9)?.label || `${sheet.upp} ft/px`;
      ctx.fillText(`${sheetLabel || "sheet"} · ${scaleLabel} · ${new Date().toLocaleDateString()}`, 14, img.height + 18);
      ctx.fillText(EXPORT_FOOTER, 14, img.height + 36);
      if (rollsVisible) ctx.fillText(ROLLS_EXPORT_CAVEAT, 14, img.height + 54);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${sheetLabel || "sheet"}-3d.png`;
      a.click();
    };
    img.src = raw;
  };

  const toggleHidden = (id) => setHidden((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const chipStyle = { ...S.chip, flexDirection: "column", alignItems: "flex-start", gap: 2, borderRadius: 0, padding: "6px 8px", boxShadow: "var(--shadow-2)", whiteSpace: "nowrap" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: Z.modal, background: "var(--ink)", display: "flex" }}>
      <div ref={mountRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Selection label — a DOM chip at the projected centroid, reprojected
            every rAF tick by the mount effect (transform only); content is
            plain React, driven by labelData. */}
        <div ref={labelElRef} style={{ position: "absolute", left: 0, top: 0, display: "none", pointerEvents: "none", zIndex: 2 }}>
          {labelData && (
            <>
              <div style={{ position: "absolute", left: -3, top: -3, width: 6, height: 6, borderRadius: "50%", background: "var(--ink)" }} />
              <div style={{ position: "absolute", left: 0, top: -LEADER_LEN_PX, width: 1, height: LEADER_LEN_PX, background: "var(--ink)" }} />
              <div style={{ position: "absolute", left: LEADER_GAP_PX, bottom: LEADER_LEN_PX, ...chipStyle }}>
                {labelData.lines.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            </>
          )}
        </div>
      </div>
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
              <div style={S.monoLabel}>Finishes</div>
              {!floorConditions.length && <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>No floor finishes on this sheet.</div>}
              {floorConditions.map((c) => {
                const tex = texState.get(c.id);
                return (
                  <div key={c.id} style={{ padding: "6px 0", borderTop: "1px solid var(--ink-faint)" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.finish_tag}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <label className="btn-ghost" style={{ fontSize: 11.5, padding: "3px 8px", cursor: "pointer" }}>
                        Load
                        <input type="file" accept="image/*" style={{ display: "none" }}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoadTexture(c.id, f); e.target.value = ""; }} />
                      </label>
                      {tex && <button className="btn-ghost" style={{ fontSize: 11.5, padding: "3px 8px" }} onClick={() => onClearTexture(c.id)}>Clear</button>}
                    </div>
                    {tex && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11.5 }}>
                        <span style={{ color: "var(--ink-muted)" }}>Period</span>
                        <input type="number" min={0.25} step={0.25} value={tex.period}
                          onChange={(e) => onTexturePeriod(c.id, Math.max(0.25, Number(e.target.value) || DEFAULT_TEXTURE_PERIOD_FT))}
                          style={{ width: 56, padding: "2px 5px", border: "1px solid var(--ink-faint)", fontSize: 12 }} />
                        <span style={{ color: "var(--ink-muted)" }}>ft</span>
                      </div>
                    )}
                  </div>
                );
              })}
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
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                <input type="checkbox" checked={rollsOn} onChange={(e) => setRollsOn(e.target.checked)} />
                Rolls
              </label>
              {rollsOn && <div style={{ fontSize: 11, color: "var(--ink-muted)", lineHeight: 1.5, marginTop: 4 }}>{ROLLS_LIMITS_TEXT}</div>}
            </div>

            <div style={S.panelSection}>
              <div style={S.monoLabel}>Environment</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                <input type="checkbox" checked={backdropOn} onChange={(e) => setBackdropOn(e.target.checked)} />
                Backdrop
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                <input type="checkbox" checked={pastelOn} onChange={(e) => setPastelOn(e.target.checked)} />
                Pastel
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                <input type="checkbox" checked={edgesOn} onChange={(e) => setEdgesOn(e.target.checked)} />
                Edges
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} />
                Grid
              </label>
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
