// Sheet region map: which part of a sheet a piece of text sits in — title
// block (and which part of it), a detail viewport, a schedule, notes. Design:
// docs/design/REGION_ANNOTATION.md.
//
// Pure and DOM-free, like planIndex.ts and sheets.ts' text helpers, so it runs
// under node:test and in the MCP session unchanged. This module holds the
// shape, the lookups and the persistence rules; detection lives elsewhere and
// only has to produce a SheetRegions.
//
// Two stores, on purpose:
// - The DETECTED map is a derived cache (IndexedDB, beside the plan index).
//   It depends on the whole set (the title block is found by repetition across
//   sheets), so it is invalidated by a signature of the set, not per file, and
//   a schema or detector change drops it — it is simply rebuilt.
// - User CORRECTIONS are user data (the takeoff document). They are stored in
//   normalized [0..1] coordinates, the app's convention for persisted
//   positions (verts_norm), and laid over the detected map at read time.
//
// Coordinates of the detected map are image px at RENDER_SCALE in the
// DISPLAYED orientation (pdf.js viewports already apply /Rotate), the same
// frame as text-layer tokens and OCR words, so a hit's anchor is looked up
// without conversion.
import type { Bbox } from "./sheetgraph.ts";

export const REGION_MAP_SCHEMA = "opentakeoff.region_map.v1";
/** Bump when detection changes what it would produce: a stored map from an
 *  older detector is dropped and rebuilt rather than trusted. */
export const REGION_DETECTOR_VERSION = 1;

/** Region kinds and the kind each one may sit under. `null` = top level. */
export const REGION_PARENT = {
  title_block: null,
  drawing_area: null,
  // parts of a title block
  firm: "title_block",
  project_info: "title_block",
  sheet_id: "title_block",
  revisions: "title_block",
  seal: "title_block",
  key_plan: "title_block",
  // things in the drawing area
  detail: "drawing_area",
  schedule: "drawing_area",
  legend: "drawing_area",
  general_notes: "drawing_area",
  keynotes: "drawing_area",
  sheet_index: "drawing_area",
  project_directory: "drawing_area",
  code_analysis: "drawing_area",
  vicinity_map: "drawing_area",
  abbreviations: "drawing_area",
  symbols_legend: "drawing_area",
  unclassified: "drawing_area",
} as const satisfies Record<string, string | null>;

export type RegionKind = keyof typeof REGION_PARENT;
export const REGION_KINDS = Object.keys(REGION_PARENT) as RegionKind[];
export const isRegionKind = (k: unknown): k is RegionKind =>
  typeof k === "string" && Object.prototype.hasOwnProperty.call(REGION_PARENT, k);

/** What found a region. `user` is a correction. */
export type RegionSource = "vector" | "ocr" | "layer" | "user";
const SOURCES: readonly RegionSource[] = ["vector", "ocr", "layer", "user"];

/** A detail viewport's title, as read from the sheet. Every field optional:
 *  a title with no scale line is still a title. */
export interface DetailTitle {
  number?: string;     // "3"
  sheet_ref?: string;  // "A-501"
  title?: string;      // "ENLARGED TOILET PLAN"
  scale?: string;      // "1/4\" = 1'-0\""
}

export interface Region {
  /** Stable within the sheet. User-made regions start with "u:". */
  id: string;
  kind: RegionKind;
  /** [x0, y0, x1, y1] — image px for the detected map, [0..1] for overrides. */
  bbox: Bbox;
  parent: string | null;
  /** Free label, e.g. a firm name. For a detail, prefer `detail`. */
  label?: string;
  detail?: DetailTitle;
  /** Which signals found it ("repetition", "frame-lines", "header:GENERAL NOTES", …). */
  evidence: string[];
  /** 0..1 */
  confidence: number;
  source: RegionSource;
}

/** A strip's edge of the sheet. */
export type Edge = "top" | "right" | "bottom" | "left";

/** What a title-block group looks like: the key corrections are matched by.
 *  Ids are derived from it (assignGroupIds) and are handles only — they
 *  change whenever the signature or the membership does. */
export interface GroupSig {
  edge: Edge;
  /** Strip depth from the border, as a fraction of the dimension across the edge. */
  d: number;
  /** w/h bucketed to 0.02 (aspectBucket). */
  aspect: number;
  /** Page size in inches, displayed orientation, when known. */
  page_in?: [number, number];
  /** The group's distinctive static strings, capped (capStatics). */
  statics: string[];
}

