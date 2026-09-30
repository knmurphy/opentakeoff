#!/usr/bin/env node
// fetch.mjs — download the region-annotation evaluation sets from SAM.gov and
// check each file's sha256. The PDFs are not committed and CI never runs this;
// see SOURCE.md for provenance and the held-out access log.
//
//   node evals/regions/fetch.mjs [dir] [--role tune|in-sample|held-out]
//
// dir defaults to evals/regions/pdfs/ (gitignored). One line per file; exits
// non-zero if any file fails to download or verify. No dependencies; Node >= 22.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROLES = ["tune", "in-sample", "held-out"];

// Held-out sets must not be opened before the constants are frozen (see
// docs/design/REGION_ANNOTATION_PLAN.md, "Evaluation data").
export const SETS = [
  { file: "shreveport-combined.pdf", resourceId: "02bfbae88d3644e185c670eb74d3479f", sha256: "4594fe00e04c5dedf9e1bc468336d2967405e605158874c56dc08335c6823dfd", pages: 24, role: "tune" },
  { file: "dublin-part1.pdf", resourceId: "d116af76e9fc489baba6c9f9c4ca5734", sha256: "b53cdfa35f55fd2e00451922612d38ec694b4674f5f40c39656a185991aa59e2", pages: 11, role: "in-sample" },
  { file: "dublin-part4.pdf", resourceId: "636c1e4c1e674f5d9d0195168aa555ad", sha256: "4b58cff60984c662d60891c1e447bbd203794f89df954899918f09679be37b1f", pages: 13, role: "in-sample" },
  { file: "dublin-part2.pdf", resourceId: "ebec0f42a8b142cb9c85a2f4dfcb0e2d", sha256: "c7f8ad67ea321c98d40fde333f66aeed11f1ea6cb79e56479de768511aa3f989", pages: 7, role: "held-out" },
  { file: "dublin-part5.pdf", resourceId: "b6817f965d1e492e8fc1c5d74589bd29", sha256: "e2397b40bfa20841609888959e5c841aba4583628e04dfb6bd21c8bf7497612d", pages: 10, role: "held-out" },
  { file: "dublin-part7.pdf", resourceId: "c253e6e493f0489e9d0afafda37a1c34", sha256: "53344408d992e8352ecedb58646ec04a50c0470f943b48e46335c935ba05e308", pages: 7, role: "held-out" },
  { file: "dublin-part10.pdf", resourceId: "3f4cc58d6aa2487b981faa2a2aff35f7", sha256: "278f734f81b0fb1b7fcae22da73d3e84e881d6dbfdfc7a2911eef7e8fd0b9a7d", pages: 4, role: "held-out" },
  { file: "dublin-part11.pdf", resourceId: "c7b35aee39cd4d28af5a1798f5bc49bc", sha256: "67dde74f704a38904ebcbe7638205948ebd35d498129ac1fb5b7b2554f1041d2", pages: 5, role: "held-out" },
  { file: "dublin-part13.pdf", resourceId: "a7567eb6fb154afead3dc374fa1ccdec", sha256: "e66e4a65ee974b6b166511046a3ff5b279f4d24c9ec9d9767ab65888954430dc", pages: 1, role: "held-out" },
];

const BACKOFF_MS = [2000, 4000, 8000, 16000];

export const downloadUrl = (resourceId) =>
  `https://sam.gov/api/prod/opps/v3/opportunities/resources/files/${resourceId}/download`;

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function verify(buffer, sha256) {
  const actual = sha256Hex(buffer);
  if (actual !== sha256) {
    throw new Error(`sha256 mismatch: expected ${sha256}, got ${actual}`);
  }
  return true;
}

async function readIfExists(path) {
  try {
    return await readFile(path);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns { status: "skipped" | "downloaded", path }. Throws after the last
// retry, naming the file and the final error (hash mismatch or HTTP failure).
export async function download(set, dir, { sleep = defaultSleep } = {}) {
  const path = join(dir, set.file);
  const existing = await readIfExists(path);
  if (existing) {
    try {
      verify(existing, set.sha256);
      return { status: "skipped", path };
    } catch {
      // Stale or corrupt: fall through and re-download over it.
    }
  }

  await mkdir(dir, { recursive: true });
  let lastError;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]);
    const tmp = `${path}.${process.pid}.${attempt}.part`;
    try {
      const res = await fetch(downloadUrl(set.resourceId), { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      const buf = Buffer.from(await res.arrayBuffer());
      verify(buf, set.sha256);
      await writeFile(tmp, buf);
      await rename(tmp, path);
      return { status: "downloaded", path };
    } catch (err) {
      lastError = err;
      await rm(tmp, { force: true });
    }
  }
  throw new Error(`${set.file}: failed after ${BACKOFF_MS.length + 1} attempts: ${lastError.message}`);
}

function parseArgs(argv) {
  let dir = null;
  let role = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--role") role = argv[++i];
    else if (a.startsWith("--role=")) role = a.slice("--role=".length);
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else if (dir === null) dir = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (role !== null && !ROLES.includes(role)) {
    throw new Error(`--role must be one of ${ROLES.join(", ")} (got ${role})`);
  }
  return { dir, role };
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`fetch.mjs: ${err.message}`);
    console.error("usage: node evals/regions/fetch.mjs [dir] [--role tune|in-sample|held-out]");
    return 2;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = args.dir ? resolve(args.dir) : join(here, "pdfs");
  const sets = SETS.filter((s) => !args.role || s.role === args.role);
  let failures = 0;
  for (const set of sets) {
    try {
      const { status } = await download(set, dir);
      console.log(`ok   ${status.padEnd(10)} ${set.file} (${set.role}, ${set.pages} pp)`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${set.file}: ${err.message}`);
    }
  }
  console.log(`${sets.length - failures}/${sets.length} verified in ${dir}`);
  return failures ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
