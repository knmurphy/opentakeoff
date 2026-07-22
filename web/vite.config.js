import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { axisAGuard } from "./scripts/axis-a-guard.mjs";

// The one source of truth for the app version — package.json — inlined as
// __APP_VERSION__ so contributions can carry generator_version without a
// runtime fetch. Guarded with `typeof` at the use site so the Node test
// runner (no Vite, no define) sees plain undefined instead of a crash.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// OpenTakeoff is a client-only static app: the takeoff canvas runs entirely in
// the browser (pdf.js + canvas + the geometry libs), persists to IndexedDB /
// localStorage, and builds to a static `dist/` you can host anywhere (GitHub
// Pages, Vercel, Netlify, an S3 bucket).
//
// The `/ai` proxy is OPTIONAL — it only matters if you run the bring-your-own-
// model AI sandbox in `../server` (see server/README.md). Without it, the app
// works fully; the AI hooks just stay dormant.
export default defineConfig({
  // axisAGuard fails the build if any src/features/* module is inlined into an
  // entry chunk (the entry-graph half of the CI Axis-A guard — see the plugin
  // for why this can't be a manifest-only check).
  plugins: [react(), axisAGuard()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5173,
    proxy: {
      "/ai": "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Emit dist/.vite/manifest.json so the post-build Axis-A guard
    // (scripts/check-axis-a.mjs) can assert (a) the `__ci_probe__` feature chunk
    // is present (the split-out canary is live) and (b) no src/features/* module
    // leaked into the entry chunk's import graph.
    manifest: true,
  },
});
