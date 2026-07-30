// Page entry for /puck-demo.html — mounts the puck lab. The lab itself lives
// in puckLab.jsx so the artifact bundle can import it without this
// module-level mount firing.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./puckLab.jsx";
import { initTheme } from "../lib/theme.js";

initTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  // NOTE: no StrictMode here — it double-invokes effects in dev, and the
  // velocity timer + act log are timing-observable in a lab meant for feel.
  <App />
);
