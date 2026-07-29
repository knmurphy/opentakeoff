// One-Click E2E orchestrator: build the fixture plan, start a dev server on a
// dedicated port, run the browser driver, tear down. `npm run e2e` from web/.
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = process.env.E2E_PORT || "5199";
const OUT = path.join(__dirname, "out");

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  let r = spawnSync("node", [path.join(__dirname, "make-fixture.cjs")], { stdio: "inherit" });
  if (r.status) process.exit(r.status);

  const vite = spawn("npx", ["vite", "--port", PORT, "--strictPort"], {
    cwd: path.join(__dirname, ".."),
    stdio: ["ignore", fs.openSync(path.join(OUT, "vite.log"), "w"), fs.openSync(path.join(OUT, "vite.log"), "a")],
    detached: true,
  });
  const killServer = () => { try { process.kill(-vite.pid); } catch { /* gone */ } };
  process.on("exit", killServer);

  const up = await new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => {
      fetch(`http://localhost:${PORT}/`).then(() => resolve(true)).catch(() => {
        if (Date.now() - t0 > 40000) resolve(false); else setTimeout(poll, 500);
      });
    };
    poll();
  });
  if (!up) { console.error("dev server never came up — see e2e/out/vite.log"); killServer(); process.exit(1); }

  r = spawnSync("node", [path.join(__dirname, "one-click.e2e.cjs")], {
    stdio: "inherit",
    env: { ...process.env, BASE_URL: `http://localhost:${PORT}/` },
  });
  killServer();
  process.exit(r.status || 0);
})();
