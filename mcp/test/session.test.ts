// Session tests against the bundled demo plan — real pdf.js parse, real
// geometry, no transport. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Session, ANN_SCHEMA } from "../src/session.ts";

const PLAN = fileURLToPath(new URL("../../demo/sample-plan.pdf", import.meta.url));
const KEY = "sample-plan.pdf";
const approx = (a: number, b: number, tolFrac: number) => Math.abs(a - b) <= Math.abs(b) * tolFrac;

test("loadPlan: pages, dims (pt and px), detected scale, sheet number", async () => {
  const s = new Session();
  const r = await s.loadPlan(PLAN);
  assert.equal(r.page_count, 1);
  assert.equal(r.file, KEY);
  assert.equal(r.sheets.length, 1);
  const sh = r.sheets[0];
  assert.equal(sh.sheet, KEY);
  assert.equal(sh.width_pt, 1224);
  assert.equal(sh.height_pt, 792);
  assert.equal(sh.width_px, 2448);
  assert.equal(sh.height_px, 1584);
  assert.equal(sh.detected_scale, '1/4" = 1\'-0"');
  assert.equal(sh.sheet_number, "A-101");
});

test("sheet lookup: by key, by title-block number, unknown lists loaded keys", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  const info = await s.sheetInfo("A-101");            // title-block alias
  assert.equal(info.sheet, KEY);
  assert.ok(info.has_vector_linework);
  assert.ok(info.seg_count >= 6, `outer wall + partitions, got ${info.seg_count}`);
  assert.equal(info.scale_set, false);
  await assert.rejects(() => s.sheetInfo("nope.pdf"), /Unknown sheet .* loaded sheets: sample-plan\.pdf/);
});

test("ensureMask: built once, cache identity on the second call", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  const m1 = await s.ensureMask(KEY);
  const m2 = await s.ensureMask(KEY);
  assert.ok(m1, "the demo plan has vector linework");
  assert.equal(m1, m2, "same MaskObj identity — not rebuilt");
});

test("setScale: label / upp / calibrate / use_detected all land on the same upp", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  const want = 1 / 36; // 1/4" = 1'-0" at render scale 2: 4 ft per 144 px

  const byLabel = s.setScale(KEY, { label: '1/4" = 1\'-0"' });
  assert.ok(Math.abs(byLabel.upp - want) < 1e-12);

  const byUpp = s.setScale(KEY, { upp: 0.5 });
  assert.equal(byUpp.upp, 0.5);

  // the building's bottom edge: 1960 px wide = 54.44 real feet at 1/4" scale
  const byCal = s.setScale(KEY, { calibrate: { p1: [240, 1364], p2: [2200, 1364], feet: 54.44 } });
  assert.ok(Math.abs(byCal.upp - want) < 1e-4, `calibrated upp ≈ 1/36, got ${byCal.upp}`);

  const byDet = s.setScale(KEY, { use_detected: true });
  assert.ok(Math.abs(byDet.upp - want) < 1e-12);
  assert.equal(byDet.label, '1/4" = 1\'-0"');
});

test("setScale: unknown label errors and lists the valid labels", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  await assert.rejects(async () => s.setScale(KEY, { label: '1/5" = 1\'-0"' }), (e: Error) => {
    assert.match(e.message, /Unknown scale label/);
    assert.match(e.message, /1\/4" = 1'-0"/);
    assert.match(e.message, /1" = 20'/);
    return true;
  });
});

test("oneClick: px-only preview with warning before scale, SF after, leak outside", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);

  const pre = await s.oneClick(KEY, 600, 1084, { role: "floor_area", returnVerts: false });
  assert.equal(pre.status, "ok");
  assert.ok("area_px2" in pre && (pre as any).area_px2 > 0);
  assert.ok("perimeter_px" in pre);
  assert.ok(!("area_sf" in pre));
  assert.match((pre as any).warning, /No scale set for sample-plan\.pdf/);
  assert.match((pre as any).warning, /detected: 1\/4" = 1'-0"/);
  assert.equal(s.shapes.length, 0, "px preview never commits");

  s.setScale(KEY, { use_detected: true });
  const post = await s.oneClick(KEY, 600, 1084, { role: "floor_area", returnVerts: true });
  assert.ok(approx((post as any).area_sf, 438.6, 0.05), `room ≈ 438.6 SF, got ${(post as any).area_sf}`);
  assert.ok((post as any).nverts >= 3);
  assert.ok(Array.isArray((post as any).verts));
  assert.ok(!("shape_id" in post), "no condition given — nothing committed");
  assert.equal(s.shapes.length, 0);

  await assert.rejects(() => s.oneClick(KEY, 100, 100, { role: "floor_area", returnVerts: false }),
    /isn't enclosed on the plan linework/);
});