/** One sheet's detected regions. `w`/`h` are the image size the bboxes are in. */
export interface SheetRegions {
  key: string;
  w: number;
  h: number;
  /** The border box, image px. Absent: the full sheet. */
  border?: Bbox;
  /** Detected title-block group; corrections to a group apply to every member. */
  group?: string;
  group_sig?: GroupSig;
  regions: Region[];
}

// ── lookup ─────────────────────────────────────────────────────────────────

const area = (b: Bbox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const contains = (b: Bbox, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

function depthOf(byId: Map<string, Region>, r: Region): number {
  let d = 0;
  for (let p = r.parent; p && byId.has(p) && d < REGION_KINDS.length; p = byId.get(p)!.parent) d++;
  return d;
}

/** The deepest region containing (x, y); between regions at the same depth,
 *  the smaller one (the tighter answer). Null when nothing contains it. */
export function regionAt(sheet: SheetRegions, x: number, y: number): Region | null {
  const byId = new Map(sheet.regions.map((r) => [r.id, r]));
  let best: Region | null = null, bestDepth = -1, bestArea = Infinity;
  for (const r of sheet.regions) {
    if (!contains(r.bbox, x, y)) continue;
    const d = depthOf(byId, r), a = area(r.bbox);
    if (d > bestDepth || (d === bestDepth && a < bestArea)) { best = r; bestDepth = d; bestArea = a; }
  }
  return best;
}

/** Root → region, following parents. */
export function regionPath(sheet: SheetRegions, id: string): Region[] {
  const byId = new Map(sheet.regions.map((r) => [r.id, r]));
  const out: Region[] = [];
  for (let r = byId.get(id); r && out.length <= REGION_KINDS.length; r = r.parent ? byId.get(r.parent) : undefined) out.unshift(r);
  return out;
}

const KIND_LABEL: Record<RegionKind, string> = {
  title_block: "Title block", drawing_area: "Drawing area",
  firm: "Firm", project_info: "Project info", sheet_id: "Sheet ID", revisions: "Revisions",
  seal: "Seal", key_plan: "Key plan",
  detail: "Detail", schedule: "Schedule", legend: "Legend", general_notes: "General notes",
  keynotes: "Keynotes", sheet_index: "Sheet index", project_directory: "Project directory",
  code_analysis: "Code analysis", vicinity_map: "Vicinity map", abbreviations: "Abbreviations",
  symbols_legend: "Symbols legend", unclassified: "Unclassified",
};

/** Display name of one region: "Detail 3 – ENLARGED TOILET PLAN", "Firm – ACME ARCHITECTS", "Keynotes". */
export function regionLabel(r: Region): string {
  const base = KIND_LABEL[r.kind];
  if (r.kind === "detail" && r.detail) {
    const head = r.detail.number ? `${base} ${r.detail.number}` : base;
    return r.detail.title ? `${head} – ${r.detail.title}` : head;
  }
  return r.label ? `${base} – ${r.label}` : base;
}

/** The compact form a search hit or an MCP result carries. The drawing area is
 *  left out of the path when something more specific is under it — "Detail 3"
 *  says more than "Drawing area › Detail 3". */
export interface HitRegion {
  id: string;
  kind: RegionKind;
  label: string;
  path: string[];
  detail?: DetailTitle;
  confidence: number;
  source: RegionSource;
}

export function hitRegion(sheet: SheetRegions | null | undefined, x: number, y: number): HitRegion | null {
  if (!sheet) return null;
  const r = regionAt(sheet, x, y);
  if (!r) return null;
  const chain = regionPath(sheet, r.id);
  const shown = chain.length > 1 ? chain.filter((c) => c.kind !== "drawing_area") : chain;
  return {
    id: r.id, kind: r.kind, label: regionLabel(r), path: shown.map(regionLabel),
    ...(r.detail ? { detail: r.detail } : {}),
    confidence: r.confidence, source: r.source,
  };
}

/** "A-501 › Detail 3 – ENLARGED TOILET PLAN" */
export const formatHitRegion = (sheetNo: string | null | undefined, h: HitRegion): string =>
  [sheetNo, ...h.path].filter(Boolean).join(" › ");

// ── validation ─────────────────────────────────────────────────────────────

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

function cleanBbox(b: unknown): Bbox | null {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(finite)) return null;
  const [x0, y0, x1, y1] = b as number[];
  const out: Bbox = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  return area(out) > 0 ? out : null;
}

const clampBbox = (b: Bbox, { w, h }: { w: number; h: number }): Bbox | null => {
  const out: Bbox = [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(w, b[2]), Math.min(h, b[3])];
  return out[2] > out[0] && out[3] > out[1] ? out : null;
};
const clampTo = (r: Region, dims: { w: number; h: number }): Region | null => {
  const b = clampBbox(r.bbox, dims);
  return b ? { ...r, bbox: b } : null;
};

function cleanDetail(d: unknown): DetailTitle | undefined {
  if (!d || typeof d !== "object") return undefined;
  const o = d as Record<string, unknown>;
  const out: DetailTitle = {};
  for (const k of ["number", "sheet_ref", "title", "scale"] as const) { const v = str(o[k]); if (v) out[k] = v; }
  return Object.keys(out).length ? out : undefined;
}

const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];

