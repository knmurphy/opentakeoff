// fetch.test.mjs — offline tests for the evaluation-set fetcher.
// Run: node --test evals/regions/fetch.test.mjs   (no network; fetch is stubbed)

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SETS, verify, download } from "./fetch.mjs";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const ROLES = new Set(["tune", "in-sample", "held-out"]);

function withTempDir(fn) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "regions-fetch-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function stubFetch(impl) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return impl(...args);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("verify passes on a matching buffer", () => {
  const buf = Buffer.from("hello drawings");
  assert.equal(verify(buf, sha(buf)), true);
});

test("verify throws naming both hashes on mismatch", () => {
  const buf = Buffer.from("hello drawings");
  const expected = "0".repeat(64);
  const actual = sha(buf);
  assert.throws(
    () => verify(buf, expected),
    (err) => err instanceof Error && err.message.includes(expected) && err.message.includes(actual),
  );
});

test("SETS is well-formed", () => {
  assert.ok(Array.isArray(SETS) && SETS.length > 0);
  const files = new Set();
  for (const s of SETS) {
    assert.match(s.file, /^[a-z0-9-]+\.pdf$/, `file ${s.file}`);
    assert.match(s.resourceId, /^[0-9a-f]{32}$/, `resourceId of ${s.file}`);
    assert.match(s.sha256, /^[0-9a-f]{64}$/, `sha256 of ${s.file}`);
    assert.ok(Number.isInteger(s.pages) && s.pages > 0, `pages of ${s.file}`);
    assert.ok(ROLES.has(s.role), `role of ${s.file}: ${s.role}`);
    assert.ok(!files.has(s.file), `duplicate file ${s.file}`);
    files.add(s.file);
  }
  const heldOutPages = SETS.filter((s) => s.role === "held-out").reduce((n, s) => n + s.pages, 0);
  assert.equal(heldOutPages, 34, "held-out page total matches the plan");
});

test("download skips a file that already verifies, without fetching", withTempDir(async (dir) => {
  const bytes = Buffer.from("already here");
  const set = { file: "x.pdf", resourceId: "a".repeat(32), sha256: sha(bytes), pages: 1, role: "tune" };
  writeFileSync(join(dir, set.file), bytes);
  const stub = stubFetch(() => { throw new Error("fetch must not be called"); });
  try {
    const result = await download(set, dir, { sleep: async () => {} });
    assert.equal(result.status, "skipped");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 0);
}));

test("download writes a file whose bytes verify", withTempDir(async (dir) => {
  const bytes = Buffer.from("fresh bytes");
  const set = { file: "y.pdf", resourceId: "b".repeat(32), sha256: sha(bytes), pages: 1, role: "tune" };
  const stub = stubFetch(() => new Response(bytes, { status: 200 }));
  try {
    const result = await download(set, dir, { sleep: async () => {} });
    assert.equal(result.status, "downloaded");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 1);
  assert.match(String(stub.calls[0][0]), new RegExp(`/resources/files/${"b".repeat(32)}/download$`));
  assert.deepEqual(readFileSync(join(dir, set.file)), bytes);
  assert.deepEqual(readdirSync(dir), [set.file], "no temp files left behind");
}));

test("download fails loudly when downloaded bytes do not verify", withTempDir(async (dir) => {
  const expected = "c".repeat(64);
  const wrong = Buffer.from("wrong bytes");
  const set = { file: "z.pdf", resourceId: "c".repeat(32), sha256: expected, pages: 1, role: "held-out" };
  const stub = stubFetch(() => new Response(wrong, { status: 200 }));
  const sleeps = [];
  try {
    await assert.rejects(
      download(set, dir, { sleep: async (ms) => { sleeps.push(ms); } }),
      (err) => err.message.includes(expected) && err.message.includes(sha(wrong)) && err.message.includes("z.pdf"),
    );
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 5, "1 attempt + 4 retries");
  assert.deepEqual(sleeps, [2000, 4000, 8000, 16000]);
  assert.equal(existsSync(join(dir, set.file)), false, "bad bytes never land at the final path");
  assert.deepEqual(readdirSync(dir), [], "no temp files left behind");
}));

test("download retries an HTTP error and then succeeds", withTempDir(async (dir) => {
  const bytes = Buffer.from("second try");
  const set = { file: "w.pdf", resourceId: "d".repeat(32), sha256: sha(bytes), pages: 1, role: "tune" };
  let n = 0;
  const stub = stubFetch(() => (++n === 1 ? new Response("busy", { status: 503 }) : new Response(bytes, { status: 200 })));
  const sleeps = [];
  try {
    const result = await download(set, dir, { sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(result.status, "downloaded");
  } finally {
    stub.restore();
  }
  assert.deepEqual(sleeps, [2000]);
  assert.deepEqual(readFileSync(join(dir, set.file)), bytes);
}));
