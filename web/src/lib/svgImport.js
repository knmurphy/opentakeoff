// Turn an imported .svg into a stamp — a group of `svg` vector-path elements,
// each { type:"svg", path, vb, at, w, color, fill }. Built on svgpath.js, which
// does the heavy lifting: transformPath applies an affine map POINTWISE to every
// coordinate of a `d` and re-emits normalized absolute M/L/C/Q/Z (arcs flattened
// to beziers), and pathBounds gives a control-hull bounding box.
//
// This file has two exports:
//   svgToStamp(...)          — PURE, node-testable: primitives → stamp | null.
//   extractSvgPrimitives(...) — BROWSER (DOMParser): svgText → primitives | null.
// Everything above the browser export is DOM-free and deterministic.

import { transformPath, pathBounds } from "./svgpath.js";

// Default stroke color when a shape declares neither stroke nor a usable fill.
const DEFAULT_COLOR = "#0e1a2e";
// Fixed line weight for imported vector paths (world units); matches stamps.js.
const DEFAULT_W = 0.08;
// Anti-blowup caps: never emit more than this many shapes, and stop once the
// summed output path text passes this size.
const MAX_PRIMITIVES = 400;
const MAX_PATH_CHARS = 200000;

const DRAWABLE = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);

// ── affine matrices ─────────────────────────────────────────────────────────
// Matrices are [a, b, c, d, e, f] with x' = a*x + c*y + e, y' = b*x + d*y + f.
const IDENTITY = [1, 0, 0, 1, 0, 0];

// Compose so the RESULT applies M2 to a point first, then M1: (M1·M2)(p).
function matmul(M1, M2) {
  const [a1, b1, c1, d1, e1, f1] = M1;
  const [a2, b2, c2, d2, e2, f2] = M2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * Apply an affine matrix to a point.
 * @param {number[]} M  [a, b, c, d, e, f]
 * @returns {[number, number]}
 */
export function applyMatrix(M, x, y) {
  return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}

// Build the matrix for a single transform function. Unknown/malformed → null
// (treated as identity by the caller). Missing optional args take SVG defaults.
function funcMatrix(name, args) {
  const num = (i, def) => (i < args.length && Number.isFinite(args[i]) ? args[i] : def);
  const rad = (deg) => (deg * Math.PI) / 180;
  switch (name) {
    case "translate": {
      const tx = num(0, 0);
      const ty = num(1, 0);
      return [1, 0, 0, 1, tx, ty];
    }
    case "scale": {
      const sx = num(0, 1);
      const sy = args.length > 1 ? num(1, sx) : sx;
      return [sx, 0, 0, sy, 0, 0];
    }
    case "rotate": {
      const deg = num(0, 0);
      const cos = Math.cos(rad(deg));
      const sin = Math.sin(rad(deg));
      const R = [cos, sin, -sin, cos, 0, 0];
      if (args.length >= 3) {
        const cx = num(1, 0);
        const cy = num(2, 0);
        // T(cx,cy) · R · T(-cx,-cy)
        return matmul(matmul([1, 0, 0, 1, cx, cy], R), [1, 0, 0, 1, -cx, -cy]);
      }
      return R;
    }
    case "matrix":
      if (args.length >= 6 && args.slice(0, 6).every(Number.isFinite)) {
        return [args[0], args[1], args[2], args[3], args[4], args[5]];
      }
      return null;
    case "skewx":
      return [1, 0, Math.tan(rad(num(0, 0))), 1, 0, 0];
    case "skewy":
      return [1, Math.tan(rad(num(0, 0))), 0, 1, 0, 0];
    default:
      return null;
  }
}

/**
 * Parse an SVG transform string (which may hold several functions) into a single
 * matrix. Functions compose left→right (leftmost is outermost). Empty/invalid → identity.
 * @param {string} str
 * @returns {number[]} [a, b, c, d, e, f]
 */
export function parseTransform(str) {
  let M = IDENTITY.slice();
  if (typeof str !== "string") return M;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const name = m[1].toLowerCase();
    const args = m[2]
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);
    const fm = funcMatrix(name, args);
    if (fm) M = matmul(M, fm);
  }
  return M;
}

// ── shape → local `d` string ────────────────────────────────────────────────
// A finite number from an attribute, or `def` when absent/blank/invalid.
function attrNum(v, def) {
  if (v === undefined || v === null || v === "") return def;
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : def;
}
// Optional number: NaN when the attribute is absent/blank/invalid.
function optNum(v) {
  if (v === undefined || v === null || v === "") return NaN;
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : NaN;
}
// Pull every SVG number out of a points list, in order (comma or space delimited).
function parseNumbers(s) {
  if (typeof s !== "string") return [];
  return (s.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number);
}

