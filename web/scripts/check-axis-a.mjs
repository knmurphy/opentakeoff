// CI Axis-A guard — the post-build half (canary liveness). Reads the emitted
// dist/.vite/manifest.json and asserts the __ci_probe__ feature still resolves
// to its OWN lazy chunk (a dynamic entry). This proves the `import.meta.glob`
// split-out is live: if someone drops the glob, switches it to `{ eager:true }`,
// deletes/renames the fixture, or otherwise pulls features into the entry, the
// probe's dynamic chunk disappears and this FAILS on a MISSING canary — it can
// never pass vacuously.
//
// The complementary entry-graph half (no feature module INLINED into the entry
// chunk) runs inside the build as the axisAGuard Vite plugin, because an inlined
// module shows up in chunk.moduleIds, not in the manifest. Run this after
// `vite build`.

import { readFile } from "node:fs/promises";

const MANIFEST = new URL("../dist/.vite/manifest.json", import.meta.url);
const PROBE_KEY = "src/features/__ci_probe__/plugin.js";

function fail(message) {
  console.error(`[axis-a] FAIL: ${message}`);
  process.exit(1);
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch (err) {
    fail(
      `could not read ${MANIFEST.pathname} — did \`vite build\` run with build.manifest:true? (${err.message})`,
    );
    return;
  }

  const entry = manifest[PROBE_KEY];
  if (!entry) {
    fail(
      `canary chunk missing: no manifest entry for "${PROBE_KEY}". The lazy ` +
        `import.meta.glob over features/* is no longer emitting per-feature ` +
        `chunks (glob removed, made eager, or the fixture renamed/deleted).`,
    );
    return;
  }
  if (entry.isDynamicEntry !== true) {
    fail(
      `canary chunk "${PROBE_KEY}" is no longer a dynamic (lazy) chunk ` +
        `(isDynamicEntry !== true) — features are being pulled in statically.`,
    );
    return;
  }
  if (typeof entry.file !== "string" || entry.file.length === 0) {
    fail(`canary manifest entry for "${PROBE_KEY}" has no emitted file.`);
    return;
  }

  console.log(`[axis-a] OK: __ci_probe__ canary is a live lazy chunk (${entry.file}).`);
}

main();
