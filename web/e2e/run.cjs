// One-Click E2E orchestrator: build the fixture plan, start a dev server on a
// dedicated port, run the browser driver, tear down. `npm run e2e` from web/.
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = process.env.E2E_PORT || "5199";
// bind and poll the loopback LITERAL, not the name: on a CI runner "localhost"
// can resolve to ::1 first while vite listens on 127.0.0.1, and the poll then
// burns its whole budget on ECONNREFUSED against an address nothing serves.
const HOST = process.env.E2E_HOST || "127.0.0.1";
const BOOT_MS = Number(process.env.E2E_BOOT_MS || 90000);   // cold CI runners pay dep-optimize on first boot
const OUT = path.join(__dirname, "out");

// Every exit path must tear the server down AND carry a truthful status. A
// child killed by a signal reports status===null; `r.status || 0` used to turn
// that (and a spawn error) into a green run — a crashed driver looked like a
// pass. fail() is the single funnel.
let vite = null;
const killServer = () => { if (vite) { try { process.kill(-vite.pid); } catch { /* already gone */ } vite = null; } };
process.on("exit", killServer);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { killServer(); process.exit(1); });

function finish(r, what) {
  if (r.error) { console.error(`${what} failed to start:`, r.error.message); return 1; }
  if (r.signal) { console.error(`${what} was killed by ${r.signal}`); return 1; }
  return r.status == null ? 1 : r.status;                   // null status is a failure, never a pass
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  let code = finish(spawnSync("node", [path.join(__dirname, "make-fixture.cjs")], { stdio: "inherit" }), "fixture builder");
  if (code) process.exit(code);

  vite = spawn("npx", ["vite", "--host", HOST, "--port", PORT, "--strictPort"], {
    cwd: path.join(__dirname, ".."),
    stdio: ["ignore", fs.openSync(path.join(OUT, "vite.log"), "w"), fs.openSync(path.join(OUT, "vite.log"), "a")],
    detached: true,
  });
  let viteDied = false;
  vite.on("exit", (c, s) => { viteDied = true; console.error(`vite exited early (code=${c} signal=${s})`); });

  const up = await new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => {
      if (viteDied) return resolve(false);                  // don't sit out the full budget on a dead server
      fetch(`http://${HOST}:${PORT}/`).then(() => resolve(true)).catch(() => {
        if (Date.now() - t0 > BOOT_MS) resolve(false); else setTimeout(poll, 500);
      });
    };
    poll();
  });
  if (!up) {
    console.error("dev server never came up — see e2e/out/vite.log");
    try { console.error(fs.readFileSync(path.join(OUT, "vite.log"), "utf8").slice(-4000)); } catch { /* no log */ }
    killServer();
    process.exit(1);
  }

  code = finish(spawnSync("node", [path.join(__dirname, "one-click.e2e.cjs")], {
    stdio: "inherit",
    env: { ...process.env, BASE_URL: `http://${HOST}:${PORT}/` },
  }), "e2e driver");
  killServer();
  process.exit(code);
})().catch((e) => { console.error("E2E ORCHESTRATOR FAILED:", e); killServer(); process.exit(1); });
