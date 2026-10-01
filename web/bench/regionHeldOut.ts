// The one held-out run of bench:regions: freeze record, guard, append-only
// log and output routing (docs/design/REGION_ANNOTATION_PLAN.md, "Held-out
// rules"). Side effects go through an injected `Env` (git, file read/append,
// clock), so test/regionHeldOut.test.ts exercises it on throw-away repos.
//
// The guard refuses `--held-out` unless ALL hold:
//  - `--reason "<why>"` is given (non-blank);
//  - a freeze record exists (evals/regions/freeze.json, written by
//    bench/regionsFreeze.mts at a clean commit);
//  - the log only ever grew: the committed log at the freeze commit and at
//    every commit since (and HEAD's) is a byte prefix of the working log; a
//    missing log where one was committed is refused;
//  - the working tree is clean (the held-out log itself excepted);
//  - HEAD descends from the freeze commit;
//  - freeze.json is unforged: the commit that last wrote it changes only
//    freeze.json, has exactly one parent and that parent is freeze.commit,
//    and its content there is byte-identical to the working file;
//  - the hash over FREEZE_SOURCES (detector, adapter, scorer, bench, guard,
//    answer keys) and the parameter defaults, computed from
//    `git show <freeze.commit>:<path>`, equals freeze.hash, and the same hash
//    from HEAD's sources (and the working tree's) equals it too
//    (REGION_LOGIC_REV is information only);
//  - no held-out run has started at this hash before (a re-run needs a new
//    freeze, i.e. a changed hash, and its reason).
// Every refusal, every start (before any held-out page is opened) and every
// finish is appended to evals/regions/heldout-runs.jsonl.
import { createHash } from "node:crypto";

/** Everything that decides a held-out number: the detector and region map,
 * the PDF adapter (and the app code it calls), the scorer and bench, this
 * guard, and the answer keys. Any change after the freeze changes the hash. */
export const FREEZE_SOURCES = [
  "web/src/lib/regionDetect.ts", "web/src/lib/regions.ts",
  "web/src/lib/sheets.ts", "web/src/lib/oneclick.ts", "web/src/lib/takeoffConstants.ts",
  "web/bench/regionSheets.ts", "web/bench/regionSheets.mts", "web/bench/regionScore.ts", "web/bench/regionRun.mts",
  "web/bench/regions.mts", "web/bench/regionHeldOut.ts", "web/bench/regionsReconcile.mts",
  "evals/regions/labels/reconciled.json", "evals/regions/labels/labeler-A.json", "evals/regions/labels/labeler-B.json",
];
export const FREEZE_FILE = "evals/regions/freeze.json";
export const HELDOUT_LOG = "evals/regions/heldout-runs.jsonl";
export const RESULTS_FILE = "web/bench/regions-results.json";
export const HELDOUT_RESULTS_FILE = "web/bench/regions-heldout-results.json";

export interface Env {
  git(args: string[]): { code: number; out: string };
  /** Repo-relative path → text, or null when absent. */
  readText(path: string): string | null;
  /** Append to a repo-relative file (created when absent). */
  appendText(path: string, text: string): void;
  now(): string;
}

