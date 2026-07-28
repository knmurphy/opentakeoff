// Answer-key exporter — turn a HUMAN takeoff into a frozen benchmark case.
//
//   node --import tsx bench/from-takeoff.mts <annotations.json> <plan.pdf> <sheet_id> <out.json> [--name my-plan] [--allow-machine]
//
// The input is an OpenTakeoff project payload — the same { conditions, shapes,
// sheets, ... } object the autosave writes, a snapshot stores, and
// lib/snapshotDiff.js diffs. The human measures every room with the normal
// drawing tools; this tool freezes those polygons as golden probes the engine
// is graded against (grading: SF error + whole-case coverage — see bench/run.mts).
//
// INDEPENDENCE GUARD: the whole point is truth the engine didn't author, so
// shapes whose origin.method is anything but manual (one-click, agent) are
// EXCLUDED with a warning. --allow-machine overrides (they get a
// "machine-origin" tag and do NOT count as human truth).
//
// Cases written by this tool carry humanMeasured: true — the bench applies
// hard SF-error and coverage gates to those (engine-pinned cases only report).
import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import { resolve, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { WALL_SEMANTICS } from "./corpus.ts";

export type Pt = [number, number];
interface ShapeIn {
  id?: string;
  sheet_id?: string;
  measure_role?: string;
  condition_id?: string;
  verts_norm?: Pt[];
  computed?: { area_sf?: number };
  origin?: { method?: string };
}
interface PayloadIn {
  conditions?: Array<{ id?: string; finish_tag?: string }>;
  shapes?: ShapeIn[];
  sheets?: Array<{ sheet_id?: string; units_per_px?: number }>;
}
export interface ExportProbe { name: string; seed: Pt; expect: "golden"; golden: Pt[]; tags: string[] }
export interface ExportCase {
  pdf: string; page: number; scale: number; ptPerFt: number;
  /** A5b: which line a golden traces to. Human polygons drawn with the canvas's
   *  snap-to-vector on land on PDF path vertices — wall CENTRELINES — which is
   *  the same line the engine's snapped ring lands on, so the two are directly
   *  comparable under the 2.5% gate. Declared, never assumed. */
  wallSemantics: string;
  humanMeasured: true; note: string; pinnedAt: string;
  deducts_sf?: number;
  probes: ExportProbe[];
}
export interface ExportResult { probes: ExportProbe[]; deductsSf: number; skippedMachine: number; warnings: string[] }

// page 1 = bare file name; pages 2+ = "name#page" (lib/sheetKey.ts convention,
// inlined so the bench keeps its import surface to the engine modules only)
export function sheetPage(sheetId: string): number {
  const i = sheetId.lastIndexOf("#");
  if (i > 0 && /^\d+$/.test(sheetId.slice(i + 1))) return parseInt(sheetId.slice(i + 1), 10);
  return 1;
}

const shoelace = (pts: Pt[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};
const inPoly = (x: number, y: number, pts: Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const distToEdges = (x: number, y: number, pts: Pt[]): number => {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
};

/** The most interior point of a polygon we can find cheaply: the centroid if
 *  it's inside, else the best of a coarse grid, always maximizing clearance
 *  from the boundary (a click seed must not land on a wall). */
export function interiorSeed(pts: Pt[]): Pt {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  let bx = cx, by = cy, bd = inPoly(cx, cy, pts) ? distToEdges(cx, cy, pts) : -1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const N = 24;
  for (let gy = 1; gy < N; gy++) {
    for (let gx = 1; gx < N; gx++) {
      const x = x0 + ((x1 - x0) * gx) / N, y = y0 + ((y1 - y0) * gy) / N;
      if (!inPoly(x, y, pts)) continue;
      const d = distToEdges(x, y, pts);
      if (d > bd) { bd = d; bx = x; by = y; }
    }
  }
  return [Math.round(bx * 10) / 10, Math.round(by * 10) / 10];
}

/** Pure transform: payload + sheet + viewport dims → probes. */
export function extractCase(payload: PayloadIn, sheetId: string, vpW: number, vpH: number, uppFeetPerPx: number, allowMachine = false): ExportResult {
  const warnings: string[] = [];
  const finishOf = new Map((payload.conditions ?? []).map((c) => [c.id, c.finish_tag || ""]));
  const probes: ExportProbe[] = [];
  let deductsSf = 0, skippedMachine = 0;
  const nameCounts = new Map<string, number>();
  for (const s of payload.shapes ?? []) {
    if (s.sheet_id !== sheetId) continue;
    if (!Array.isArray(s.verts_norm) || s.verts_norm.length < 3) continue;
    if (s.measure_role === "deduct") { deductsSf += s.computed?.area_sf || 0; continue; }
    if (s.measure_role !== "floor_area") continue;
    const machine = !!s.origin?.method && s.origin.method !== "manual";
    if (machine && !allowMachine) {
      skippedMachine++;
      warnings.push(`skipped ${s.id ?? "shape"} — origin.method "${s.origin!.method}" is not human truth (--allow-machine to include)`);
      continue;
    }
    const golden: Pt[] = s.verts_norm.map(([nx, ny]) => [Math.round(nx * vpW * 10) / 10, Math.round(ny * vpH * 10) / 10]);
    const areaSf = (shoelace(golden) * uppFeetPerPx * uppFeetPerPx) || 0;
    const claimed = s.computed?.area_sf || 0;
    if (claimed > 0 && Math.abs(areaSf - claimed) / claimed > 0.01) {
      warnings.push(`${s.id ?? "shape"}: exported polygon is ${areaSf.toFixed(1)} SF but the takeoff recorded ${claimed.toFixed(1)} SF — check the sheet's scale record`);
    }
    const base = (finishOf.get(s.condition_id) || "area").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "area";
    const n = (nameCounts.get(base) || 0) + 1;
    nameCounts.set(base, n);
    probes.push({
      name: `${base}-${n}`,
      seed: interiorSeed(golden),
      expect: "golden",
      golden,
      tags: machine ? ["machine-origin"] : ["human-measured"],
    });
  }
  if (deductsSf > 0) warnings.push(`sheet carries ${deductsSf.toFixed(1)} SF of deduct shapes — recorded on the case; coverage math subtracts them`);
  return { probes, deductsSf, skippedMachine, warnings };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
  const nameIdx = process.argv.indexOf("--name");
  if (args.length < 4) {
    console.error('usage: node --import tsx bench/from-takeoff.mts <annotations.json> <plan.pdf> <sheet_id> <out.json> [--name case-name] [--allow-machine]');
    process.exit(2);
  }
  const [annPath, pdfPath, sheetId, outPath] = args.map((a) => resolve(a));
  const payload: PayloadIn = JSON.parse(readFileSync(annPath, "utf8"));
  const sheetRec = (payload.sheets ?? []).find((s) => s.sheet_id === args[2]);
  if (!sheetRec || !Number.isFinite(sheetRec.units_per_px) || (sheetRec.units_per_px as number) <= 0) {
    console.error(`sheet "${args[2]}" has no scale record (units_per_px) — calibrate or set the scale in the app first`);
    process.exit(1);
  }
  const upp = sheetRec.units_per_px as number;      // feet per image px at RENDER_SCALE = 2
  const SCALE = 2;
  const page = sheetPage(args[2]);
  const req = createRequire(import.meta.url);
  const pdfjs = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
  const doc = await pdfjs.getDocument({ url: pdfPath, useSystemFonts: true }).promise;
  const pg = await doc.getPage(page);
  const vp = pg.getViewport({ scale: SCALE });
  const res = extractCase(payload, args[2], vp.width, vp.height, upp, flags.has("--allow-machine"));
  for (const w of res.warnings) console.warn(`⚠ ${w}`);
  if (!res.probes.length) {
    console.error("no human floor_area shapes on that sheet — nothing to export");
    process.exit(1);
  }
  const caseName = nameIdx > 0 ? process.argv[nameIdx + 1] : undefined;
  const out: ExportCase = {
    // relative to where the CASE FILE lives (bench/run.mts resolves the pdf
    // against the case's own directory, so corpus/ and corpus/sealed/ both work)
    pdf: relative(dirname(outPath), pdfPath),
    page,
    scale: SCALE,
    ptPerFt: 1 / upp,
    wallSemantics: WALL_SEMANTICS,
    humanMeasured: true,
    note: `${caseName ?? args[2]}: human-measured takeoff exported as answer key (${res.probes.length} probes${res.skippedMachine ? `; ${res.skippedMachine} machine-origin shapes excluded` : ""})`,
    pinnedAt: "human-measured takeoff (from-takeoff.mts)",
    ...(res.deductsSf > 0 ? { deducts_sf: Math.round(res.deductsSf * 10) / 10 } : {}),
    probes: res.probes,
  };
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  const total = res.probes.reduce((a, p) => a + shoelace(p.golden) * upp * upp, 0);
  console.log(`wrote ${args[3]} — ${res.probes.length} probes, ${total.toFixed(1)} SF total${res.deductsSf ? ` (deducts ${res.deductsSf.toFixed(1)} SF)` : ""}`);
  console.log("drop it in bench/corpus/ to gate every run, or bench/corpus/sealed/ for the run-once protocol (BENCH_SEALED=1 npm run bench).");
}
