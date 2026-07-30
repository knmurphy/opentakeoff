import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The STT worker (stt.worker.ts, RFC #59) lazy-imports its engine adapter,
  // which needs code-splitting inside the worker bundle — only the ES format
  // supports that (Vite's default iife errors on split worker builds).
  worker: { format: "es" },
  server: {
    port: 5173,
    proxy: {
      "/ai": "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Second entry: the standalone component demo page (issue #194's readout
    // lab). A separate document, not an app route — it must not ride the SPA
    // bundle, and the SPA must not pull the demo harness in.
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        readoutDemo: new URL("./readout-demo.html", import.meta.url).pathname,
        puckDemo: new URL("./puck-demo.html", import.meta.url).pathname,
      },
    },
  },
});
