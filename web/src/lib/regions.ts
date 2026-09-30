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

function cleanDetail(d: unknown): DetailTitle | undefined {
  if (!d || typeof d !== "object") return undefined;
  const o = d as Record<string, unknown>;
  const out: DetailTitle = {};
  for (const k of ["number", "sheet_ref", "title", "scale"] as const) { const v = str(o[k]); if (v) out[k] = v; }
  return Object.keys(out).length ? out : undefined;
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
 *  a cycle can't survive (a region in a cycle never finds a kept parent). */
export function cleanRegions(raw: unknown): Region[] {
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
      if (want === null) ok = r.parent === null ? r : null;
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
    const group = str(s.group, 64);
    out.set(key, { key, w: s.w, h: s.h, ...(group ? { group } : {}), regions: cleanRegions(s.regions) });
  }
  return out;
}

// ── user corrections ───────────────────────────────────────────────────────

/** Corrections, stored in the takeoff document. Bboxes are normalized [0..1].
 *
 *  - `groups[g]` is a title-block template: the title block and its parts,
 *    drawn or fixed once, applied to every sheet in group g.
 *  - `sheet_group[key]` moves a sheet to a group by hand; it outranks the
 *    detected group.
 *  - `sheets[key]` is per sheet: regions to drop (by detected id, children
 *    go with them) and regions to add (details, notes, …). */
export interface RegionOverrides {
  groups?: Record<string, { source_sheet: string; regions: Region[] }>;
  sheet_group?: Record<string, string>;
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
      if (src && regions.length) groups[g] = { source_sheet: src, regions };
    }
    if (Object.keys(groups).length) out.groups = groups;
  }
  if (o.sheet_group && typeof o.sheet_group === "object" && !Array.isArray(o.sheet_group)) {
    const sg: Record<string, string> = {};
    for (const [k, g] of Object.entries(o.sheet_group as Record<string, unknown>)) if (typeof g === "string" && g) sg[k] = g;
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

/** The group a sheet belongs to: a manual move wins over detection. */
export const groupOf = (sheet: SheetRegions, ov: RegionOverrides): string | undefined =>
  ov.sheet_group?.[sheet.key] ?? sheet.group;

const toPx = (r: Region, w: number, h: number): Region => ({ ...r, bbox: [r.bbox[0] * w, r.bbox[1] * h, r.bbox[2] * w, r.bbox[3] * h] });

/** px bbox → normalized, for turning a region the user drew into an override. */
export const toNormBbox = (b: Bbox, w: number, h: number): Bbox => [b[0] / w, b[1] / h, b[2] / w, b[3] / h];

/** The map as used: detected regions with corrections applied, in image px.
 *
 *  1. A group template replaces the detected title block and all its parts.
 *  2. The sheet's `removed` ids drop detected regions, with their children.
 *  3. The sheet's own regions are added.
 *  The result is re-validated, so a correction can't leave a broken tree. */
export function applyOverrides(sheet: SheetRegions, ov: RegionOverrides): SheetRegions {
  const { w, h } = sheet;
  let regions = sheet.regions;
  const g = groupOf(sheet, ov);
  const tpl = g ? ov.groups?.[g] : undefined;
  if (tpl) regions = [...regions.filter((r) => !TITLE_BLOCK_KINDS.has(r.kind)), ...tpl.regions.map((r) => toPx(r, w, h))];
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
  return { ...sheet, ...(g ? { group: g } : {}), regions: cleanRegions(regions) };
}