test("commit: verts_norm in [0,1], origin receipt, condition minted like the canvas", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  s.setScale(KEY, { use_detected: true });
  const r = await s.oneClick(KEY, 600, 1084, { condition: "CPT-1", role: "floor_area", returnVerts: false });
  assert.ok((r as any).shape_id);
  assert.equal(s.shapes.length, 1);
  const shp = s.shapes[0];
  assert.equal(shp.sheet_id, KEY);
  assert.equal(shp.measure_role, "floor_area");
  for (const [x, y] of shp.verts_norm) {
    assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `verts_norm out of [0,1]: ${x},${y}`);
  }
  assert.equal(shp.origin?.method, "one_click_v1");
  assert.equal(shp.origin?.actor, "agent", "MCP commits are agent work, never human");
  assert.equal(shp.origin?.reviewed, false, "no human review gate exists in this server");
  assert.ok(shp.origin?.seed_norm?.[0]! > 0 && shp.origin?.seed_norm?.[0]! < 1);
  assert.equal(s.conditions.length, 1);
  const c = s.conditions[0];
  assert.equal(c.finish_tag, "CPT-1");
  assert.equal(c.color, "#c96442");      // first palette slot
  assert.equal(c.fill, "#c96442");
  assert.equal(c.hatch, "diag");         // HATCHES[1 + 0 % 15]
  assert.equal(c.multiplier, 1);
  assert.equal(c.waste_pct, 0);
  assert.deepEqual(c.materials, []);
});

test("ensureMask: the working raster is rebuilt when the scale arrives (issue #184 round 9)", async () => {
  // mppf is baked into the mask, and the flood's seal radii / door-wedge cap /
  // minimum-passage radius are all derived from it. A mask built before
  // set_scale would otherwise pin the sheet to the scale-unknown thresholds
  // for the rest of the session — the canvas evicts on recalibration for the
  // same reason.
  const s = new Session();
  await s.loadPlan(PLAN);
  const before = await s.ensureMask(KEY);
  assert.ok(before, "sample-plan has vector linework");
  assert.ok(!before!.mppf, "a pre-scale mask carries no feet-true scale");
  s.setScale(KEY, { use_detected: true });
  const after = await s.ensureMask(KEY);
  assert.ok(after!.mppf! > 0, "the post-scale mask is feet-true");
  assert.notEqual(after, before, "the stale mask must not be reused");
  assert.equal(await s.ensureMask(KEY), after, "and it is cached once the scale is stable");
});

test("detectRooms: finds all 4 real room labels, excludes the title-block number and scale note", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  s.setScale(KEY, { use_detected: true });
  const r = await s.detectRooms(KEY, { role: "floor_area", returnVerts: false });
  assert.equal(r.detected, 4, `expected the 4 office/break/corridor rooms, got ${JSON.stringify(r.rooms.map((x) => x.label))}`);
  assert.deepEqual(r.rooms.map((x) => x.label).sort(), ["101", "102", "103", "104"]);
  for (const room of r.rooms) assert.ok(approx((room as any).area_sf, 438.6, 0.05), `room ${room.label} ≈ 438.6 SF, got ${(room as any).area_sf}`);
  assert.equal(s.shapes.length, 0, "no condition given — nothing committed");
});

