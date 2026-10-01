// Compares two measure.mts outputs (base, head) and prints the expected-vs-observed tables.
//
//   cd <HEAD>/web && node --import tsx <repro>/compare.mts <HEAD> out/base.json out/head.json
//
// Expected values come from the PR's own oracles, not from the head read: the committed goldens
// (web/test/fixtures/reader-483/*.json, mcp/test/fixtures/reader-483/*.json), expectedChanges in
// web/test/fixtures/reader483Fixtures.ts, and the reader483-set rows in mcp/test/scheduleImport.test.ts
// (copied below as EXPECT_483).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [HEAD, BASEF, HEADF] = process.argv.slice(2).map((p) => resolve(p));
const base = JSON.parse(readFileSync(BASEF, "utf8")), head = JSON.parse(readFileSync(HEADF, "utf8"));
const { expectedChanges, expectedReadAt } = await import(join(HEAD, "web/test/fixtures/reader483Fixtures.ts"));
const J = (v: unknown) => JSON.stringify(v);
const rt = (v: unknown) => JSON.parse(J(v));
const out: string[] = [];
const p = (s = "") => out.push(s);

// (a) demo
p("## (a) Demo MATERIAL SCHEDULE marquee (sample-finish-plan.pdf p2), base vs head");
p("| Box | rows base | rows head | keys identical | every field identical (readScheduleSpans) | readFinishTable(marquee) identical | head = committed golden |");
p("|---|---|---|---|---|---|---|");
for (const [box, golden] of [["table", "demo-p2-table"], ["page", "demo-p2-page"]] as const) {
  const b = base.a[box], h = head.a[box];
  const g = JSON.parse(readFileSync(join(HEAD, `mcp/test/fixtures/reader-483/${golden}.json`), "utf8"));
  const keys = (r: { rows: Array<{ finish_tag: string }> }) => r.rows.map((x) => x.finish_tag);
  p(`| ${box === "table" ? "table box (2950,250)–(4720,1900)" : "page box"} | ${b.readScheduleSpans.rows.length} | ${h.readScheduleSpans.rows.length} | ${J(keys(b.readScheduleSpans)) === J(keys(h.readScheduleSpans))} | ${J(b.readScheduleSpans) === J(h.readScheduleSpans)} | ${J(b.finishRows) === J(h.finishRows)} | ${J(h.readScheduleSpans) === J(g.readScheduleSpans) && J(h.finishRows) === J(g.finishRows)} |`);
}

