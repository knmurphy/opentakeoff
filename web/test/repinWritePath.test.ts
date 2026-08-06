// ACCEPTANCE TEST for the re-pin WRITE PATH (defect F4).
//
// `repinProtocol.test.ts` covers `diffRepin` — the decision to refuse. It cannot
// see `main()`, which is where the corpus JSON is actually assembled, and that
// is where F4 lived:
//
//     const out = probes.find((p) => p.name === row.name);
//     if (!out) continue;          // ← a REMOVED probe has no new row
//
// A probe removed by a re-pin (or the removal half of a rename) has no new probe
// object, so its `--adjudicate` reason was silently dropped on the floor while
// the re-pin exited 0 — falsifying the protocol header's claim that reasons
// persist in the corpus JSON, in exactly the case that header calls most
// dangerous. Unit tests of the pure function said nothing about it. So this file
// runs the REAL script, in a subprocess, with real PDFs and real writes:
//
//   node --import tsx bench/pin-goldens.mts [--adjudicate …]
//
// against a throwaway COPY of the corpus (REPIN_CORPUS_DIR). The repo's own
// goldens are never the subject of a write — the last test in this file proves
// they are byte-identical to how they started. The sandbox mirrors the corpus
// dir's depth so the cases' relative `pdf` paths (`../../../demo/…`) resolve to
// a symlink to the real demo PDFs; the traces are the production traces.
//
// Precedent for distrusting unit-only coverage of this file: the per-case
// adjudication-pooling bug (see repinProtocol.test.ts's "pools used
// adjudications" test) was found only by running the real script.
//
// Cost: three real re-pins, ~9 s each. That is the price of testing the thing
// that ships rather than a re-implementation of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..");
const realCorpus = join(webDir, "bench", "corpus");
const CASES = ["sample-plan.json", "va-finish-plan.json"] as const;
const VA = "va-finish-plan.json";

/** what the repo's goldens looked like before this file ran a single re-pin */
const PRISTINE = new Map(CASES.map((f) => [f, readFileSync(join(realCorpus, f), "utf8")]));

const sandboxes: string[] = [];
process.on("exit", () => { for (const s of sandboxes) rmSync(s, { recursive: true, force: true }); });

/** A corpus copy at the same directory depth as the real one, so `pdf` paths
 *  relative to the case file still land on the demo PDFs. */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "repin-writepath-"));
  sandboxes.push(root);
  const dir = join(root, "web", "bench", "corpus");
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(webDir, "..", "demo"), join(root, "demo"), "dir");
  for (const f of CASES) copyFileSync(join(realCorpus, f), join(dir, f));
  return dir;
}

