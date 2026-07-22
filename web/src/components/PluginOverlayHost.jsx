// The single injection point the canvas renders. It owns ALL plugin overlay UI
// state (which overlay is open, if any) so the canvas monolith stays additive:
// the canvas hands it one `api` capability bag (#167's CanvasApi) and this host
// does the rest — launcher buttons, per-plugin context minting, error
// isolation, one-overlay-at-a-time enforcement.
//
// The version gate + its plugin-naming console.warn live in loadFeaturePlugins
// (registry.ts, via the pure selectRenderablePlugins) — this host consumes that
// composed loader and does NOT re-run the gate, so there is exactly one gate and
// one warning per skipped plugin.

import React, { useEffect, useState } from "react";
import { loadFeaturePlugins } from "../lib/plugins/registry.js";
import { buildCanvasContext } from "../lib/plugins/context.js";
import { metaGet, metaPut, metaDelete } from "../lib/store.js";
import PluginErrorBoundary from "./PluginErrorBoundary.jsx";

// Adapt the app's flat meta helpers to the MetaStore handle buildCanvasContext
// injects into per-plugin storage. Device-scoped; the storage layer owns the
// namespacing so a plugin can't climb into another's keys.
const META_STORE = {
  get: (key) => metaGet(key),
  put: (key, value) => metaPut(key, value),
  delete: (key) => metaDelete(key),
};

const launcherStyle = {
  padding: "6px 10px", border: "1px solid var(--ink-faint)",
  background: "var(--paper-bright)", color: "var(--ink)", cursor: "pointer",
  fontSize: 12, fontWeight: 600, boxShadow: "var(--shadow-1)", textAlign: "left",
};

export default function PluginOverlayHost({ api }) {
  const [plugins, setPlugins] = useState([]);
  // Single open slot — one overlay at a time in v1 (concurrent overlays are
  // explicitly deferred). Value is the "pluginId::overlayId" key, or null.
  const [openKey, setOpenKey] = useState(null);

  // Load the in-tree feature descriptors once. `live` guards a resolve that
  // lands after unmount (and makes StrictMode's double-mount harmless: the first
  // mount's cleanup flips live=false, so its late resolve is a no-op; the second
  // mount owns the state).
  useEffect(() => {
    let live = true;
    loadFeaturePlugins()
      .then((loaded) => { if (live) setPlugins(loaded); })
      .catch((err) => { console.error("[plugins] failed to load feature plugins:", err); });
    return () => { live = false; };
  }, []);

  const slots = plugins.flatMap((plugin) =>
    plugin.overlays.map((overlay) => ({
      plugin,
      overlay,
      key: `${plugin.id}::${overlay.id}`,
    })),
  );
  if (slots.length === 0) return null;

  const close = () => setOpenKey(null);
  const openSlot = slots.find((s) => s.key === openKey) ?? null;

  return (
    <>
      <div
        style={{
          position: "absolute", left: 14, bottom: 14, zIndex: 40,
          display: "flex", flexDirection: "column", gap: 6,
        }}
      >
        {slots.map(({ overlay, key }) => (
          <button
            key={key}
            type="button"
            title={overlay.label}
            aria-pressed={openKey === key}
            style={launcherStyle}
            onClick={() => setOpenKey((v) => (v === key ? null : key))}
          >
            {overlay.icon ? `${overlay.icon} ` : ""}{overlay.label}
          </button>
        ))}
      </div>

      {/* At most ONE overlay is rendered — openSlot is a single slot or null, so
          one-overlay-at-a-time is enforced structurally, not just visually. Each
          render-time slot is wrapped in its own error boundary: a plugin that
          throws in render degrades to a "feature unavailable" notice and the
          canvas survives. */}
      {openSlot && (
        <PluginErrorBoundary key={openSlot.key} label={openSlot.plugin.id} onClose={close}>
          {openSlot.overlay.render({
            ctx: buildCanvasContext(api, openSlot.plugin.id, META_STORE),
            onClose: close,
          })}
        </PluginErrorBoundary>
      )}
    </>
  );
}
