// CI Axis-A canary fixture. NOT a real feature — it exists only so the
// post-build guard (scripts/check-axis-a.mjs) can assert two things:
//   (a) `import.meta.glob("features/*/plugin.js")` still emits a per-feature
//       lazy chunk (this file shows up in dist/.vite/manifest.json), proving
//       the split-out is live and the canary hasn't rotted; and
//   (b) no src/features/* module leaks into the entry chunk's import graph.
//
// The registry FILTERS `__*__` dirs out before activation, so this descriptor
// is never handed to the host — see loadFeaturePlugins. Keep it minimal.
export default {
  id: "__ci_probe__",
  minCtxVersion: "1.0",
  overlays: [],
  exports: [],
};