/** Run the real re-pin script against `dir`. Returns exit status and output. */
function repin(dir: string, ...args: string[]) {
  const r = spawnSync(process.execPath, ["--import", "tsx", "bench/pin-goldens.mts", ...args], {
    cwd: webDir, encoding: "utf8", timeout: 300_000,
    env: { ...process.env, REPIN_CORPUS_DIR: dir },
  });
  assert.equal(r.error, undefined, `could not run the re-pin script: ${r.error}`);
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const parse = (dir: string, f: string) => JSON.parse(read(dir, f));

// ── the perturbation ────────────────────────────────────────────────────────
// Everything below is done to the COPY on disk, i.e. to "the goldens as they
// were". The script's own probe list is untouched, so the re-pin sees:
//   • ward-room-294sf  REMOVED + ward-room ADDED   — a rename, both halves
//   • legacy-annex     REMOVED                     — a plain removal
const RENAMED_FROM = "ward-room-294sf", RENAMED_TO = "ward-room";
const STALE = "legacy-annex";
const STALE_SF = 30.86;   // 100×100 image px at ptPerFt 18

function perturb(dir: string) {
  const j = parse(dir, VA);
  for (const p of j.probes) if (p.name === RENAMED_TO) p.name = RENAMED_FROM;
  j.probes.push({
    name: STALE, seed: [6050, 3050], expect: "golden", tags: ["stale"],
    golden: [[6000, 3000], [6100, 3000], [6100, 3100], [6000, 3100]],
  });
  writeFileSync(join(dir, VA), JSON.stringify(j, null, 1));
}

const REASONS = {
  removed: "renamed to ward-room; the 294 SF baked into the old name stopped being true three re-pins ago",
  added: "the other half of that rename — same seed, same ring, a name that does not assert a stale number",
  stale: "this probe was pinned against a sheet region that is no longer part of the case at all",
};
const adjArgs = () => [
  `--adjudicate=${RENAMED_FROM}=${REASONS.removed}`,
  `--adjudicate=${RENAMED_TO}=${REASONS.added}`,
  `--adjudicate=${STALE}=${REASONS.stale}`,
];

// ── the three real runs, each done once and shared ──────────────────────────
// (`node:test` runs a file's tests in order; each scenario is memoised so the
// nine-second re-pins are not paid per assertion.)

let _fixpoint: { dir: string; code: number | null; out: string } | null = null;
/** an UNPERTURBED copy re-pinned: the no-op case, which must stay a no-op. */
const fixpoint = () => (_fixpoint ??= (() => { const dir = sandbox(); return { dir, ...repin(dir) }; })());

let _perturbed: {
  dir: string;
  before: string;                                   // the perturbed VA case, pre-run
  refused: { code: number | null; out: string };    // run with NO adjudications
  afterRefusal: string;                             // …and the file it left behind
  accepted: { code: number | null; out: string };   // the same re-pin, adjudicated
} | null = null;
const perturbed = () => (_perturbed ??= (() => {
  const dir = sandbox();
  perturb(dir);
  const before = read(dir, VA);
  const refused = repin(dir);                       // must refuse and write nothing
  const afterRefusal = read(dir, VA);
  const accepted = repin(dir, ...adjArgs());        // same tree, now adjudicated
  return { dir, before, refused, afterRefusal, accepted };
})());

/** case-level rows the script wrote for a removed probe */
const orphans = (dir: string, probe: string) =>
  (parse(dir, VA).adjudications as Array<Record<string, unknown>>).filter((a) => a.probe === probe);

// ── 1. the happy path still works, and is still a no-op ─────────────────────

test("WRITE PATH: re-pinning an unperturbed corpus copy rewrites it byte-for-byte", () => {
  const { dir, code, out } = fixpoint();
  assert.equal(code, 0, `a no-op re-pin must succeed:\n${out}`);
  assert.match(out, /wrote corpus\/va-finish-plan\.json/);
  for (const f of CASES)
    assert.equal(read(dir, f), PRISTINE.get(f),
      `${f} must round-trip unchanged — if this fails, every re-pin rewrites the corpus for reasons nobody asked about`);
});

test("WRITE PATH: a no-op re-pin invents no adjudications", () => {
  // The other half of "append-only": nothing moved, so nothing is appended.
  const j = parse(fixpoint().dir, VA);
  assert.equal(j.adjudications.length, 1, "just the A5b case-total row that was already there");
  assert.equal(j.probes.filter((p: { adjudications?: unknown[] }) => p.adjudications).length,
    JSON.parse(PRISTINE.get(VA)!).probes.filter((p: { adjudications?: unknown[] }) => p.adjudications).length);
});

// ── 2. an unadjudicated removal refuses, and writes nothing ─────────────────

test("WRITE PATH: an unadjudicated removal is refused with exit 1 and nothing is written", () => {
  const p = perturbed();
  assert.equal(p.refused.code, 1, `the re-pin must exit non-zero:\n${p.refused.out}`);
  assert.match(p.refused.out, /RE-PIN REFUSED — goldens on disk are unchanged/);
  assert.match(p.refused.out, new RegExp(`${RENAMED_FROM}: REMOVED from the case \\(was 235\\.\\d\\d SF\\)`));
  assert.match(p.refused.out, new RegExp(`${STALE}: REMOVED from the case \\(was ${STALE_SF} SF\\)`));
  assert.doesNotMatch(p.refused.out, /^wrote /m, "a refused re-pin must not write");
  assert.equal(p.afterRefusal, p.before, "the goldens on disk must be exactly as they were");
});

// ── 3. F4: the orphan adjudication survives, on the case ────────────────────

test("F4: a REMOVED probe's adjudication lands in the case-level array", () => {
  const p = perturbed();
  assert.equal(p.accepted.code, 0, `the adjudicated re-pin must succeed:\n${p.accepted.out}`);

  const rows = orphans(p.dir, STALE);
  // Before the fix this array was empty: the reason was typed, accepted by the
  // checker, printed in the diff — and then dropped, because a removed probe
  // has no new probe object to hang it on.
  assert.equal(rows.length, 1, `the removal reason must be on record: ${JSON.stringify(parse(p.dir, VA).adjudications)}`);
  assert.equal(rows[0].reason, REASONS.stale, "verbatim — a paraphrased reason is a different reason");
  assert.equal(rows[0].probe, STALE, "the row must name the probe it excuses");
  assert.equal(rows[0].removed_sf, STALE_SF, "…and what that probe last measured");
  assert.equal(rows[0].at, new Date().toISOString().slice(0, 10));
  // no `to_sf`: the probe stopped being measured, which is not a claim that the
  // floor now measures zero.
  assert.equal("to_sf" in rows[0], false);
});

test("F4: a RENAME records both halves — removal on the case, addition on the probe", () => {
  const p = perturbed(), j = parse(p.dir, VA);

  const names = j.probes.map((q: { name: string }) => q.name);
  assert.ok(!names.includes(RENAMED_FROM) && !names.includes(STALE), "both removals really left the corpus");
  assert.ok(names.includes(RENAMED_TO), "and the renamed probe is there under its new name");

  // removal half → case level, since there is no `ward-room-294sf` any more
  const removal = orphans(p.dir, RENAMED_FROM).filter((a) => a.removed_sf !== undefined);
  assert.equal(removal.length, 1);
  assert.equal(removal[0].reason, REASONS.removed);
  assert.equal(removal[0].removed_sf, 235.26);

  // addition half → the new probe's own append-only list, as before
  const added = j.probes.find((q: { name: string }) => q.name === RENAMED_TO).adjudications;
  assert.equal(added.length, 1, "a probe that did not exist on disk has no earlier history");
  assert.equal(added.at(-1).reason, REASONS.added);
  assert.equal(added.at(-1).from_sf, null, "an ADDED probe has no old SF");
  assert.equal(added.at(-1).to_sf, 235.26);

  // A rename must not launder SF: the two halves carry the same number, and the
  // case total is unmoved by the rename itself.
  assert.equal(removal[0].removed_sf, added.at(-1).to_sf,
    "if these ever differ, a rename moved floor and the diff called it two clean rows");
});

test("F4: the removed probe's EARLIER adjudications go to the case too, not to the bin", () => {
  // The probe object is what carried its history; deleting the probe deleted the
  // history, which is the same falsification one level up. `ward-room` arrives
  // in this test with one A5b-era adjudication on it.
  const p = perturbed();
  const prior = JSON.parse(PRISTINE.get(VA)!).probes.find((q: { name: string }) => q.name === RENAMED_TO).adjudications;
  assert.equal(prior.length, 1, "fixture check: the renamed-away probe had a history to lose");

  const rows = orphans(p.dir, RENAMED_FROM);
  assert.equal(rows.length, 2, "one carried-over row + the removal reason");
  assert.equal(rows[0].reason, prior[0].reason, "the earlier reason, verbatim");
  assert.equal(rows[0].from_sf, prior[0].from_sf, "…with the numbers it excused");
  assert.equal(rows[0].to_sf, prior[0].to_sf);
  assert.equal(rows[1].reason, REASONS.removed, "chronological: history first, then the removal");
});

test("F4: case-level rows stay printable by `npm run bench`", () => {
  // bench/run.mts reprints every adjudication on every run — that reprint is
  // half of why the reason is written down at all. Two things it needs:
  //  • `scope` is the subject it prints for a case-level row, so two removals in
  //    one re-pin must not print identically;
  //  • its formatter reads `to_sf` unconditionally once it sees a `from_sf`, so a
  //    row must carry both or neither, or the bench crashes on a null.
  const rows = parse(perturbed().dir, VA).adjudications as Array<Record<string, unknown>>;
  const scopes = rows.map((a) => a.scope);
  assert.deepEqual(scopes, [
    "case-total",
    `removed-probe ${RENAMED_FROM}`,
    `removed-probe ${RENAMED_FROM}`,
    `removed-probe ${STALE}`,
  ], "every case-level row is scoped, and an orphan's scope names its probe");
  for (const a of rows)
    assert.equal(a.from_sf != null && a.to_sf == null, false,
      `row ${JSON.stringify(a)} has from_sf without to_sf — bench/run.mts formats to_sf unconditionally and would throw`);
  assert.ok(rows.every((a) => typeof a.reason === "string" && (a.reason as string).length >= 20));
});

test("F4: the adjudicated re-pin is append-only and touches nothing else", () => {
  const p = perturbed(), j = parse(p.dir, VA), was = JSON.parse(PRISTINE.get(VA)!);

  // the pre-existing case-level row is still first and still verbatim
  assert.deepEqual(j.adjudications[0], was.adjudications[0], "existing adjudications are never rewritten");

  // no golden moved: the only changes are the rename and the two removals
  const goldens = (c: { probes: Array<{ name: string; golden?: unknown }> }) =>
    Object.fromEntries(c.probes.filter((q) => q.golden).map((q) => [q.name, JSON.stringify(q.golden)]));
  assert.deepEqual(goldens(j), goldens(was), "a metadata re-pin must not move a measurement");

  // and the OTHER case file went through untouched
  assert.equal(read(p.dir, "sample-plan.json"), PRISTINE.get("sample-plan.json"));
});

// ── 4. the repo's own goldens were never at risk ────────────────────────────

test("this test never wrote to the repo's corpus", () => {
  for (const f of CASES)
    assert.equal(readFileSync(join(realCorpus, f), "utf8"), PRISTINE.get(f),
      `${f} changed during the write-path test — the sandbox seam leaked`);
});