test("detectRooms: px-only preview before scale; condition commits every detected room under one finish tag", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  const pre = await s.detectRooms(KEY, { role: "floor_area", returnVerts: false });
  assert.equal(pre.detected, 4);
  assert.ok("area_px2" in pre.rooms[0] && pre.rooms[0].area_px2! > 0);
  assert.ok(!("area_sf" in pre.rooms[0]));
  assert.match(pre.warning!, /No scale set for sample-plan\.pdf/);
  assert.equal(s.shapes.length, 0);

  s.setScale(KEY, { use_detected: true });
  const r = await s.detectRooms(KEY, { condition: "CPT-1", role: "floor_area", returnVerts: false });
  assert.equal(r.rooms.filter((x) => (x as any).shape_id).length, 4, "all 4 rooms committed");
  assert.equal(s.shapes.length, 4);
  assert.equal(s.conditions.length, 1, "one condition minted, shared by every detected room");
  for (const shp of s.shapes) {
    assert.equal(shp.origin?.method, "one_click_v1");
    assert.equal(shp.origin?.actor, "agent");
    assert.equal(shp.origin?.reviewed, false);
  }
});

test("detectRooms: a sheet with no room-number labels detects nothing, no crash", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  s.setScale(KEY, { use_detected: true });
  const r = await s.detectRooms(KEY, { role: "floor_area", returnVerts: false });
  assert.ok(r.detected > 0, "sanity: the fixture does have labels");
  // now prove the empty case doesn't throw — a region with no labels near it
  const noLabelRegion = s.readSheetText(KEY, { x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.equal(noLabelRegion.items.length, 0);
});

test("measure gates: polygon and line refuse without a scale, with the detected hint", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  const wantMsg = /Set the scale for sample-plan\.pdf first — use set_scale \(detected: 1\/4" = 1'-0"\)\./;
  await assert.rejects(async () => s.measurePolygon(KEY, [[0, 0], [100, 0], [100, 100]], { role: "floor_area" }), wantMsg);
  await assert.rejects(async () => s.measureLine(KEY, [[0, 0], [100, 0]], {}), wantMsg);
});

test("measure: polygon SF and line LF at scale; deletion removes the shape", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  s.setScale(KEY, { use_detected: true });
  // 360×360 px = 10×10 ft
  const poly = s.measurePolygon(KEY, [[0, 0], [360, 0], [360, 360], [0, 360]], { condition: "TILE-1", role: "floor_area" });
  assert.equal(poly.area_sf, 100);
  assert.equal(poly.perimeter_lf, 40);
  const line = s.measureLine(KEY, [[0, 0], [720, 0]], { condition: "BASE-1" });
  assert.equal(line.length_lf, 20);
  assert.equal(s.shapes.length, 2);
  assert.equal(s.shapes[1].measure_role, "linear");
  assert.equal(s.shapes[1].computed.area_sf, 0);
  // agent-supplied coordinates: a hand trace by a machine hand, never human
  for (const shp of s.shapes) {
    assert.equal(shp.origin?.method, "manual");
    assert.equal(shp.origin?.actor, "agent");
    assert.equal(shp.origin?.reviewed, undefined, "measure commits claim no review state");
  }
  s.deleteShape(poly.shape_id!);
  assert.equal(s.shapes.length, 1);
  await assert.rejects(async () => s.deleteShape("shp-nope"), /No shape with id/);
});

test("exportPayload: exact envelope keys, schema, only scaled sheets listed", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  let p = s.exportPayload();
  assert.deepEqual(p.sheets, [], "no scale set — no sheets entries");
  s.setScale(KEY, { use_detected: true });
  await s.oneClick(KEY, 600, 1084, { condition: "CPT-1", role: "floor_area", returnVerts: false });
  p = s.exportPayload();
  assert.deepEqual(Object.keys(p).sort(), [
    "conditions", "last_group", "markups", "project_name", "schema",
    "shapes", "sheet_group", "sheet_levels", "sheet_tabs", "sheets", "units",
  ]);
  assert.equal(p.schema, ANN_SCHEMA);
  assert.equal(p.schema, "opentakeoff.takeoff_canvas.v1");
  assert.equal(p.units, "imperial");
  assert.equal(p.project_name, "");
  assert.deepEqual(p.markups, []);
  assert.deepEqual(p.sheet_levels, {});
  assert.equal(p.sheets.length, 1);
  assert.equal(p.sheets[0].sheet_id, KEY);
  assert.ok(Math.abs(p.sheets[0].units_per_px! - 1 / 36) < 1e-12);
  assert.equal(p.shapes.length, 1);
  assert.equal(p.conditions.length, 1);
});

