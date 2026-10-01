// Freeze the region detector for the held-out run: writes
// evals/regions/freeze.json with the commit, the time and the hash over the
// detector sources (bench/regionHeldOut.ts FREEZE_SOURCES) and the parameter
// defaults. Run at a clean commit after the calibration is committed, then
// commit the file:
//   npm run bench:regions:freeze
import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_REGION_PARAMS, REGION_LOGIC_REV, regionParamsCanonical } from "../src/lib/regionDetect.ts";
import { makeFreeze, FREEZE_FILE, HELDOUT_LOG, type Env } from "./regionHeldOut.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env: Env = {
  git: (a) => { const r = spawnSync("git", a, { cwd: repo, encoding: "utf8" }); return { code: r.status ?? 128, out: r.stdout ?? "" }; },
  readText: (p) => (existsSync(join(repo, p)) ? readFileSync(join(repo, p), "utf8") : null),
  appendText: (p, t) => appendFileSync(join(repo, p), t),
  now: () => new Date().toISOString(),
};
const st = env.git(["status", "--porcelain", "--", ".", `:!${FREEZE_FILE}`, `:!${HELDOUT_LOG}`]);
if (st.code !== 0 || st.out.trim()) {
  console.error(`freeze refused: the working tree must be clean (the freeze records HEAD)\n${st.out}`);
  process.exit(1);
}
const f = makeFreeze(env, regionParamsCanonical(DEFAULT_REGION_PARAMS), {
  logicRev: REGION_LOGIC_REV, params: DEFAULT_REGION_PARAMS,
  calibration: "web/bench/regions-calibration.json",
  note: "held-out guard: HEAD must descend from `commit` and the sources + params must hash to `hash` (bench/regionHeldOut.ts)",
});
writeFileSync(join(repo, FREEZE_FILE), JSON.stringify(f, null, 1) + "\n");
console.log(`froze at ${f.commit} (${f.frozenAt}): hash ${f.hash}\nwrote ${FREEZE_FILE}; commit it`);
