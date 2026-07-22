// CI Axis-A guard — the build-time half. A Vite plugin whose `generateBundle`
// hook asserts that NO `src/features/*` module is EAGERLY REACHABLE from an
// entry chunk.
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
// "Eagerly reachable" is the whole static-import closure of the entry, not just
// its own module ids: a `manualChunks` rule (or ordinary code-splitting) can
// carve a feature into its OWN chunk that the entry then STATICALLY imports —
// the browser fetches+executes it whenever the entry loads, so it's just as much
// an Axis-A leak as an inlined module, yet it never appears in the entry chunk's
// `moduleIds`. We walk `chunk.imports` (static edges) transitively; we do NOT
// walk `dynamicImports`, because a feature living behind a lazy `import()` in its
// own chunk is exactly the CORRECT state (that's how __ci_probe__ bundles).
//
// A leak throws during `build` — the build fails, so CI fails.

const FEATURE_MARKER = "/src/features/";

const shortId = (moduleId) => moduleId.slice(moduleId.indexOf("/src/") + 1);

export function axisAGuard() {
  return {
    name: "axis-a-guard",
    generateBundle(_options, bundle) {
      const leaks = new Set();
      for (const [entryFile, entryChunk] of Object.entries(bundle)) {
        if (entryChunk.type !== "chunk" || !entryChunk.isEntry) continue;
        // BFS the static-import closure of this entry. dynamicImports are the
        // lazy boundary and are intentionally not followed.
        const seen = new Set();
        const queue = [entryFile];
        while (queue.length > 0) {
          const file = queue.shift();
          if (seen.has(file)) continue;
          seen.add(file);
          const chunk = bundle[file];
          if (!chunk || chunk.type !== "chunk") continue;
          for (const moduleId of chunk.moduleIds) {
            if (moduleId.includes(FEATURE_MARKER)) {
              const how = file === entryFile
                ? `inlined into entry chunk ${entryFile}`
                : `eagerly reachable from entry chunk ${entryFile} (static import ${file})`;
              leaks.add(`${shortId(moduleId)} ${how}`);
            }
          }
          for (const staticImport of chunk.imports) queue.push(staticImport);
        }
      }
      if (leaks.size > 0) {
        throw new Error(
          "Axis-A violation: src/features/* must stay in its own lazy chunk, " +
            "never eagerly bundled into or statically imported by the entry. Leaks:\n  " +
            [...leaks].join("\n  "),
        );
      }
    },
  };
}