/** A stored signature, or undefined when any required part is malformed.
 *  Static strings are re-capped, so a stored one can't outgrow the limits. */
export function cleanGroupSig(raw: unknown): GroupSig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (!EDGES.includes(o.edge as Edge) || !finite(o.d) || o.d < 0 || o.d > 1 || !finite(o.aspect) || o.aspect <= 0) return undefined;
  if (!Array.isArray(o.statics)) return undefined;
  const p = o.page_in;
  const page = Array.isArray(p) && p.length === 2 && p.every((n) => finite(n) && n > 0) ? ([p[0], p[1]] as [number, number]) : undefined;
  return {
    edge: o.edge as Edge, d: o.d, aspect: o.aspect,
    ...(page ? { page_in: page } : {}),
    statics: capStatics(o.statics.filter((x): x is string => typeof x === "string")),
  };
}

function cleanRegion(raw: unknown): Region | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id, 64);
  const bbox = cleanBbox(o.bbox);
  if (!id || !isRegionKind(o.kind) || !bbox) return null;
  const label = str(o.label);
  const detail = cleanDetail(o.detail);
  return {
    id, kind: o.kind, bbox,
    parent: typeof o.parent === "string" && o.parent ? o.parent : null,
    ...(label ? { label } : {}),
    ...(detail ? { detail } : {}),
    evidence: Array.isArray(o.evidence) ? o.evidence.filter((e): e is string => typeof e === "string").slice(0, 16) : [],
    confidence: finite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : 0,
    source: SOURCES.includes(o.source as RegionSource) ? (o.source as RegionSource) : "vector",
  };
}

/** Make a region list safe to use: drop malformed entries and duplicate ids,
 *  then keep only regions whose parent exists, is the right kind for them
 *  (REGION_PARENT), and holds them — a child is clipped to its parent and
 *  dropped when nothing is left. Top-level kinds must have no parent.
 *  Parents are resolved before children, so the check runs in tree order and
 *  a cycle can't survive (a region in a cycle never finds a kept parent).
 *  With `dims`, top-level regions are clamped to [0,w]×[0,h] (and dropped
 *  when nothing is left); every caller holding a SheetRegions passes them. */
export function cleanRegions(raw: unknown, dims?: { w: number; h: number }): Region[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const pending: Region[] = [];
  for (const e of raw) {
    const r = cleanRegion(e);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    pending.push(r);
  }
  const kept = new Map<string, Region>();
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      const want = REGION_PARENT[r.kind];
      let ok: Region | null | undefined;
      if (want === null) ok = r.parent !== null ? null : dims ? clampTo(r, dims) : r;
      else if (r.parent === null) ok = null;
      else if (!kept.has(r.parent)) {
        // parent not placed yet: wait, unless it can never be placed
        if (seen.has(r.parent) && pending.some((p) => p.id === r.parent)) continue;
        ok = null;
      } else {
        const p = kept.get(r.parent)!;
        if (p.kind !== want) ok = null;
        else {
          const b: Bbox = [Math.max(r.bbox[0], p.bbox[0]), Math.max(r.bbox[1], p.bbox[1]), Math.min(r.bbox[2], p.bbox[2]), Math.min(r.bbox[3], p.bbox[3])];
          ok = area(b) > 0 ? { ...r, bbox: b } : null;
        }
      }
      if (ok) kept.set(ok.id, ok);
      pending.splice(i--, 1);
      progress = true;
    }
  }
  // anything still pending waits on a parent that is itself stuck: a cycle
  return [...kept.values()];
}

