// Ingest zip bounds — the entry-count and nesting-depth caps, exercised
// through the public ingestFiles() path with zips built in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { ingestFiles } from "../src/lib/ingest.js";

const zipFile = (entries: Record<string, Uint8Array>, name = "set.zip") =>
  new File([zipSync(entries)], name, { type: "application/zip" });

test("a normal plan-set zip ingests every sheet", async () => {
  const { pdfs, skipped } = await ingestFiles([zipFile({
    "A1.pdf": strToU8("%PDF-1.4 a"),
    "sub/A2.pdf": strToU8("%PDF-1.4 b"),
    "__MACOSX/._A1.pdf": strToU8("junk"),
    "notes.txt": strToU8("skip me"),
  })]);
  assert.equal(pdfs.length, 2);
  assert.deepEqual(skipped.map((s) => s.name), ["notes.txt"]);
});

test("zip entry cap: entries beyond the cap are skipped with a reason, not exploded", async () => {
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i < 510; i++) entries[`p${String(i).padStart(3, "0")}.pdf`] = strToU8("x");
  const { pdfs, skipped } = await ingestFiles([zipFile(entries)]);
  assert.equal(pdfs.length, 500);
  assert.equal(skipped.length, 10);
  assert.match(skipped[0].reason, /entry cap/);
});

test("zip-in-zip works once; deeper nesting is refused", async () => {
  const inner = zipSync({ "deep.pdf": strToU8("%PDF-1.4") });
  const middle = zipSync({ "inner.zip": inner, "mid.pdf": strToU8("%PDF-1.4") });
  const outer = zipFile({ "middle.zip": middle, "top.pdf": strToU8("%PDF-1.4") });
  const { pdfs, skipped } = await ingestFiles([outer]);
  // top.pdf (depth 0) + mid.pdf (depth 1) land; inner.zip sits at depth 2 -> refused
  assert.deepEqual(pdfs.map((p) => p.name).sort(), ["mid.pdf", "top.pdf"]);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /nested deeper/);
});

test("the shared budget spans sibling zips in one drop", async () => {
  const half: Record<string, Uint8Array> = {};
  for (let i = 0; i < 300; i++) half[`a${i}.pdf`] = strToU8("x");
  const { pdfs, skipped } = await ingestFiles([zipFile(half, "one.zip"), zipFile(half, "two.zip")]);
  assert.equal(pdfs.length, 500);                          // 300 + 200, not 600
  assert.equal(skipped.length, 100);
});
