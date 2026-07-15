// Ground-truth label store — issue #127. Pure, DOM-free persistence for the
// click-to-label validation harness.
//
// A label file pins one plan panel's ground truth: the plan basename, the image
// dimensions the seeds were captured at, and a flat list of truth room seeds.
// Each seed is [x, y] in PANEL-LOCAL image px — the exact frame floodRegion /
// oneClickAt seed the flood in (see TakeoffCanvas oneClickAt: `local = [p[0] -
// tp.xOffset, p[1]]`, then floodRegion(mo, local[0], local[1])). Storing the
// dims is load-bearing: a seed is only valid at the render scale that produced
// w/h, so the scorer MUST assert the label dims equal its render dims (or
// rescale) before pointInPoly, else every seed silently shifts.

/** One ground-truth room: an optional room number and its seed in panel-local
 *  image px. */
export interface LabelRoom {
  number?: string;
  /** seed point [x, y] in panel-local image px */
  seed: [number, number];
}

/** A plan's ground-truth label file. */
export interface Labels {
  /** the plan/panel basename this truth is for */
  plan: string;
  /** the panel image px dims the seeds were captured at (render-scale frame) */
  width: number;
  height: number;
  rooms: LabelRoom[];
}

/** An empty label set for a plan captured at the given image dims. */
export function emptyLabels(plan: string, width: number, height: number): Labels {
  return { plan, width, height, rooms: [] };
}

/** Append a room. Pure — returns a new Labels, never mutates. */
export function addRoom(labels: Labels, room: LabelRoom): Labels {
  return { ...labels, rooms: [...labels.rooms, room] };
}

/** Remove the room at `index`. Pure — returns a new Labels, never mutates. An
 *  out-of-range index is a no-op (returns an equivalent new Labels). */
export function removeRoom(labels: Labels, index: number): Labels {
  return { ...labels, rooms: labels.rooms.filter((_, i) => i !== index) };
}

/** Serialize to the on-disk JSON string (stable, pretty-printed). */
export function serialize(labels: Labels): string {
  return JSON.stringify(labels, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isRoom(v: unknown): v is LabelRoom {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r.number !== undefined && typeof r.number !== "string") return false;
  return Array.isArray(r.seed) && r.seed.length === 2 && isNum(r.seed[0]) && isNum(r.seed[1]);
}

/** Parse an on-disk label file, validating the shape. Throws on anything that
 *  isn't a well-formed Labels object (bad JSON, missing dims, malformed seed) so
 *  a corrupt corpus file can't silently score against garbage seeds. */
export function parse(text: string): Labels {
  const v = JSON.parse(text) as unknown;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("labels: not an object");
  const o = v as Record<string, unknown>;
  if (typeof o.plan !== "string") throw new Error("labels: missing plan");
  if (!isNum(o.width) || !isNum(o.height)) throw new Error("labels: missing/invalid dims");
  if (!Array.isArray(o.rooms) || !o.rooms.every(isRoom)) throw new Error("labels: invalid rooms");
  return { plan: o.plan, width: o.width, height: o.height, rooms: o.rooms as LabelRoom[] };
}