/**
 * Convert a primitive to an SVG `d` string in the element's LOCAL coordinates.
 * Missing/invalid required numeric attributes → "" (the shape is skipped).
 * @returns {string}
 */
export function primitiveToPath(tag, attrs) {
  if (!attrs || typeof attrs !== "object") attrs = {};
  switch (tag) {
    case "path":
      return typeof attrs.d === "string" ? attrs.d : "";

    case "rect": {
      const x = attrNum(attrs.x, 0);
      const y = attrNum(attrs.y, 0);
      const w = attrNum(attrs.width, 0);
      const h = attrNum(attrs.height, 0);
      if (!Number.isFinite(x) || !Number.isFinite(y) || w < 0 || h < 0) return "";
      let rx = optNum(attrs.rx);
      let ry = optNum(attrs.ry);
      if (Number.isNaN(rx) && Number.isNaN(ry)) {
        return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
      }
      if (Number.isNaN(rx)) rx = ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (rx <= 0 || ry <= 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
      return (
        `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} ` +
        `V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} ` +
        `H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} ` +
        `V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`
      );
    }

    case "circle": {
      const cx = optNum(attrs.cx === undefined ? "0" : attrs.cx);
      const cy = optNum(attrs.cy === undefined ? "0" : attrs.cy);
      const r = optNum(attrs.r);
      if (Number.isNaN(cx) || Number.isNaN(cy) || Number.isNaN(r) || r <= 0) return "";
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
    }

    case "ellipse": {
      const cx = optNum(attrs.cx === undefined ? "0" : attrs.cx);
      const cy = optNum(attrs.cy === undefined ? "0" : attrs.cy);
      const rx = optNum(attrs.rx);
      const ry = optNum(attrs.ry);
      if (Number.isNaN(cx) || Number.isNaN(cy) || Number.isNaN(rx) || Number.isNaN(ry) || rx <= 0 || ry <= 0) return "";
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
    }

    case "line": {
      const x1 = optNum(attrs.x1);
      const y1 = optNum(attrs.y1);
      const x2 = optNum(attrs.x2);
      const y2 = optNum(attrs.y2);
      if (Number.isNaN(x1) || Number.isNaN(y1) || Number.isNaN(x2) || Number.isNaN(y2)) return "";
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    case "polyline":
    case "polygon": {
      const nums = parseNumbers(attrs.points);
      if (nums.length < 4) return "";
      const pairs = Math.floor(nums.length / 2);
      let d = `M ${nums[0]} ${nums[1]}`;
      for (let i = 1; i < pairs; i++) d += ` L ${nums[2 * i]} ${nums[2 * i + 1]}`;
      if (tag === "polygon") d += " Z";
      return d;
    }

    default:
      return "";
  }
}

// ── color / fill resolution ─────────────────────────────────────────────────
// Parse a style="a:b;c:d" string into a lowercased-key object.
function parseStyle(style) {
  const out = {};
  if (typeof style !== "string") return out;
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i === -1) continue;
    const k = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
// "none" → "none"; absent/blank/currentColor/inherit → null; otherwise the color.
function parseColor(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "" || s === "currentColor" || s === "inherit") return null;
  if (s === "none") return "none";
  return s;
}

// Resolve { color, fill } for one shape. style= wins over presentation attrs.
function resolveColors(attrs) {
  const style = parseStyle(attrs.style);
  const strokeRaw = style.stroke !== undefined ? style.stroke : attrs.stroke;
  const fillRaw = style.fill !== undefined ? style.fill : attrs.fill;
  const strokeP = parseColor(strokeRaw);
  const fillC = parseColor(fillRaw); // "none" | color | null
  const strokeC = strokeP === "none" ? null : strokeP;
  const color = strokeC || (fillC && fillC !== "none" ? fillC : null) || DEFAULT_COLOR;
  const fill = fillC && fillC !== "none" ? fillC : "none";
  return { color, fill };
}

/**
 * @typedef {Object} SvgElement
 * @property {"svg"} type
 * @property {string} path   normalized absolute M/L/C/Q/Z, origin-relative
 * @property {[number, number]} vb   viewbox [width, height] (shared across shapes)
 * @property {[number, number]} at   placement offset, always [0, 0] at build time
 * @property {number} w   line weight in world units
 * @property {string} color   stroke color (hex/name)
 * @property {"none"|string} fill   fill color or "none"
 */

/**
 * Pure: build a stamp from parsed primitives. Returns null when nothing usable.
 *
 * @param {{ primitives?: Array<{tag:string, attrs:object, transforms:string[]}>, name?: string }} [input]
 * @returns {{ name: string, elements: SvgElement[] } | null}
 */
export function svgToStamp({ primitives, name } = {}) {
  if (!Array.isArray(primitives)) return null;

  const baked = []; // { path, color, fill }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let totalLen = 0;

  const limited = primitives.slice(0, MAX_PRIMITIVES);
  for (const prim of limited) {
    if (!prim || typeof prim !== "object") continue;
    const attrs = prim.attrs && typeof prim.attrs === "object" ? prim.attrs : {};
    const transforms = Array.isArray(prim.transforms) ? prim.transforms : [];

    let M = IDENTITY.slice();
    for (const t of transforms) M = matmul(M, parseTransform(t));

    const d = primitiveToPath(prim.tag, attrs);
    if (!d) continue;

    const bakedPath = transformPath(d, (x, y) => applyMatrix(M, x, y));
    if (!bakedPath) continue;

    const b = pathBounds(bakedPath);
    if (!b) continue;

    if (totalLen + bakedPath.length > MAX_PATH_CHARS) break;
    totalLen += bakedPath.length;

    const { color, fill } = resolveColors(attrs);
    baked.push({ path: bakedPath, color, fill });
    if (b[0] < minX) minX = b[0];
    if (b[1] < minY) minY = b[1];
    if (b[2] > maxX) maxX = b[2];
    if (b[3] > maxY) maxY = b[3];
  }

  if (baked.length === 0) return null;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const vw = maxX - minX;
  const vh = maxY - minY;
  if (!(vw >= 1e-6) || !(vh >= 1e-6)) return null;

  const vb = [vw, vh];
  const elements = baked.map(({ path, color, fill }) => ({
    type: "svg",
    path: transformPath(path, (x, y) => [x - minX, y - minY]),
    vb,
    at: [0, 0],
    w: DEFAULT_W,
    color,
    fill,
  }));

  return { name: name || "Imported SVG", elements };
}

// ── browser: DOM parse + extract ────────────────────────────────────────────
// Attribute names worth carrying to the pure layer.
const ATTR_NAMES = [
  "d", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r",
  "x1", "y1", "x2", "y2", "points", "stroke", "fill", "style",
];

function gatherAttrs(el) {
  const o = {};
  for (const name of ATTR_NAMES) {
    if (el.hasAttribute(name)) o[name] = el.getAttribute(name);
  }
  return o;
}

/**
 * Browser-only: parse SVG text into primitives for svgToStamp. Uses DOMParser.
 * Returns null on any failure or when nothing drawable is found. Rejects unsafe
 * content (script/image/foreignObject/use, any href, DOCTYPE/ENTITY).
 *
 * @param {string} svgText
 * @param {{ name?: string }} [opts]
 * @returns {{ primitives: Array<object>, name: string } | null}
 */
export function extractSvgPrimitives(svgText, { name } = {}) {
  try {
    if (typeof svgText !== "string" || svgText.length > 512 * 1024) return null;
    if (/<!DOCTYPE|<!ENTITY/i.test(svgText)) return null;

    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (doc.querySelector("parsererror")) return null;

    const root = doc.querySelector("svg");
    if (!root) return null;

    // Security sweep: disallowed elements and any href (covers xlink:href).
    const banned = new Set(["script", "image", "foreignobject", "use"]);
    for (const el of doc.querySelectorAll("*")) {
      if (banned.has(el.localName.toLowerCase())) return null;
      for (const attr of el.attributes) {
        if (attr.localName && attr.localName.toLowerCase() === "href") return null;
      }
    }

    const primitives = [];
    const walk = (el, ancestors) => {
      for (const child of el.children) {
        const ln = child.localName.toLowerCase();
        const own = child.getAttribute("transform") || "";
        const chain = [...ancestors, own].filter(Boolean);
        if (DRAWABLE.has(ln)) {
          primitives.push({ tag: ln, attrs: gatherAttrs(child), transforms: chain });
        } else if (ln === "g" || ln === "svg") {
          walk(child, chain);
        }
      }
    };
    walk(root, [root.getAttribute("transform") || ""].filter(Boolean));

    if (primitives.length === 0) return null;

    let title = null;
    const titleEl = doc.querySelector("title");
    if (titleEl && typeof titleEl.textContent === "string") title = titleEl.textContent.trim();

    return { primitives, name: name || title || "Imported SVG" };
  } catch {
    return null;
  }
}