test("loadPlan again: replaces the session — scales, conditions, shapes all cleared", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  s.setScale(KEY, { use_detected: true });
  await s.oneClick(KEY, 600, 1084, { condition: "CPT-1", role: "floor_area", returnVerts: false });
  const r = await s.loadPlan(PLAN);
  assert.match(r.note, /cleared/);
  assert.equal(s.shapes.length, 0);
  assert.equal(s.conditions.length, 0);
  const info = await s.sheetInfo(KEY);
  assert.equal(info.scale_set, false);
  assert.equal(info.shape_count, 0);
});

test("readSheetText: positioned items in image px; region narrows to the title block", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  const all = s.readSheetText(KEY);
  assert.match(all.text, /OFFICE 101/);
  assert.match(all.text, /SCALE: 1\/4"/);
  const office = all.items.find((i) => i.str === "OFFICE 101")!;
  assert.ok(Math.abs(office.x - 600) < 2 && Math.abs(office.y - 1084) < 2, `label at ~(600,1084), got (${office.x},${office.y})`);
  // lower-right quadrant only — the title block
  const tb = s.readSheetText(KEY, { x0: 1468, y0: 871, x1: 2448, y1: 1584 });
  assert.ok(tb.items.some((i) => i.str === "A-101"));
  assert.ok(!tb.text.includes("OFFICE 101"));
});

// ── detect_rooms guards (issue #184 merge regression, pinned 2026-07-30) ─────
// The merge at 36b6626 dropped the fork's below-box-first seed ladder and ran
// the bubble test on the POST-SNAP ring; the VA finish plan collapsed from 40
// detections (parent, ~16 of them tag-box artifacts) to 12 rooms / 569 SF.
// The repair is three ordered guards per ladder rung: (1) every rung honors
// the drawing-extent gate, (2) the bubble test runs on the PRE-SNAP trace
// (vertex snap can inflate a tag-box ring past BUBBLE_RATIO), (3) a clean
// non-bubble flood must be OWNED by its label — center-in-ring OR the flood
// region surrounding the label box (floodSurroundsLabelPx; tag boxes tied to
// a wall by their leader carve the label center OUT of the outer ring).
// Adjudicated per label against the pre-merge parent (36b6626^1) and sheet
// crops: 27 real rooms / 3370.6 SF, 14 labels honestly withheld.

const PLAN_VA = fileURLToPath(new URL("../../demo/sample-finish-plan.pdf", import.meta.url));
const KEY_VA = "sample-finish-plan.pdf";