// ── title-block groups ─────────────────────────────────────────────────────

export const aspectBucket = (w: number, h: number): number => Number((Math.round(w / h / 0.02) * 0.02).toFixed(2));

const MAX_STATICS = 20;
const MAX_STATIC_LEN = 80;

/** The static strings a signature keeps: at most 20, each at most 80
 *  characters, longest first and then lexicographic (by code unit, not
 *  locale), so the choice doesn't depend on input order. */
export function capStatics(list: readonly string[]): string[] {
  const set = new Set<string>();
  for (const s of list) { const t = s.trim().slice(0, MAX_STATIC_LEN); if (t) set.add(t); }
  return [...set].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_STATICS);
}

/** FNV-1a, 32 bit, as 8 hex digits. Not cryptographic; ids only need to be
 *  short and deterministic, and assignGroupIds disambiguates collisions. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const sigText = (s: GroupSig): string => JSON.stringify([s.edge, s.d, s.aspect, s.page_in ?? null, capStatics(s.statics)]);

/** Ids for a set's clusters, in input order: "g:" + a hash of the signature.
 *  Clusters that share a hash (equal signatures, e.g. two statics-free
 *  singletons with the same geometry, or a collision) are ordered by their
 *  smallest member key and get "-1", "-2", …, so ids are unique in a map. */
export function assignGroupIds(clusters: readonly { sig: GroupSig; keys: readonly string[] }[]): string[] {
  const base = clusters.map((c) => `g:${fnv1a(sigText(c.sig))}`);
  const minKey = clusters.map((c) => [...c.keys].sort()[0] ?? "");
  const byBase = new Map<string, number[]>();
  base.forEach((b, i) => byBase.set(b, [...(byBase.get(b) ?? []), i]));
  const ids = [...base];
  for (const [b, idx] of byBase) {
    if (idx.length < 2) continue;
    idx.sort((i, j) => (minKey[i] < minKey[j] ? -1 : minKey[i] > minKey[j] ? 1 : i - j));
    idx.forEach((i, n) => { ids[i] = `${b}-${n + 1}`; });
  }
  return ids;
}

// ── detected map: persistence ──────────────────────────────────────────────

/** Signature of the plan set the map was built from. Any file added, removed
 *  or re-read changes it, and the whole map is rebuilt: repetition across
 *  sheets means one reissued sheet can move every sheet's title block. */
export function setSignature(files: Iterable<{ file: string; builtAt: number }>): string {
  return [...files]
    .map((f) => `${f.file}@${finite(f.builtAt) ? f.builtAt : 0}`)
    .sort()
    .join("|");
}

export interface PersistedRegionMap {
  schema: string;
  detector: number;
  signature: string;
  sheets: SheetRegions[];
}

export function serializeRegionMap(map: Map<string, SheetRegions>, signature: string): PersistedRegionMap {
  return { schema: REGION_MAP_SCHEMA, detector: REGION_DETECTOR_VERSION, signature, sheets: [...map.values()] };
}

/** Rehydrate a stored map. A different schema, detector or set signature
 *  drops everything — the map is a cache, and rebuilding is the safe way to
 *  fail. Malformed sheets and regions are dropped one by one. */
export function sanitizeRegionMap(raw: unknown, signature: string): Map<string, SheetRegions> {
  const out = new Map<string, SheetRegions>();
  const o = raw as PersistedRegionMap | undefined;
  if (!o || typeof o !== "object" || o.schema !== REGION_MAP_SCHEMA || o.detector !== REGION_DETECTOR_VERSION) return out;
  if (o.signature !== signature || !Array.isArray(o.sheets)) return out;
  for (const s of o.sheets) {
    if (!s || typeof s !== "object") continue;
    const key = str(s.key, 512);
    if (!key || out.has(key) || !finite(s.w) || !finite(s.h) || s.w <= 0 || s.h <= 0) continue;
    const dims = { w: s.w, h: s.h };
    const group = str(s.group, 64);
    const bb = cleanBbox(s.border);
    const border = bb ? clampBbox(bb, dims) : null;
    const sig = cleanGroupSig(s.group_sig);
    out.set(key, {
      key, w: s.w, h: s.h,
      ...(border ? { border } : {}), ...(group ? { group } : {}), ...(sig ? { group_sig: sig } : {}),
      regions: cleanRegions(s.regions, dims),
    });
  }
  return out;
}

