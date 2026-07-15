import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { labelSidecarPlugin } from "./labelSidecarPlugin.js";

// OpenTakeoff is a client-only static app: the takeoff canvas runs entirely in
// the browser (pdf.js + canvas + the geometry libs), persists to IndexedDB /
// localStorage, and builds to a static `dist/` you can host anywhere (GitHub
// Pages, Vercel, Netlify, an S3 bucket).
//
// The `/ai` proxy is OPTIONAL — it only matters if you run the bring-your-own-
// model AI sandbox in `../server` (see server/README.md). Without it, the app
// works fully; the AI hooks just stay dormant.
export default defineConfig({
  plugins: [react(), labelSidecarPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/ai": "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
