// SPIKE (throwaway) — issue #166 feasibility probe. NOT the real contract.
//
// The single injection point the canvas renders. It owns all plugin UI state
// (which overlay is open) so the canvas monolith stays untouched: the canvas
// hands it one `api` capability bag and this host does the rest — launcher
// buttons, per-plugin context minting, error isolation. This is the whole
// "core diff stays tiny" bet, measured.

import React, { useEffect, useState } from "react";
import { loadFeaturePlugins } from "../lib/plugins/registry.js";
import { buildCanvasContext } from "../lib/plugins/context.js";
import PluginErrorBoundary from "./PluginErrorBoundary.jsx";

const launcher = {
  padding: "6px 10px", border: "1px solid var(--ink-faint)",
  background: "var(--paper-bright)", color: "var(--ink)", cursor: "pointer",
  fontSize: 12, fontWeight: 600, boxShadow: "var(--shadow-1)", textAlign: "left",
};

export default function PluginOverlayHost({ api }) {
  const [plugins, setPlugins] = useState([]);
  const [openKey, setOpenKey] = useState(null);   // "pluginId::overlayId"

  useEffect(() => {
    let live = true;
    loadFeaturePlugins().then((p) => { if (live) setPlugins(p); });
    return () => { live = false; };
  }, []);

  const overlays = plugins.flatMap((p) =>
    (p.overlays || []).map((o) => ({ plugin: p, overlay: o, key: `${p.id}::${o.id}` })),
  );
  if (!overlays.length) return null;

  return (
    <>
      <div style={{ position: "absolute", left: 14, bottom: 14, zIndex: 40, display: "flex", flexDirection: "column", gap: 6 }}>
        {overlays.map(({ overlay, key }) => (
          <button key={key} type="button" title={overlay.label} style={launcher}
            onClick={() => setOpenKey((v) => (v === key ? null : key))}>
            {overlay.icon ? `${overlay.icon} ` : ""}{overlay.label}
          </button>
        ))}
      </div>

      {overlays.map(({ plugin, overlay, key }) => {
        if (openKey !== key) return null;
        // Version gate: skip a plugin the current context can't satisfy.
        if ((plugin.minCtxVersion || 1) > buildCanvasContext(api, plugin.id).version) {
          return <PluginErrorBoundary key={key} label={plugin.id} onClose={() => setOpenKey(null)} />;
        }
        const ctx = buildCanvasContext(api, plugin.id);
        return (
          <PluginErrorBoundary key={key} label={plugin.id} onClose={() => setOpenKey(null)}>
            {overlay.render({ ctx, onClose: () => setOpenKey(null) })}
          </PluginErrorBoundary>
        );
      })}
    </>
  );
}