// ── user corrections ───────────────────────────────────────────────────────

/** Corrections, stored in the takeoff document. Bboxes are normalized [0..1].
 *
 *  - `groups[g]` is a title-block template: the title block and its parts,
 *    drawn or fixed once, applied to every sheet of the group its
 *    `group_sig` resolves to (resolveOverrides). The key g is only a hint:
 *    group ids change with the signature and the membership.
 *  - `sheet_group[key]` moves a sheet to a group by hand; it outranks the
 *    detected group. `sig` is the target group's signature at the time of
 *    the move, and is what the move resolves by.
 *  - `sheets[key]` is per sheet: regions to drop (by detected id, children
 *    go with them) and regions to add (details, notes, …). */
export interface RegionOverrides {
  groups?: Record<string, { source_sheet: string; group_sig?: GroupSig; regions: Region[] }>;
  sheet_group?: Record<string, { group: string; sig: GroupSig }>;
  sheets?: Record<string, { removed?: string[]; regions?: Region[] }>;
}

const TITLE_BLOCK_KINDS = new Set<RegionKind>(REGION_KINDS.filter((k) => k === "title_block" || REGION_PARENT[k] === "title_block"));
const inUnit = (b: Bbox) => b.every((n) => n >= 0 && n <= 1);
const asUser = (r: Region): Region => ({ ...r, source: "user", confidence: 1 });

/** Sanitize corrections read from a document. Unknown shapes are dropped
 *  field by field; a template keeps only title-block kinds; a bbox outside
 *  [0..1] is dropped (these are normalized). */
export function sanitizeRegionOverrides(raw: unknown): RegionOverrides {
  const out: RegionOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  const norm = (list: unknown) => cleanRegions(list).filter((r) => inUnit(r.bbox)).map(asUser);
  if (o.groups && typeof o.groups === "object" && !Array.isArray(o.groups)) {
    const groups: NonNullable<RegionOverrides["groups"]> = {};
    for (const [g, v] of Object.entries(o.groups as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const t = v as Record<string, unknown>;
      const src = str(t.source_sheet, 512);
      const regions = norm(t.regions).filter((r) => TITLE_BLOCK_KINDS.has(r.kind));
      // a template without a (valid) signature is kept, but never applied
      const sig = cleanGroupSig(t.group_sig);
      if (src && regions.length) groups[g] = { source_sheet: src, ...(sig ? { group_sig: sig } : {}), regions };
    }
    if (Object.keys(groups).length) out.groups = groups;
  }
  if (o.sheet_group && typeof o.sheet_group === "object" && !Array.isArray(o.sheet_group)) {
    // the old string form (a bare group id) is dropped: no documents use it
    const sg: NonNullable<RegionOverrides["sheet_group"]> = {};
    for (const [k, v] of Object.entries(o.sheet_group as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const t = v as Record<string, unknown>;
      const group = str(t.group, 64), sig = cleanGroupSig(t.sig);
      if (group && sig) sg[k] = { group, sig };
    }
    if (Object.keys(sg).length) out.sheet_group = sg;
  }
  if (o.sheets && typeof o.sheets === "object" && !Array.isArray(o.sheets)) {
    const sheets: NonNullable<RegionOverrides["sheets"]> = {};
    for (const [k, v] of Object.entries(o.sheets as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const t = v as Record<string, unknown>;
      const removed = Array.isArray(t.removed) ? [...new Set(t.removed.filter((x): x is string => typeof x === "string" && !!x))] : [];
      // a sheet's added regions may hang off a detected parent, so they are
      // not tree-checked here — that happens once they meet the detected map
      const regions = Array.isArray(t.regions)
        ? t.regions.map(cleanRegion).filter((r): r is Region => !!r && inUnit(r.bbox)).map(asUser)
        : [];
      if (removed.length || regions.length) sheets[k] = { ...(removed.length ? { removed } : {}), ...(regions.length ? { regions } : {}) };
    }
    if (Object.keys(sheets).length) out.sheets = sheets;
  }
  return out;
}

// ── resolving corrections ──────────────────────────────────────────────────

/** A detected group: its signature and member sheet keys. */
export interface GroupInfo { sig: GroupSig; members: string[] }

/** The groups of a detected map. Sheets without a group or a signature are
 *  in no group a correction can resolve to. */
export function mapGroups(map: ReadonlyMap<string, SheetRegions>): Map<string, GroupInfo> {
  const out = new Map<string, GroupInfo>();
  for (const s of map.values()) {
    if (!s.group || !s.group_sig) continue;
    const g = out.get(s.group);
    if (g) g.members.push(s.key);
    else out.set(s.group, { sig: s.group_sig, members: [s.key] });
  }
  return out;
}

export type UnattachedReason = "no-match" | "ambiguous" | "no-sig" | "no-anchor" | "conflict";
export type GroupMatch = { group: string; score: number } | { group: null; reason: UnattachedReason };

const D_TOL = 0.015;          // |Δd|, fraction of the dimension across the edge
const PAGE_TOL_IN = 0.01;     // page sizes are "equal" to this, per axis (rounding only)
const MIN_JACCARD = 0.5;
const MIN_LEAD = 0.2;         // best Jaccard over the second-best group
const EPS = 1e-9;

const samePage = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) <= PAGE_TOL_IN + EPS && Math.abs(a[1] - b[1]) <= PAGE_TOL_IN + EPS;

const sameGeometry = (a: GroupSig, b: GroupSig) =>
  a.edge === b.edge && Math.abs(a.aspect - b.aspect) < EPS && Math.abs(a.d - b.d) <= D_TOL + EPS &&
  (!a.page_in || !b.page_in || samePage(a.page_in, b.page_in));

function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a), B = new Set(b);
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  const union = A.size + B.size - both;
  return union ? both / union : 1;
}

