// bench/regionHeldOut.ts — the held-out run's guard, log and plumbing, on
// throw-away git repositories in the OS temp dir (never the real repo, never
// held-out data).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import {
  FREEZE_SOURCES, FREEZE_FILE, HELDOUT_LOG, RESULTS_FILE, HELDOUT_RESULTS_FILE,
  freezeHash, currentFreeze, makeFreeze, preflight, logStart, logFinish, readLog, resultsPath, sectionRoles, sensitivityPlan, parseArgs,
  type Env,
} from "../bench/regionHeldOut.ts";

const PARAMS = '{"a":1}';

function repoEnv(dir: string, now = "2026-10-01T01:00:00Z"): Env {
  return {
    git: (args) => { const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }); return { code: r.status ?? 128, out: r.stdout ?? "" }; },
    readText: (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf8") : null),
    appendText: (p, t) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); appendFileSync(join(dir, p), t); },
    now: () => now,
  };
}
const sh = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (dir: string, p: string, text: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); };

let dir: string;
let env: Env;
/** A repo with the two detector sources, an empty log, and a freeze at the source commit. */
function setup() {
  dir = mkdtempSync(join(tmpdir(), "heldout-guard-"));
  sh(dir, "init", "-q", "-b", "main");
  put(dir, FREEZE_SOURCES[0], "detector v1\n");
  put(dir, FREEZE_SOURCES[1], "regions v1\n");
  put(dir, HELDOUT_LOG, "");
  sh(dir, "add", "-A"); sh(dir, "commit", "-q", "-m", "sources");
  env = repoEnv(dir);
  const f = makeFreeze(env, PARAMS, { logicRev: 2, params: { a: 1 } });
  put(dir, FREEZE_FILE, JSON.stringify(f));
  sh(dir, "add", "-A"); sh(dir, "commit", "-q", "-m", "freeze");
}
const HELD = ["--held-out", "--reason", "the one held-out run"];

