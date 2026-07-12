// Dev-only ground-truth sidecar bridge — issue #127.
//
// OpenTakeoff is a client-only static app; there is no server to persist to. The
// batch-detection validation corpus needs ground-truth room seeds written to
// disk next to the (gitignored) real plans, at repo-root example-plans/.labels/
// <sheet>.json, so a scorer can read them. This plugin exposes that path to the
// dev browser ONLY:
//
//   GET  /_labels/:name  → the label JSON, or 404 when none exists yet
//   POST /_labels/:name  → write the posted JSON to .labels/<name>.json
//
// It is NOT part of the static build (configureServer only runs under `vite`),
// so production ships nothing. example-plans/ (and thus .labels/) is gitignored,
// so nothing written here can be committed.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// example-plans/ lives at REPO ROOT, one level up from web/.
const LABELS_DIR = path.resolve(HERE, "..", "example-plans", ".labels");

// keep the on-disk name filesystem-safe (sheet keys carry "#", spaces, "/").
function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 200) || "unnamed";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

export function labelSidecarPlugin() {
  return {
    name: "label-sidecar",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/_labels\/([^/?]+)/.exec(req.url || "");
        if (!m) return next();
        const file = path.join(LABELS_DIR, `${safeName(decodeURIComponent(m[1]))}.json`);
        try {
          if (req.method === "GET") {
            const text = await fs.readFile(file, "utf8").catch((e) => {
              if (e.code === "ENOENT") return null;
              throw e;
            });
            if (text === null) { res.statusCode = 404; res.end("{}"); return; }
            res.setHeader("Content-Type", "application/json");
            res.end(text);
            return;
          }
          if (req.method === "POST") {
            const body = await readBody(req);
            JSON.parse(body); // reject non-JSON before touching disk
            await fs.mkdir(LABELS_DIR, { recursive: true });
            await fs.writeFile(file, body, "utf8");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, path: file }));
            return;
          }
          res.statusCode = 405; res.end("method not allowed");
        } catch (e) {
          res.statusCode = 500; res.end(String((e && e.message) || e));
        }
      });
    },
  };
}
