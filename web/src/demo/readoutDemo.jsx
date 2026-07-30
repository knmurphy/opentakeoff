// Page entry for /readout-demo.html — mounts the readout lab. The lab itself
// lives in readoutLab.jsx so the artifact bundle can import it without this
// module-level mount firing.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./readoutLab.jsx";
import { initTheme } from "../lib/theme.js";

initTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
