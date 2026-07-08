// Condition appearance primitives — shared by the canvas (shape fills, the
// compact strip) and the TakeoffsPanel (row swatches, the hatch picker).
// TakeoffCanvas already imports TakeoffsPanel, so a TakeoffsPanel -> TakeoffCanvas
// import back would be a cycle; living here instead gives the shared SVG
// primitives a neutral home both files can import without one.

import React from "react";

// Architectural / flooring hatch templates. Each condition gets a line color, a
// fill color (or No Fill), and one hatch style — rendered as an SVG <pattern> so
// finishes read like a real drawing.
export const HATCHES = [
  { id: "solid", label: "Solid" },
  { id: "diag", label: "Diagonal" },
  { id: "diag2", label: "Diagonal reverse" },
  { id: "cross", label: "Crosshatch" },
  { id: "diagdense", label: "Diagonal dense" },
  { id: "horiz", label: "Horizontal" },
  { id: "vert", label: "Vertical" },
  { id: "grid", label: "Square / tile" },
  { id: "brick", label: "Brick / running bond" },
  { id: "plank", label: "Plank / wood" },
  { id: "herring", label: "Herringbone" },
  { id: "basket", label: "Basketweave" },
  { id: "checker", label: "Checker" },
  { id: "wave", label: "Wave / scallop" },
  { id: "dots", label: "Sand / dots" },
  { id: "speckle", label: "Terrazzo / speckle" },
];
export const PALETTE = ["#c96442", "#2f7d54", "#2563eb", "#9333ea", "#b8860b", "#0d9488", "#be185d", "#1f2937", "#dc2626", "#0891b2"];
export const NO_FILL = "none";

// SVG <pattern> for a condition (userSpaceOnUse → scales with the plan, CAD-style).
export function HatchPattern({ id, type, line, fill, dark }) {
  const sw = 1.1;
  // dark mode legibility comes from brighter alphas baked into the pattern —
  // never a CSS filter over the shape overlay (that re-rasterizes the whole
  // layer on every sync)
  const bg = fill && fill !== NO_FILL ? <rect width={10} height={10} fill={fill} opacity={dark ? 0.32 : 0.18} /> : null;
  const s = (d) => <path d={d} stroke={line} strokeWidth={sw} fill="none" />;
  const wrap = (kids) => <pattern id={id} patternUnits="userSpaceOnUse" width={10} height={10}>{bg}{kids}</pattern>;
  switch (type) {
    case "diag": return wrap(s("M0,10 L10,0 M-3,3 L3,-3 M7,13 L13,7"));
    case "diag2": return wrap(s("M0,0 L10,10 M-3,7 L3,13 M7,-3 L13,3"));
    case "cross": return wrap(<>{s("M0,10 L10,0 M-3,3 L3,-3 M7,13 L13,7")}{s("M0,0 L10,10 M-3,7 L3,13 M7,-3 L13,3")}</>);
    case "diagdense": return wrap(s("M0,5 L5,0 M0,10 L10,0 M5,10 L10,5 M-2.5,2.5 L2.5,-2.5 M7.5,12.5 L12.5,7.5"));
    case "horiz": return wrap(s("M0,3 L10,3 M0,7 L10,7"));
    case "vert": return wrap(s("M3,0 L3,10 M7,0 L7,10"));
    case "grid": return wrap(s("M0,3 L10,3 M0,7 L10,7 M3,0 L3,10 M7,0 L7,10"));
    case "brick": return wrap(<>{s("M0,3 L10,3 M0,7 L10,7")}{s("M5,0 L5,3 M0,3 L0,7 M10,3 L10,7 M5,7 L5,10")}</>);
    case "plank": return wrap(<>{s("M0,0 L10,0 M0,5 L10,5 M0,10 L10,10")}{s("M3,0 L3,5 M7,5 L7,10")}</>);
    case "herring": return wrap(<>{s("M0,5 L5,0 L10,5")}{s("M0,10 L5,5 L10,10")}</>);
    case "basket": return wrap(<>{s("M0,2 L5,2 M0,4 L5,4")}{s("M7,0 L7,5 M9,0 L9,5")}{s("M2,5 L2,10 M4,5 L4,10")}{s("M5,7 L10,7 M5,9 L10,9")}</>);
    case "checker": return wrap(<>{<rect x={0} y={0} width={5} height={5} fill={line} opacity={0.4} />}{<rect x={5} y={5} width={5} height={5} fill={line} opacity={0.4} />}</>);
    case "wave": return wrap(<>{s("M0,4 Q2.5,1 5,4 T10,4")}{s("M0,8 Q2.5,5 5,8 T10,8")}</>);
    case "dots": return wrap(<>{[2, 6].map((y) => [2, 6].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} fill={line} />))}</>);
    case "speckle": return wrap(<>{[[1.5, 2, 1.3], [6, 1.5, 0.8], [3.5, 5, 1], [8, 5.5, 1.4], [1.5, 8, 0.9], [6.5, 8.5, 1.2]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={line} />)}</>);
    default: return wrap(null);  // solid: only the fill bg
  }
}

// Preview swatch — renders the ACTUAL pattern so the picker always matches the draw.
export function HatchSwatch({ type, line, fill }) {
  const fc = fill && fill !== NO_FILL ? fill : null;
  const pid = `sw-${type}-${String(line).replace("#", "")}-${String(fill).replace("#", "")}`;
  return (
    <svg width="26" height="18" style={{ display: "block", overflow: "hidden" }}>
      {type !== "solid" && <defs><HatchPattern id={pid} type={type} line={line} fill={fill} /></defs>}
      <rect x="0.5" y="0.5" width="25" height="17" stroke="#a39e8d"
        fill={type === "solid" ? (fc || "#fff") : `url(#${pid})`}
        fillOpacity={type === "solid" ? (fc ? 0.45 : 1) : 1} />
    </svg>
  );
}