/** The group a signature (a template's, or a move's target) resolves to.
 *
 *  - Geometry first: same edge and aspect bucket, |Δd| ≤ 1.5%, and the same
 *    page size when both know it.
 *  - With static strings: only groups with statics; the best Jaccard must be
 *    ≥ 0.5 and beat the second best by ≥ 0.2 (else `ambiguous`). The score
 *    is that Jaccard.
 *  - Without static strings (a template made on a cover or a sketch): only
 *    statics-free groups, and only with a second anchor — the source sheet
 *    is a member, or the page size is known on both sides and exactly one
 *    statics-free group passes. A source sheet that now sits in a group
 *    with statics resolves to nothing, on purpose: otherwise removing a
 *    cover could send its correction to the architect group that shares
 *    its geometry. The score is 1 (two empty sets are identical).
 *  Groups with equal signatures (assignGroupIds' -1, -2) always tie here, so
 *  a correction never picks between them. */
export function matchGroup(sig: GroupSig, groups: ReadonlyMap<string, GroupInfo>, sourceSheet?: string): GroupMatch {
  const fits = [...groups].filter(([, g]) => sameGeometry(sig, g.sig));
  if (sig.statics.length) {
    const scored = fits.filter(([, g]) => g.sig.statics.length)
      .map(([id, g]) => ({ id, j: jaccard(sig.statics, g.sig.statics) }))
      .sort((a, b) => b.j - a.j);
    const [best, second] = scored;
    if (!best || best.j < MIN_JACCARD - EPS) return { group: null, reason: "no-match" };
    if (second && best.j - second.j < MIN_LEAD - EPS) return { group: null, reason: "ambiguous" };
    return { group: best.id, score: best.j };
  }
  if (sourceSheet) {
    const home = [...groups].find(([, g]) => g.members.includes(sourceSheet));
    if (home && home[1].sig.statics.length) return { group: null, reason: "no-match" };
    if (home && fits.some(([id]) => id === home[0])) return { group: home[0], score: 1 };
  }
  // a group of unknown page size passes the geometric test too, so it
  // counts toward "exactly one" even though it can't anchor on its own
  const free = fits.filter(([, g]) => !g.sig.statics.length);
  if (!free.length) return { group: null, reason: "no-match" };
  if (!sig.page_in) return { group: null, reason: "no-anchor" };
  if (free.length > 1) return { group: null, reason: "ambiguous" };
  const [id, only] = free[0];
  return only.sig.page_in ? { group: id, score: 1 } : { group: null, reason: "no-anchor" };
}