describe("held-out guard", () => {
  beforeEach(setup);
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("the flag is required: without --held-out the run is normal, held-out is not a section, results go to the normal file", () => {
    assert.deepEqual(preflight(["--reason", "x"], env, PARAMS), { mode: "normal" });
    assert.deepEqual(sectionRoles("normal"), ["tune", "in-sample"]);
    assert.deepEqual(sectionRoles("held-out"), ["tune", "in-sample", "held-out"]);
    assert.equal(resultsPath("normal"), RESULTS_FILE);
    assert.equal(readLog(env).length, 0);
  });

  test("a clean tree at the frozen source, with a reason, is allowed", () => {
    const p = preflight(HELD, env, PARAMS);
    assert.equal(p.mode, "held-out");
    assert.ok(p.mode === "held-out" && p.ok, JSON.stringify(p));
  });

  test("--reason is required (and must not be blank)", () => {
    for (const argv of [["--held-out"], ["--held-out", "--reason"], ["--held-out", "--reason", "  "]]) {
      const p = preflight(argv, env, PARAMS);
      assert.ok(p.mode === "held-out" && !p.ok);
      assert.match((p as { why: string }).why, /reason/);
    }
  });

  test("a dirty tree is refused (tracked change or untracked file); the log itself does not count", () => {
    put(dir, FREEZE_SOURCES[1], "regions v1\n// edit\n");
    let p = preflight(HELD, env, PARAMS);
    assert.ok(p.mode === "held-out" && !p.ok && /dirty/.test(p.why));
    sh(dir, "checkout", "--", FREEZE_SOURCES[1]);
    put(dir, "scratch.txt", "x");
    p = preflight(HELD, env, PARAMS);
    assert.ok(p.mode === "held-out" && !p.ok && /dirty/.test(p.why));
    rmSync(join(dir, "scratch.txt"));
    // the refusals above were appended to the log, which is excluded from the dirty check
    assert.ok(readLog(env).length >= 2);
    p = preflight(HELD, env, PARAMS);
    assert.ok(p.mode === "held-out" && p.ok, JSON.stringify(p));
  });

  test("a detector source change after the freeze (committed) is a hash mismatch", () => {
    put(dir, FREEZE_SOURCES[0], "detector v2\n");
    sh(dir, "commit", "-q", "-am", "logic change");
    const p = preflight(HELD, env, PARAMS);
    assert.ok(p.mode === "held-out" && !p.ok && /hash/.test(p.why), JSON.stringify(p));
  });

  test("a parameter change is a hash mismatch", () => {
    const p = preflight(HELD, env, '{"a":2}');
    assert.ok(p.mode === "held-out" && !p.ok && /hash/.test(p.why));
  });

  test("HEAD that does not descend from the freeze commit is refused", () => {
    const freeze = JSON.parse(readFileSync(join(dir, FREEZE_FILE), "utf8"));
    // a branch from before the freeze's source commit, carrying the same sources and freeze file
    sh(dir, "checkout", "-q", "--orphan", "other");
    sh(dir, "commit", "-q", "-m", "unrelated");
    assert.notEqual(sh(dir, "rev-parse", "HEAD"), freeze.commit);
    const p = preflight(HELD, env, PARAMS);
    assert.ok(p.mode === "held-out" && !p.ok && /descend/.test(p.why), JSON.stringify(p));
  });

  test("no freeze record → refused", () => {
    sh(dir, "rm", "-q", FREEZE_FILE); sh(dir, "commit", "-q", "-m", "unfreeze");
    const p = preflight(HELD, env, PARAMS);
    assert.ok(p.mode === "held-out" && !p.ok && /freeze/.test(p.why));
  });

  test("every refusal is logged with time, commit, hash, reason, argv and why", () => {
    preflight(["--held-out"], env, PARAMS);
    const log = readLog(env);
    assert.equal(log.length, 1);
    const e = log[0];
    assert.equal(e.type, "refused");
    assert.equal(e.at, "2026-10-01T01:00:00Z");
    assert.equal(e.commit, sh(dir, "rev-parse", "HEAD"));
    assert.equal(e.hash, currentFreeze(env, PARAMS).hash);
    assert.deepEqual(e.argv, ["--held-out"]);
    assert.equal(e.reason, "");
    assert.match(String(e.why), /reason/);
  });

  test("start is logged before the run, the result after; the log is append-only", () => {
    const p = preflight(HELD, env, PARAMS);
    assert.ok(p.mode === "held-out" && p.ok);
    logStart(env, p, HELD);
    logFinish(env, p, { pass: 30, n: 34 });
    const log = readLog(env);
    assert.deepEqual(log.map((e) => e.type), ["start", "finish"]);
    assert.equal(log[0].reason, "the one held-out run");
    assert.deepEqual(log[0].argv, HELD);
    assert.deepEqual(log[1].summary, { pass: 30, n: 34 });
    assert.equal(log[0].hash, log[1].hash);
    const before = readFileSync(join(dir, HELDOUT_LOG), "utf8");
    preflight(["--held-out"], env, PARAMS);
    assert.ok(readFileSync(join(dir, HELDOUT_LOG), "utf8").startsWith(before));
  });

  test("a second held-out run at the same hash is refused; after a re-freeze with a new hash it is allowed", () => {
    const p = preflight(HELD, env, PARAMS);
    assert.ok(p.mode === "held-out" && p.ok);
    logStart(env, p, HELD);
    sh(dir, "commit", "-q", "-am", "log the run");
    const again = preflight(HELD, env, PARAMS);
    assert.ok(again.mode === "held-out" && !again.ok && /already/.test(again.why), JSON.stringify(again));
    // a logic change, re-frozen: new hash, so a re-run with a reason is allowed (and marked as a re-run)
    put(dir, FREEZE_SOURCES[0], "detector v2\n");
    sh(dir, "commit", "-q", "-am", "fix");
    put(dir, FREEZE_FILE, JSON.stringify(makeFreeze(env, PARAMS, { logicRev: 3, params: { a: 1 } })));
    sh(dir, "commit", "-q", "-am", "re-freeze");
    const re = preflight(["--held-out", "--reason", "re-run after fixing X"], env, PARAMS);
    assert.ok(re.mode === "held-out" && re.ok, JSON.stringify(re));
    assert.equal(re.rerunOf.length, 1);
  });

  test("held-out results go to their own file", () => {
    assert.equal(resultsPath("held-out"), HELDOUT_RESULTS_FILE);
    assert.notEqual(RESULTS_FILE, HELDOUT_RESULTS_FILE);
  });
});

describe("freezeHash", () => {
  test("covers every source's content and the params; order of sources does not matter", () => {
    const a = freezeHash({ "x.ts": "1", "y.ts": "2" }, PARAMS).hash;
    assert.equal(freezeHash({ "y.ts": "2", "x.ts": "1" }, PARAMS).hash, a);
    assert.notEqual(freezeHash({ "x.ts": "1 ", "y.ts": "2" }, PARAMS).hash, a);
    assert.notEqual(freezeHash({ "x.ts": "1", "y.ts": "2" }, '{"a":2}').hash, a);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
  test("the frozen sources are the detector and the region map module", () => {
    assert.deepEqual(FREEZE_SOURCES, ["web/src/lib/regionDetect.ts", "web/src/lib/regions.ts"]);
  });
});

describe("parseArgs and sensitivityPlan", () => {
  test("--reason takes the next argument", () => {
    assert.deepEqual(parseArgs(["--held-out", "--reason", "why"]), { heldOut: true, reason: "why", sensitivity: false });
    assert.deepEqual(parseArgs(["--sensitivity"]), { heldOut: false, reason: "", sensitivity: true });
  });
  test("per constant: the chosen value and both ends of its unchanged-on-tune range, de-duplicated", () => {
    const plan = sensitivityPlan({
      constants: [
        { constant: "A", key: "a", chosen: 0.5, unchangedRange: [0.2, 0.9] },
        { constant: "B", key: "b", chosen: 2, unchangedRange: [2, 2] },
      ],
    });
    assert.deepEqual(plan, [
      { constant: "A", key: "a", value: 0.5, role: "chosen" },
      { constant: "A", key: "a", value: 0.2, role: "low" },
      { constant: "A", key: "a", value: 0.9, role: "high" },
      { constant: "B", key: "b", value: 2, role: "chosen" },
    ]);
  });
});
