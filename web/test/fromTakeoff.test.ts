// Answer-key exporter (bench/from-takeoff.mts) — the pure transform from an
// OpenTakeoff annotations payload to benchmark probes. The CLI half (pdf.js
// viewport lookup) is a thin wrapper around these functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCase, interiorSeed, sheetPage, parseWallSemantics } from "../bench/from-takeoff.mts";
import { WALL_SEMANTICS, KNOWN_WALL_SEMANTICS } from "../bench/corpus.ts";

const VP_W = 1000, VP_H = 800, UPP = 1 / 18;          // 18 image px per foot

const rectNorm = (x0: number, y0: number, x1: number, y1: number) =>
  [[x0 / VP_W, y0 / VP_H], [x1 / VP_W, y0 / VP_H], [x1 / VP_W, y1 / VP_H], [x0 / VP_W, y1 / VP_H]] as [number, number][];

const payload = () => ({
  conditions: [{ id: "c1", finish_tag: "CPT-1" }, { id: "c2", finish_tag: "PT/2 tile" }],
  sheets: [{ sheet_id: "plan.pdf", units_per_px: UPP }],
  shapes: [
    { id: "s1", sheet_id: "plan.pdf", measure_role: "floor_area", condition_id: "c1", verts_norm: rectNorm(100, 100, 280, 280), computed: { area_sf: (180 * 180) * UPP * UPP } },
    { id: "s2", sheet_id: "plan.pdf", measure_role: "floor_area", condition_id: "c1", verts_norm: rectNorm(300, 100, 480, 280), computed: { area_sf: (180 * 180) * UPP * UPP } },
    { id: "s3", sheet_id: "plan.pdf", measure_role: "floor_area", condition_id: "c2", verts_norm: rectNorm(500, 100, 600, 200), computed: { area_sf: (100 * 100) * UPP * UPP } },
    // machine-origin — must be excluded by default
    { id: "s4", sheet_id: "plan.pdf", measure_role: "floor_area", condition_id: "c1", verts_norm: rectNorm(100, 400, 280, 580), origin: { method: "one_click_area" }, computed: { area_sf: 100 } },
    // deduct — not a probe, summed on the case
    { id: "s5", sheet_id: "plan.pdf", measure_role: "deduct", condition_id: "c1", verts_norm: rectNorm(150, 150, 200, 200), computed: { area_sf: 7.7 } },
    // other sheet / other role — ignored
    { id: "s6", sheet_id: "other.pdf", measure_role: "floor_area", condition_id: "c1", verts_norm: rectNorm(0.1, 0.1, 0.2, 0.2) },
    { id: "s7", sheet_id: "plan.pdf", measure_role: "linear", condition_id: "c1", verts_norm: rectNorm(700, 100, 800, 110) },
  ],
});

test("extractCase: human floor shapes become probes; machine/deduct/foreign are handled", () => {
  const res = extractCase(payload(), "plan.pdf", VP_W, VP_H, UPP);
  assert.equal(res.probes.length, 3, "three human floor_area probes");
  assert.equal(res.skippedMachine, 1, "one-click shape excluded");
  assert.ok(Math.abs(res.deductsSf - 7.7) < 1e-9, "deduct SF recorded");
  assert.deepEqual(res.probes.map((p) => p.name), ["cpt-1-1", "cpt-1-2", "pt-2-tile-1"], "names from finish tags, deduped");
  const g = res.probes[0].golden;
  assert.deepEqual(g[0], [100, 100], "verts_norm mapped to image px");
  assert.deepEqual(g[2], [280, 280]);
  for (const p of res.probes) {
    assert.equal(p.expect, "golden");
    assert.deepEqual(p.tags, ["human-measured"]);
    const [sx, sy] = p.seed;
    const xs = p.golden.map(([x]) => x), ys = p.golden.map(([, y]) => y);
    assert.ok(sx > Math.min(...xs) && sx < Math.max(...xs) && sy > Math.min(...ys) && sy < Math.max(...ys), "seed inside the polygon bbox");
  }
});

test("extractCase: --allow-machine includes machine shapes but tags them", () => {
  const res = extractCase(payload(), "plan.pdf", VP_W, VP_H, UPP, true);
  assert.equal(res.probes.length, 4);
  assert.ok(res.probes.some((p) => p.tags.includes("machine-origin")));
});

test("extractCase: warns when the polygon SF disagrees with the takeoff's recorded SF", () => {
  const p = payload();
  p.shapes[0].computed = { area_sf: 999 };             // scale record and shape disagree
  const res = extractCase(p, "plan.pdf", VP_W, VP_H, UPP);
  assert.ok(res.warnings.some((w) => w.includes("s1") && w.includes("999")), "mismatch warning names the shape");
});

test("interiorSeed: centroid of an L-shape falls outside — the seed must not", () => {
  const L: [number, number][] = [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]];
  const [sx, sy] = interiorSeed(L);
  const inside = (x: number, y: number) => (x > 0 && x < 100 && y > 0 && y < 30) || (x > 0 && x < 30 && y > 0 && y < 100);
  assert.ok(inside(sx, sy), `seed (${sx},${sy}) inside the L`);
});

test("sheetPage: bare name is page 1; #N suffix parses; # in file names survives", () => {
  assert.equal(sheetPage("plan.pdf"), 1);
  assert.equal(sheetPage("plan.pdf#3"), 3);
  assert.equal(sheetPage("job#12 plan.pdf"), 1);
});

// ── F5: wall semantics is DECLARED by the human, never defaulted ────────────
// This exporter used to stamp `wallSemantics: WALL_SEMANTICS` onto every answer
// key it wrote, which made bench/run.mts's semantics check compare a constant to
// itself on the one kind of case where the field carries information. A human
// answer key is the only place a measurand is CHOSEN rather than produced, so
// the person has to say which line they measured to — and the failure mode of a
// silent default is exactly what happened: the corpus asserted "centerline" for
// three months while the VA plan's goldens sat on wall faces ~5.9 in apart.
const ARGS = ["ann.json", "plan.pdf", "plan.pdf", "out.json"];

test("F5: --wall-semantics is REQUIRED — no default, and the omission says why", () => {
  assert.throws(() => parseWallSemantics(ARGS), /REQUIRED/,
    "a missing declaration must fail, not fall back to the engine's own measurand");
  assert.throws(() => parseWallSemantics(ARGS), new RegExp(WALL_SEMANTICS));
  // the flag with no value after it is the same omission
  assert.throws(() => parseWallSemantics([...ARGS, "--wall-semantics"]), /REQUIRED/);
  assert.throws(() => parseWallSemantics([...ARGS, "--wall-semantics", "--allow-machine"]), /REQUIRED/,
    "the NEXT FLAG is not a value");
});

test("F5: --wall-semantics accepts the vocabulary and only the vocabulary", () => {
  for (const v of KNOWN_WALL_SEMANTICS)
    assert.equal(parseWallSemantics([...ARGS, "--wall-semantics", v]), v);
  assert.equal(parseWallSemantics(["--wall-semantics", "centerline", ...ARGS]), "centerline",
    "position-independent — flags may precede the positionals");
  // a typo is not "some other convention the bench should trust"
  assert.throws(() => parseWallSemantics([...ARGS, "--wall-semantics", "centreline"]), /not one of/,
    "British spelling is a typo here, and a silently-accepted typo is how the field stopped meaning anything");
  assert.throws(() => parseWallSemantics([...ARGS, "--wall-semantics", "face-to-face"]), /not one of/);
});