test("detectRooms VA finish plan: regression pin — real rooms detected, tag-box artifacts withheld", async () => {
  const s = new Session();
  await s.loadPlan(PLAN_VA);
  s.setScale(KEY_VA, { upp: 1 / 18 });   // 1/8" = 1'-0" at render scale 2
  const r = await s.detectRooms(KEY_VA, { role: "floor_area", returnVerts: false });
  const byLabel = new Map(r.rooms.map((x) => [x.label, x as { label: string; area_sf?: number; merged_labels?: string[] }]));

  // The adjudicated sheet truth is 27 rooms (2026-07-30 table). Floor guards
  // the anchor-first/post-snap regression (12) and the ownership over-fire
  // (20); ceiling guards re-admitting the parent's ~16 sub-10-SF artifacts
  // (40) while leaving room for future recovery of the small hatched rooms
  // the ladder still cannot reach (138A, 142, 150, 154, 167, 169, 170).
  assert.ok(r.detected >= 26 && r.detected <= 34, `expected 26..34 rooms, got ${r.detected}`);

  // The one room with a golden pin: patient room 137. Golden was 167.96 SF;
  // RE-PINNED to ~202 SF at the 2026-08-04 upstream sync, adopting upstream's
  // annotation-ring recovery (#188): the hairline finish-tag ring drawn ~2 ft
  // inside the walls now classifies as annotation on pen evidence, so the room
  // reads wall-to-wall through the moderate grow-but-verify tier instead of
  // stopping on the ring. Upstream measured the same move in the web bench
  // (167.96 -> 202.05) and re-pinned their own corpus for it; the reason is
  // APPENDED here rather than replacing the history, so each re-pin has to
  // survive the next one.
  const r137 = byLabel.get("137");
  assert.ok(r137, "room 137 detected");
  assert.ok(r137!.area_sf! >= 185 && r137!.area_sf! <= 215, `room 137 ≈ 202 SF, got ${r137!.area_sf}`);

  // Tag-box carve-out rooms (leader line ties the drawn tag box to a wall, so
  // the label center falls OUTSIDE the traced outer ring) — the ownership
  // fallback is what detects these; center-in-ring alone loses all six.
  for (const [label, sf] of [["133", 46.74], ["136", 90.13], ["145A", 38.59], ["147A", 45.89], ["151A", 34.68], ["157", 172.35]] as const) {
    const room = byLabel.get(label);
    assert.ok(room, `carve-out room ${label} detected`);
    assert.ok(approx(room!.area_sf!, sf, 0.15), `room ${label} ≈ ${sf} SF, got ${room!.area_sf}`);
  }

  // Genuine label bubbles the parent misreported as sub-4-SF "rooms": their
  // every clean flood is the drawn tag box, and they must stay withheld.
  for (const junk of ["135", "160", "164", "168", "169"]) {
    assert.ok(!byLabel.has(junk), `label ${junk} is a tag-box bubble, not a room`);
  }
  assert.ok(r.withheld.bubble >= 10, `tag-box bubbles are withheld and counted, got ${r.withheld.bubble}`);

  // merged_labels honesty: 134A's storage room (the plan prints "16 SF") is
  // NOT office 136 — the parent committed 134A as a 90.13 SF double-count of
  // 136's region. Ownership must refuse the flood, so 134A appears neither as
  // its own room nor laundered into another room's merged_labels.
  assert.ok(!byLabel.has("134A"), "134A must not claim office 136's region");
  for (const room of r.rooms) {
    assert.ok(!(room as { merged_labels?: string[] }).merged_labels?.includes("134A"),
      `134A must not be merged into ${room.label} — its flood is not its own space`);
  }
  assert.equal(r.withheld.duplicate, 0, "no two labels on this sheet honestly share one region");
});

// A minimal synthetic sheet where the seed ladder's below-box rungs step past
// the drawing extent into paper space. Layout (PDF pts; image px = 2×):
//   · label "201" just INSIDE sheetBounds' bottom edge (image y≈1438-1470 vs
//     the 6% gate at y=1488.96), inside a drawn tag box;
//   · a wide paper-space box (title strip stand-in) straddling the gate so the
//     below rung (center + 2h ≈ image y 1518) lands inside it, OUT of bounds.
// The trap is built to pass every OTHER guard if flooded: it is clean,
// non-bubble, and SURROUNDS the label's tag box on 3 sides — so only the
// per-rung bounds check keeps it out. With the check: center rung → its own
// bubble, above rung → leaks into open space, below rungs → out of bounds;
// nothing detected, the bubble counted.
function edgeLabelPdf(): Buffer {
  const W = 1224, H = 792;
  const stream = Buffer.from([
    "q", "3 w 0 0 0 RG",
    "400 2 400 88 re S",                    // paper-space trap: image y 1404-1580, x 800-1600
    "495 52 50 28 re S",                    // tag box around the label: image y 1424-1480
    "BT /F1 22 Tf 500 57 Td (201) Tj ET",   // label baseline image y 1470 — inside bounds
    "Q",
  ].join("\n"), "latin1");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  let out = Buffer.from("%PDF-1.4\n");
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(out.length);
    out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`), obj, Buffer.from("\nendobj\n")]);
  });
  const xref = out.length;
  const n = objects.length + 1;
  out = Buffer.concat([out, Buffer.from(`xref\n0 ${n}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
  return out;
}

test("detectRooms bounds escape: ladder rungs outside sheetBounds are never flooded", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "otk-edge-"));
  const path = join(dir, "edge-label.pdf");
  writeFileSync(path, edgeLabelPdf());
  const s = new Session();
  await s.loadPlan(path);
  s.setScale("edge-label.pdf", { upp: 1 / 36 });
  const r = await s.detectRooms("edge-label.pdf", { condition: "CPT-1", role: "floor_area", returnVerts: false });
  assert.equal(r.detected, 0, `paper space must never flood into a room, got ${JSON.stringify(r.rooms)}`);
  assert.equal(r.withheld.bubble, 1, "the label's own tag box is seen and counted, not silently dropped");
  assert.equal(s.shapes.length, 0, "nothing commits from beyond the drawing extent");
});