/** Corrections resolved against a detected map. The web app and the MCP both
 *  consume this; `unattached` is what matched nothing and must be shown. */
export interface ResolvedOverrides {
  templates: Record<string /*template key*/, { group: string; score: number }>;
  moves: Record<string /*sheet key*/, string /*group id*/>;
  unattached: { kind: "template" | "move"; key: string; reason: UnattachedReason }[];
}

const byKey = <T,>(rec: Record<string, T> | undefined): [string, T][] =>
  Object.entries(rec ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Resolve every template and move by signature. Pure: nothing is written,
 *  so stale ids in the document stay stale until the caller saves.
 *  Two templates on one group: the higher score wins, then the smaller
 *  |Δd|; a tie applies neither. Losers are `conflict`. A move whose sheet
 *  is not in the map is reported as `no-match`. */
export function resolveOverrides(map: ReadonlyMap<string, SheetRegions>, ov: RegionOverrides): ResolvedOverrides {
  const groups = mapGroups(map);
  const out: ResolvedOverrides = { templates: {}, moves: {}, unattached: [] };
  const claims = new Map<string, { key: string; score: number; dd: number }[]>();
  const lost: ResolvedOverrides["unattached"] = [];
  for (const [key, t] of byKey(ov.groups)) {
    if (!t.group_sig) { lost.push({ kind: "template", key, reason: "no-sig" }); continue; }
    const m = matchGroup(t.group_sig, groups, t.source_sheet);
    if (m.group === null) { lost.push({ kind: "template", key, reason: m.reason }); continue; }
    const dd = Math.abs(t.group_sig.d - groups.get(m.group)!.sig.d);
    claims.set(m.group, [...(claims.get(m.group) ?? []), { key, score: m.score, dd }]);
  }
  for (const [group, list] of claims) {
    list.sort((a, b) => (Math.abs(b.score - a.score) > EPS ? b.score - a.score : a.dd - b.dd));
    const [win, next] = list;
    const tie = next && Math.abs(win.score - next.score) <= EPS && Math.abs(win.dd - next.dd) <= EPS;
    if (!tie) out.templates[win.key] = { group, score: win.score };
    for (const c of tie ? list : list.slice(1)) lost.push({ kind: "template", key: c.key, reason: "conflict" });
  }
  lost.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  out.unattached.push(...lost);
  for (const [key, mv] of byKey(ov.sheet_group)) {
    // a move for a sheet no longer in the set moves nothing, and is shown
    if (!map.has(key)) { out.unattached.push({ kind: "move", key, reason: "no-match" }); continue; }
    const m = matchGroup(mv.sig, groups);
    if (m.group === null) out.unattached.push({ kind: "move", key, reason: m.reason });
    else out.moves[key] = m.group;
  }
  return out;
}

/** The group a sheet belongs to: a resolved manual move wins over detection. */
export const groupOf = (map: ReadonlyMap<string, SheetRegions>, ov: RegionOverrides, key: string): string | undefined =>
  resolveOverrides(map, ov).moves[key] ?? map.get(key)?.group;

const toPx = (r: Region, w: number, h: number): Region => ({ ...r, bbox: [r.bbox[0] * w, r.bbox[1] * h, r.bbox[2] * w, r.bbox[3] * h] });

/** px bbox → normalized, for turning a region the user drew into an override. */
export const toNormBbox = (b: Bbox, w: number, h: number): Bbox => [b[0] / w, b[1] / h, b[2] / w, b[3] / h];

/** The border box minus a title-block strip. The strip's edge is the border
 *  side it touches: the side from which its far (inner) edge is nearest, as
 *  a fraction of the border box — a gap between border and strip is counted
 *  once, inside that distance. A bottom strip drawn border to border touches
 *  the left and right sides too, but its far edge there is the whole width
 *  away. The cut is clipped to the border box, so a strip drawn partly or
 *  wholly in the margin never pushes the drawing area past the border. */
function drawingAreaBesides(border: Bbox, strip: Bbox): Bbox {
  const [x0, y0, x1, y1] = border;
  const bw = x1 - x0, bh = y1 - y0;
  const cx = (x: number) => Math.min(x1, Math.max(x0, x)), cy = (y: number) => Math.min(y1, Math.max(y0, y));
  const sides: [Edge, number, Bbox][] = [
    ["top", (strip[3] - y0) / bh, [x0, cy(strip[3]), x1, y1]],
    ["right", (x1 - strip[0]) / bw, [x0, y0, cx(strip[0]), y1]],
    ["bottom", (y1 - strip[1]) / bh, [x0, y0, x1, cy(strip[1])]],
    ["left", (strip[2] - x0) / bw, [cx(strip[2]), y0, x1, y1]],
  ];
  return sides.reduce((a, b) => (b[1] < a[1] ? b : a))[2];
}

/** Replace the drawing area's box, keeping its id so its children keep their
 *  parent (cleanRegions clips them to it). None detected: one is added. */
function withDrawingArea(regions: Region[], bbox: Bbox): Region[] {
  const da = regions.find((r) => r.kind === "drawing_area");
  const next: Region = da
    ? { ...da, bbox, source: "user", confidence: 1 }
    : { id: "u:da", kind: "drawing_area", bbox, parent: null, evidence: ["template"], confidence: 1, source: "user" };
  return da ? regions.map((r) => (r === da ? next : r)) : [...regions, next];
}

/** The map as used: detected regions with corrections applied, in image px.
 *  Corrections are resolved once (resolveOverrides); neither input is
 *  changed and nothing is written back.
 *
 *  Per sheet:
 *  1. The template resolved to the sheet's group (after a resolved move)
 *     replaces the detected title block and all its parts, and the drawing
 *     area becomes the border box (the sheet without one) minus its strip.
 *  2. The sheet's `removed` ids drop detected regions, with their children.
 *  3. The sheet's own regions are added.
 *  The result is re-validated, so a correction can't leave a broken tree. */
export function applyOverrides(map: ReadonlyMap<string, SheetRegions>, ov: RegionOverrides): Map<string, SheetRegions> {
  const res = resolveOverrides(map, ov);
  const groups = mapGroups(map);
  const tplOf = new Map(Object.entries(res.templates).map(([k, t]) => [t.group, ov.groups![k]]));
  const out = new Map<string, SheetRegions>();
  for (const [key, sheet] of map) out.set(key, applyToSheet(sheet, ov, res.moves[key], groups, tplOf));
  return out;
}

function applyToSheet(
  sheet: SheetRegions, ov: RegionOverrides, moved: string | undefined,
  groups: Map<string, GroupInfo>, tplOf: Map<string, NonNullable<RegionOverrides["groups"]>[string]>,
): SheetRegions {
  const { w, h } = sheet;
  let regions = sheet.regions;
  const g = moved ?? sheet.group;
  const tpl = g ? tplOf.get(g) : undefined;
  if (tpl) {
    const tb = tpl.regions.map((r) => toPx(r, w, h));
    regions = [...regions.filter((r) => !TITLE_BLOCK_KINDS.has(r.kind)), ...tb];
    const strip = tb.find((r) => r.kind === "title_block");
    if (strip) regions = withDrawingArea(regions, drawingAreaBesides(sheet.border ?? [0, 0, w, h], strip.bbox));
  }
  const mine = ov.sheets?.[sheet.key];
  if (mine?.removed?.length) {
    const drop = new Set(mine.removed);
    // removing a region removes what hangs under it
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of regions) if (r.parent && drop.has(r.parent) && !drop.has(r.id)) { drop.add(r.id); grew = true; }
    }
    regions = regions.filter((r) => !drop.has(r.id));
  }
  if (mine?.regions?.length) {
    const added = new Map(mine.regions.map((r) => [r.id, toPx(r, w, h)]));
    regions = [...regions.filter((r) => !added.has(r.id)), ...added.values()];
  }
  const sig = moved ? groups.get(moved)?.sig : undefined;
  return { ...sheet, ...(moved ? { group: moved } : {}), ...(sig ? { group_sig: sig } : {}), regions: cleanRegions(regions, { w, h }) };
}