// (b) reader483-set
const EXPECT_483: Record<number, unknown> = {
  1: { keys: ["CPT-1", "CPT-2", "CPT-3SAT", "CPT-3EGG", "EPOX", "LVT-1", "VCT-1", "FTB-01", "FTB-02", "RB-1", "P-1", "P-2", "TS-1", "CG-1"], skipped: ["SEAL"],
    rows: [["CPT-1", "FLOORING", "floor", "heading", true, "BROADLOOM CARPET", null, null, null], ["CPT-2", "FLOORING", "floor", "heading", false, "MODULAR CARPET TILE", "extended", "not-used", "NOT USED"], ["CPT-3SAT", "FLOORING", "floor", "heading", true, "CARPET TILE", null, null, null], ["CPT-3EGG", "FLOORING", "floor", "heading", true, "CARPET TILE", null, null, null], ["EPOX", "FLOORING", "floor", "heading", true, "EPOXY FLOORING", "extended", null, null], ["LVT-1", "FLOORING", "floor", "heading", true, "LUXURY VINYL TILE", null, null, null], ["VCT-1", "FLOORING", "floor", "heading", true, "VINYL COMPOSITION TILE", null, null, null], ["FTB-01", "BASE", "base", "heading", true, "CUT (C) — CERAMIC TILE BASE", "extended", null, null], ["FTB-02", "BASE", "base", "heading", true, "COVE — CERAMIC TILE BASE", "extended", null, null], ["RB-1", "BASE", "base", "heading", true, "RUBBER BASE", null, null, null], ["P-1", "WALLS", "wall", "heading", true, "SAT — PAINT", null, null, null], ["P-2", "WALLS", "wall", "heading", true, "PAINT", null, null, null], ["TS-1", "MISC", "transition", "text", false, "METAL TRANSITION STRIP", "extended", "not-used", "NOT USED"], ["CG-1", "MISC", "wall_protection", "text", true, "CORNER GUARDS", null, null, null]] },
  2: { keys: [], skipped: ["EPOX", "CONC", "SEAL"], rows: [] },
  3: { keys: ["CPT-1", "RB-1", "EPOX", "PT-1"], skipped: null,
    rows: [["CPT-1", "", "unassigned", "none", true, "BROADLOOM CARPET", null, null, null], ["RB-1", "", "base", "text", true, "RUBBER BASE", null, null, null], ["EPOX", "", "unassigned", "none", true, "EPOXY FLOORING", "extended", null, null], ["PT-1", "", "unassigned", "none", true, "PAINT", null, null, null]] },
};
type Row = { finish_tag: string; section: string; category: string; category_source: string; suggested: boolean; description: string; key_rule?: string; unticked_reason?: string; not_used_text?: string };
const full = (rows: Row[]) => rows.map((r) => [r.finish_tag, r.section, r.category, r.category_source, r.suggested, r.description, r.key_rule ?? null, r.unticked_reason ?? null, r.not_used_text ?? null]);
p("\n## (b) Tracked fixture mcp/test/fixtures/reader483-set.pdf — expected (mcp/test/scheduleImport.test.ts) vs observed (head), base for reference");
p("| Sheet | box | expected rows | observed rows (head) | skipped expected / observed | every field as expected | base read (reference) |");
p("|---|---|---|---|---|---|---|");
for (const n of [1, 2, 3]) for (const box of ["table", "page"]) {
  const e = EXPECT_483[n] as { keys: string[]; skipped: string[] | null; rows: unknown[] };
  const h = head.b[`p${n}`][box].readScheduleSpans, b = base.b[`p${n}`][box].readScheduleSpans;
  const ok = J(full(h.rows)) === J(e.rows) && J(h.skipped ?? null) === J(e.skipped) && !("refused" in h);
  const bdesc = "refused" in b ? `refused: ${b.refused}` : `${b.rows.length} rows: ${b.rows.map((x: Row) => x.finish_tag).join(", ")}`;
  p(`| A-60${n} | ${box} | ${e.keys.length} | ${h.rows.length} | ${J(e.skipped)} / ${J(h.skipped ?? null)} | ${ok} | ${bdesc} |`);
}

// (c) twins
p("\n## (c) Characterization twins (web/test/fixtures/reader483Fixtures.ts), read live at base and head");
const twins = Object.keys(head.c.twins);
let unchanged = 0;
const changed: string[] = [];
const baseVsGolden: string[] = [];
for (const name of twins) {
  const g = JSON.parse(readFileSync(join(HEAD, `web/test/fixtures/reader-483/${name}.json`), "utf8"));
  const hb = head.c.twins[name], bb = base.c.twins[name];
  for (const k of ["whole", "marquee"]) if (bb[k] && J(bb[k]) !== J(g[k])) baseVsGolden.push(`${name}.${k}`);
  if (J(hb) === J(bb)) { unchanged++; continue; }
  const diffs = ["whole", "marquee"].flatMap((k) => (hb[k] ? Object.keys(hb[k]).filter((s) => J(hb[k][s]) !== J(bb[k][s])).map((s) => `${k}.${s}`) : []));
  const e = expectedChanges[name];
  const exp = e ? expectedReadAt(e, 6) : null;
  const matchesExpected = exp ? J(rt(hb.marquee.readScheduleSpans)) === J(rt(exp)) : false;
  const kinds = e ? [...new Set(e.changes.map((c: { kind: string }) => c.kind))].join(", ") : "(no entry)";
  changed.push(`| ${name} | ${diffs.join(", ")} | ${kinds} | ${matchesExpected} |`);
}
p(`Twins: ${twins.length}. Byte-identical base vs head (every entry point): **${unchanged}**. Changed: **${changed.length}**. Base read equal to the committed golden: ${baseVsGolden.length ? "NO — " + baseVsGolden.join(", ") : "all " + twins.length} . Controls (four span shapes): ${J(head.c.controls) === J(base.c.controls) ? "identical" : "DIFFER"}.`);
p("");
p("| Changed twin | entry points that changed | change kinds (expectedChanges) | head readScheduleSpans = expected read |");
p("|---|---|---|---|");
for (const l of changed) p(l);
const listedNoChange = Object.keys(expectedChanges).filter((n) => !changed.some((l) => l.startsWith(`| ${n} |`)));
p(`\nexpectedChanges entries with no change: ${listedNoChange.join(", ") || "none"}.`);