export interface Freeze {
  frozenAt: string; commit: string; hash: string;
  sources: Record<string, string>;          // path → sha256 of its content
  [extra: string]: unknown;                  // params, logicRev, … (information)
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The freeze hash: sha256 of the canonical params and each source's sha256 (sorted by path). */
export function freezeHash(sources: Readonly<Record<string, string>>, paramsCanonical: string): { hash: string; sources: Record<string, string> } {
  const shas: Record<string, string> = {};
  for (const p of Object.keys(sources).sort()) shas[p] = sha256(sources[p]);
  return { hash: sha256(JSON.stringify({ params: paramsCanonical, sources: Object.entries(shas) })), sources: shas };
}

/** The hash of the working tree's detector sources and the given params. */
export function currentFreeze(env: Env, paramsCanonical: string): { hash: string; sources: Record<string, string> } {
  const src: Record<string, string> = {};
  for (const p of FREEZE_SOURCES) {
    const t = env.readText(p);
    if (t === null) throw new Error(`freeze: ${p} is missing`);
    src[p] = t;
  }
  return freezeHash(src, paramsCanonical);
}

/** A freeze record for HEAD (call at a clean commit; bench/regionsFreeze.mts checks). */
export function makeFreeze(env: Env, paramsCanonical: string, extra: Record<string, unknown> = {}): Freeze {
  const { hash, sources } = currentFreeze(env, paramsCanonical);
  return { frozenAt: env.now(), commit: env.git(["rev-parse", "HEAD"]).out.trim(), hash, sources, ...extra };
}

export function readFreeze(env: Env): Freeze | null {
  const t = env.readText(FREEZE_FILE);
  if (t === null) return null;
  try {
    const f = JSON.parse(t);
    return typeof f?.commit === "string" && typeof f?.hash === "string" ? f : null;
  } catch { return null; }
}

export interface LogEntry { type: "refused" | "start" | "finish"; at: string; commit: string; hash: string | null; reason: string; argv: string[]; [k: string]: unknown }
export function readLog(env: Env): LogEntry[] {
  const t = env.readText(HELDOUT_LOG) ?? "";
  return t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
const append = (env: Env, e: LogEntry) => env.appendText(HELDOUT_LOG, JSON.stringify(e) + "\n");

export function parseArgs(argv: readonly string[]): { heldOut: boolean; reason: string; sensitivity: boolean } {
  const i = argv.indexOf("--reason");
  const r = i >= 0 ? argv[i + 1] : undefined;
  return { heldOut: argv.includes("--held-out"), reason: r && !r.startsWith("--") ? r : "", sensitivity: argv.includes("--sensitivity") };
}

export type Preflight =
  | { mode: "normal" }
  | { mode: "held-out"; ok: true; head: string; hash: string; freeze: Freeze; reason: string; rerunOf: LogEntry[] }
  | { mode: "held-out"; ok: false; why: string };

/** Decide whether this invocation may run held-out; log a refusal. */
export function preflight(argv: readonly string[], env: Env, paramsCanonical: string): Preflight {
  const args = parseArgs(argv);
  if (!args.heldOut) return { mode: "normal" };
  const head = env.git(["rev-parse", "HEAD"]).out.trim();
  let hash: string | null = null;
  try { hash = currentFreeze(env, paramsCanonical).hash; } catch { /* reported below */ }
  const refuse = (why: string): Preflight => {
    append(env, { type: "refused", at: env.now(), commit: head, hash, reason: args.reason, argv: [...argv], why });
    return { mode: "held-out", ok: false, why };
  };
  if (!args.reason.trim()) return refuse("--reason \"<why this run>\" is required for a held-out run");
  const freeze = readFreeze(env);
  if (!freeze) return refuse(`no freeze record (${FREEZE_FILE}); freeze the constants first`);
  const logWhy = logIntegrity(env, freeze.commit);
  if (logWhy) return refuse(logWhy);
  const st = env.git(["status", "--porcelain", "--", ".", `:!${HELDOUT_LOG}`]);
  if (st.code !== 0) return refuse("cannot check the working tree (git status failed)");
  if (st.out.trim()) return refuse(`working tree is dirty:\n${st.out.trim()}`);
  const anc = env.git(["merge-base", "--is-ancestor", freeze.commit, "HEAD"]);
  if (anc.code === 1) return refuse(`HEAD ${head} does not descend from the freeze commit ${freeze.commit}`);
  if (anc.code !== 0) return refuse(`cannot tell whether HEAD descends from the freeze commit ${freeze.commit} (git exited ${anc.code}; shallow clone?)`);
  const forged = freezeIntegrity(env, freeze);
  if (forged) return refuse(forged);
  const atFreeze = hashAt(env, freeze.commit, paramsCanonical);
  if (atFreeze === null) return refuse(`a frozen source is missing at the freeze commit ${freeze.commit}`);
  if (atFreeze !== freeze.hash) return refuse(`freeze.hash ${freeze.hash} does not match the sources at the freeze commit (${atFreeze}): freeze record forged or stale`);
  const atHead = hashAt(env, "HEAD", paramsCanonical);
  if (atHead === null || hash === null) return refuse("cannot compute the current hash (a frozen source is missing)");
  if (atHead !== freeze.hash || hash !== freeze.hash) return refuse(`hash differs: HEAD ${atHead}, working tree ${hash}, frozen ${freeze.hash} (a frozen source or constant changed since ${freeze.frozenAt}); re-freeze and give the reason`);
  const starts = readLog(env).filter((e) => e.type === "start");
  if (starts.some((e) => e.hash === hash)) return refuse(`a held-out run already started at this hash (${hash}); a re-run needs a changed, re-frozen detector and a reason`);
  return { mode: "held-out", ok: true, head, hash, freeze, reason: args.reason, rerunOf: starts };
}

/** The hash of the frozen sources as committed at `rev` (null if one is missing there). */
export function hashAt(env: Env, rev: string, paramsCanonical: string): string | null {
  const src: Record<string, string> = {};
  for (const p of FREEZE_SOURCES) {
    const r = env.git(["show", `${rev}:${p}`]);
    if (r.code !== 0) return null;
    src[p] = r.out;
  }
  return freezeHash(src, paramsCanonical).hash;
}

/** The log only grew since the freeze: every committed version from the freeze commit on is a
 * byte prefix of the working log. Returns why not, or null. */
export function logIntegrity(env: Env, freezeCommit: string): string | null {
  const working = env.readText(HELDOUT_LOG);
  const revs = new Set<string>([freezeCommit]);
  const rl = env.git(["rev-list", `${freezeCommit}..HEAD`]);
  if (rl.code === 0) for (const c of rl.out.split("\n")) if (c.trim()) revs.add(c.trim());
  revs.add("HEAD");
  for (const c of revs) {
    const r = env.git(["show", `${c}:${HELDOUT_LOG}`]);
    if (r.code !== 0) continue;   // not committed there
    if (working === null) return `the held-out log ${HELDOUT_LOG} is missing but was committed at ${c} (this refusal is appended to a fresh log)`;
    if (!working.startsWith(r.out)) return `the held-out log was truncated or rewritten: the version committed at ${c} is not a prefix of the working log`;
  }
  return null;
}

/** freeze.json unforged: last written by a freeze-only commit whose only parent is freeze.commit,
 * byte-identical there and in the working tree. Returns why not, or null. */
export function freezeIntegrity(env: Env, freeze: Freeze): string | null {
  const last = env.git(["log", "-1", "--format=%H", "--", FREEZE_FILE]).out.trim();
  if (!last) return `${FREEZE_FILE} is not committed`;
  const there = env.git(["show", `${last}:${FREEZE_FILE}`]);
  if (there.code !== 0 || there.out !== env.readText(FREEZE_FILE)) return `${FREEZE_FILE} differs from its version in ${last}`;
  const parents = env.git(["rev-list", "--parents", "-n", "1", last]).out.trim().split(/\s+/).slice(1);
  if (parents.length !== 1 || parents[0] !== freeze.commit) return `${FREEZE_FILE} was last written in ${last}, whose parent(s) ${parents.join(", ") || "none"} are not the freeze commit ${freeze.commit}: freeze record forged`;
  const files = env.git(["diff-tree", "--no-commit-id", "--name-only", "-r", last]).out.split("\n").map((x) => x.trim()).filter(Boolean);
  if (files.length !== 1 || files[0] !== FREEZE_FILE) return `the commit that last wrote ${FREEZE_FILE} (${last}) also changes ${files.filter((f) => f !== FREEZE_FILE).join(", ")}: a freeze commit changes only ${FREEZE_FILE}`;
  return null;
}

type Allowed = Extract<Preflight, { ok: true }>;
/** Append the start entry; call before any held-out page is opened. */
export function logStart(env: Env, p: Allowed, argv: readonly string[]): void {
  append(env, { type: "start", at: env.now(), commit: p.head, hash: p.hash, reason: p.reason, argv: [...argv], freezeCommit: p.freeze.commit, rerunOf: p.rerunOf.map((e) => ({ at: e.at, hash: e.hash })) });
}
/** Append the result summary after the run. */
export function logFinish(env: Env, p: Allowed, summary: unknown): void {
  append(env, { type: "finish", at: env.now(), commit: p.head, hash: p.hash, reason: p.reason, argv: [], summary });
}

export const resultsPath = (mode: "normal" | "held-out"): string => (mode === "held-out" ? HELDOUT_RESULTS_FILE : RESULTS_FILE);
export const sectionRoles = (mode: "normal" | "held-out"): Array<"tune" | "in-sample" | "held-out"> =>
  mode === "held-out" ? ["tune", "in-sample", "held-out"] : ["tune", "in-sample"];

export interface SensitivityRun { constant: string; key: string; value: number; role: "chosen" | "low" | "high" }
/** Per calibrated constant: the chosen value and both ends of the range over
 * which the tune result was unchanged (sensitivity only; never used to pick
 * values). Duplicate values are dropped. */
export function sensitivityPlan(cal: { constants: ReadonlyArray<{ constant: string; key: string; chosen: number; unchangedRange: readonly [number, number] | number[] }> }): SensitivityRun[] {
  const out: SensitivityRun[] = [];
  for (const c of cal.constants) {
    const seen = new Set<number>();
    for (const [value, role] of [[c.chosen, "chosen"], [c.unchangedRange[0], "low"], [c.unchangedRange[1], "high"]] as const) {
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ constant: c.constant, key: c.key, value, role });
    }
  }
  return out;
}