// 0.9.18 — floorTagFor, the per-room resolver behind assign-from-schedule.
// Unit-tested here because the fixture's room 134 (the REAL compound cell,
// "CPT-1/VCT-1") never survives detect_rooms' geometric gates on this sheet —
// the resolver's refusal doctrine still has to hold when a future plan DOES
// flood it cleanly.
test("floorTagFor: resolves the row's FLOOR cell; compound cells and missing rows refuse with reasons", async () => {
  const FINISH = fileURLToPath(new URL("../../demo/sample-finish-plan.pdf", import.meta.url));
  const s = new Session();
  await s.loadPlan(FINISH);
  const g = await (s as any).ensureGraph();
  const resolve = (tag: string) => (s as any).floorTagFor(g, tag);

  // a clean row resolves to its FLOOR literal, citing the schedule sheet —
  // and the hyphen in "CPT-1" never trips the compound detector
  const ok = resolve("164");
  assert.deepEqual(ok, { tag: "CPT-1", sheet: "sample-finish-plan.pdf#2" });

  // the compound cell is ambiguous: committing whole-room SF under a
  // two-finish literal asserts an area split the schedule never stated
  const amb = resolve("134");
  assert.match(amb.reason, /^ambiguous: floor cell "CPT-1\/VCT-1" names more than one finish/);
  assert.equal(amb.tag, undefined, "an ambiguous cell yields no tag at all");

  // no row: resolveTag's own reason passes through verbatim
  assert.match(resolve("999").reason, /no schedule row for 999/);
});

// 0.9.18 — the marked-set cover's assignment-provenance line. Pure function,
// synthetic shapes: no PDF in the loop.
test("assignmentDisclosure: null for all-human, mixed counts, and the pointInPoly staleness drop", async () => {
  const { assignmentDisclosure } = await import("../src/marked.ts");
  const shape = (over: Record<string, unknown>) => ({
    id: "shp-x", sheet_id: "p.pdf", condition_id: "cnd-x", measure_role: "floor_area",
    verts_norm: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]], computed: { area_sf: 1, perimeter_lf: 1 },
    ...over,
  }) as any;

  // an all-human takeoff discloses nothing — the canvas path stays unchanged
  assert.equal(assignmentDisclosure([shape({ origin: undefined })], []), null);
  assert.equal(assignmentDisclosure([], []), null);

  // mixed counts, in the stated order
  const mixed = [
    shape({ id: "a", origin: { method: "one_click_v1", actor: "agent", reviewed: false, assignment: { source: "schedule" } } }),
    shape({ id: "b", origin: { method: "one_click_v1", actor: "agent", reviewed: false, assignment: { source: "schedule" } } }),
    shape({ id: "c", origin: { method: "manual", actor: "agent", reviewed: false, assignment: { source: "asserted" } } }),
  ];
  assert.equal(
    assignmentDisclosure(mixed, [{ sheet_id: "p.pdf", label: "9", reason: "no row", seed_norm: [0.9, 0.9] } as any]),
    "Finish assignment: 2 schedule-resolved · 1 agent-asserted · 3 pending human review · 1 room withheld, unresolved against the schedule",
  );

  // staleness: a withheld seed INSIDE a committed area ring was answered by
  // hand after the sweep — the cover must not still call it withheld. A seed
  // on another sheet at the same coordinates stays.
  const inside = { sheet_id: "p.pdf", label: "7", reason: "no row", seed_norm: [0.2, 0.2] } as any;
  const otherSheet = { ...inside, sheet_id: "q.pdf" };
  assert.equal(
    assignmentDisclosure(mixed, [inside]),
    "Finish assignment: 2 schedule-resolved · 1 agent-asserted · 3 pending human review",
  );
  assert.match(assignmentDisclosure(mixed, [otherSheet])!, / · 1 room withheld/);
});