// (d) whole-sheet
p("\n## (d) Whole-sheet reads (buildSheetGraph over every page, as mcp/src/session.ts builds it), base vs head");
p("| PDF | pages | tables | table kinds (rows) | total rows | graph identical (tables, rooms, notes, every field) |");
p("|---|---|---|---|---|---|");
for (const f of Object.keys(head.d)) {
  const h = head.d[f], b = base.d[f];
  const t = h.graph.tables as Array<{ kind: string; rows: unknown[] }>;
  p(`| ${f} | ${h.pages} | ${t.length} | ${t.map((x) => `${x.kind} (${x.rows.length})`).join(", ") || "—"} | ${t.reduce((s, x) => s + x.rows.length, 0)} | ${J(h) === J(b)} |`);
}

// (e) sweep
p("\n## (e) Drawn-box sweep: every table region the whole-sheet graph finds (padded 12 px) and every page box, read as a marquee");
const brief = (r: { rows: Row[]; skipped?: string[]; refused?: string; title?: string }) => ("refused" in r ? `refused: ${r.refused}${r.title ? ` (${r.title})` : ""}` : `${r.rows.length} rows${r.skipped ? `, skipped ${J(r.skipped)}` : ""}`);
if (J(base.regions) !== J(head.regions)) throw new Error("the base and head region lists differ: the sweep would compare different boxes");
const n = head.e.length;
const same = head.e.filter((x: unknown, i: number) => J(x) === J(base.e[i])).length;
p(`Boxes: ${n} (${head.e.filter((x: { box: string }) => x.box === "page").length} page boxes, ${head.e.filter((x: { box: string }) => x.box !== "page").length} table boxes) on ${Object.keys(head.d).length} PDFs. Identical base vs head: **${same}**. Different: **${n - same}**.`);
p("");
p("Every box (the region lists are identical at base and head):");
p("");
p("| PDF | page | box | base | head | identical |");
p("|---|---|---|---|---|---|");
head.e.forEach((x: { file: string; page: number; box: string; readScheduleSpans: never }, i: number) => p(`| ${x.file} | ${x.page} | ${x.box} | ${brief(base.e[i].readScheduleSpans)} | ${brief(x.readScheduleSpans)} | ${J(x) === J(base.e[i])} |`));
p("");
p("The boxes that differ:");
p("");
p("| PDF | page | box | base | head | readFinishTable identical |");
p("|---|---|---|---|---|---|");
head.e.forEach((x: { file: string; page: number; box: string; readScheduleSpans: never; finishRows: unknown }, i: number) => {
  if (J(x) === J(base.e[i])) return;
  p(`| ${x.file} | ${x.page} | ${x.box} | ${brief(base.e[i].readScheduleSpans)} | ${brief(x.readScheduleSpans)} | ${J(x.finishRows) === J(base.e[i].finishRows)} |`);
});
console.log(out.join("\n"));
