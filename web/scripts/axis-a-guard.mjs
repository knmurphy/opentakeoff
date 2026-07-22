// CI Axis-A guard — the build-time half. A Vite plugin whose `generateBundle`
// hook asserts that NO `src/features/*` module is bundled INTO an entry chunk.
//
// Why a plugin and not the post-build manifest script: the manifest only lists
// dynamically-imported and top-level chunks. A feature module that is
// *statically* imported into the entry gets INLINED into the entry chunk and
// appears in no manifest key — a manifest-only check passes vacuously while the
// Axis-A boundary is broken. `chunk.moduleIds` is the only place that inlined
// module shows up, so the entry-graph half of the guard has to run here, where
// the bundle's module ids are visible. The canary-liveness half (that the lazy
// __ci_probe__ chunk still exists) stays in scripts/check-axis-a.mjs, which runs
// against the emitted manifest after the build.
//
// A leak throws during `build` — the build fails, so CI fails.

const FEATURE_MARKER = "/src/features/";

export function axisAGuard() {
  return {
    name: "axis-a-guard",
    generateBundle(_options, bundle) {
      const leaks = [];
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        for (const moduleId of chunk.moduleIds) {
          if (moduleId.includes(FEATURE_MARKER)) {
            leaks.push(`${moduleId.slice(moduleId.indexOf("/src/") + 1)} inlined into entry chunk ${file}`);
          }
        }
      }
      if (leaks.length > 0) {
        throw new Error(
          "Axis-A violation: src/features/* must stay in its own lazy chunk, " +
            "never bundled into the entry. Leaks:\n  " +
            leaks.join("\n  "),
        );
      }
    },
  };
}
