// The single injection point the canvas renders. It owns ALL plugin overlay UI
// state (which overlay is open, if any) so the canvas monolith stays additive:
// the canvas hands it one `api` capability bag (#167's CanvasApi) and this host
// does the rest — launcher buttons, per-plugin context minting, error
// isolation, one-overlay-at-a-time enforcement, and PLACEMENT: overlays render
// as relative content into a host-positioned safe zone (Option A), so a plugin
// can't position its UI over the canvas's own controls or collide with the
// manager.
//
// The version gate + its plugin-naming console.warn live in loadFeaturePlugins
// (registry.ts, via the pure selectRenderablePlugins) — this host consumes that
// composed loader and does NOT re-run the gate, so there is exactly one gate and
// one warning per skipped plugin.

import React, { useEffect, useState } from "react";
import { loadFeaturePlugins } from "../lib/plugins/registry.js";
import { mintPluginCtx } from "../lib/plugins/host.js";
import { useDisabledPluginIds } from "../lib/plugins/useDisabledPlugins.js";
import { setPluginDisabled } from "../lib/plugins/pluginPrefs.js";
import PluginErrorBoundary from "./PluginErrorBoundary.jsx";

const launcherStyle = {
  padding: "6px 10px", border: "1px solid var(--ink-faint)",
  background: "var(--paper-bright)", color: "var(--ink)", cursor: "pointer",
  fontSize: 12, fontWeight: 600, boxShadow: "var(--shadow-1)", textAlign: "left",
};

// The host-owned width of the panel slot (overlay + manager). Plugins render
// RELATIVE content that fills this — they don't pick their own size or position.
const PANEL_WIDTH = 300;

export default function PluginOverlayHost({ api, onActionError }) {
  const [plugins, setPlugins] = useState([]);
  // Single open slot — one overlay at a time in v1 (concurrent overlays are
  // explicitly deferred). Value is the "pluginId::overlayId" key, or null.
  const [openKey, setOpenKey] = useState(null);
  // Manager popover open/closed. Independent of an overlay being open — the
  // manager is the ONLY re-enable path, so it must be reachable even when every
  // plugin is disabled (no launchers, no open overlay).
  const [showManager, setShowManager] = useState(false);
  // Per-user disabled set (reactive: re-renders when toggled here or elsewhere).
  const disabled = useDisabledPluginIds();

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

  // If the currently-open overlay's plugin gets disabled (here or in another
  // tab), close it — otherwise re-enabling later would silently reopen the old
  // overlay. `openSlot.find` already renders nothing once filtered, but the key
  // must be cleared too.
  useEffect(() => {
    if (openKey && disabled.has(openKey.split("::")[0])) setOpenKey(null);
  }, [disabled, openKey]);

  // Launcher/overlay slots come ONLY from ENABLED plugins — a disabled plugin
  // contributes no launcher and no overlay. The manager below still iterates the
  // FULL `plugins` set so a disabled plugin can be re-enabled.
  const slots = plugins
    .filter((p) => !disabled.has(p.id))
    .flatMap((plugin) =>
      plugin.overlays.map((overlay) => ({
        plugin,
        overlay,
        key: `${plugin.id}::${overlay.id}`,
      })),
    );

  // Gate on the FULL loaded set, not the (filtered) slots: the manager must
  // render whenever ANY plugin is loaded — including export-only plugins with no
  // overlay, and the all-disabled case where there are zero slots but the user
  // still needs a way back in.
  if (plugins.length === 0) return null;

  const close = () => setOpenKey(null);
  const openSlot = slots.find((s) => s.key === openKey) ?? null;

  // Option A — the HOST owns placement. All plugin UI lives in ONE bottom-anchored
  // column at left:58 (clear of the canvas's native zoom/dark-mode column at
  // left:14). The panel slot (overlay OR manager) sits ABOVE the launchers and
  // expands upward; manager and overlay are MUTUALLY EXCLUSIVE, so they can't
  // cover each other, and a plugin's overlay renders as RELATIVE content into a
  // host-sized box — it can't self-position over the canvas.
  const openOverlay = (key) => { setShowManager(false); setOpenKey((v) => (v === key ? null : key)); };
  const toggleManager = () => { setOpenKey(null); setShowManager((v) => !v); };

  return (
    <div
      style={{
        position: "absolute", left: 58, bottom: 14, zIndex: 40,
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
      }}
    >
      {/* PANEL SLOT — top of the column, expands upward. The plugin's overlay is
          plain RELATIVE content dropped into this host-positioned, width-bounded,
          scroll-capped box, so it can never land over the canvas controls. The
          per-slot error boundary contains a render throw (degrades to a notice);
          action-time throws surface via `onActionError`. */}
      {openSlot && (
        <div style={{ width: PANEL_WIDTH, maxHeight: "60vh", overflowY: "auto" }}>
          <PluginErrorBoundary
            key={openSlot.key}
            label={openSlot.plugin.id}
            onClose={close}
            onDisable={() => setPluginDisabled(openSlot.plugin.id, true)}
          >
            {openSlot.overlay.render({
              ctx: mintPluginCtx(api, openSlot.plugin.id, onActionError),
              onClose: close,
            })}
          </PluginErrorBoundary>
        </div>
      )}

      {/* Manager — shares the panel slot with the overlay (mutually exclusive).
          Always reachable whenever any plugin is loaded, so re-enable works even
          with every plugin disabled. Lists the FULL set with an Enable/Disable
          toggle each. */}
      {showManager && (
        <div
          role="dialog"
          aria-label="Plugin manager"
          style={{
            width: PANEL_WIDTH, boxSizing: "border-box",
            padding: "8px 10px", background: "var(--paper-bright)",
            border: "1px solid var(--ink-faint)", boxShadow: "var(--shadow-2)",
            display: "flex", flexDirection: "column", gap: 6,
          }}
        >
          {plugins.map((plugin) => {
            const off = disabled.has(plugin.id);
            return (
              <div
                key={plugin.id}
                style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}
              >
                <span
                  style={{ fontSize: 12, color: off ? "var(--ink-muted)" : "var(--ink)" }}
                  title={plugin.id}
                >
                  {plugin.id}
                </span>
                <button
                  type="button"
                  onClick={() => setPluginDisabled(plugin.id, !off)}
                  style={{
                    padding: "3px 8px", fontSize: 11, cursor: "pointer",
                    border: `1px solid ${off ? "var(--ink-faint)" : "var(--c-danger)"}`,
                    background: "var(--paper-bright)",
                    color: off ? "var(--ink)" : "var(--c-danger)",
                  }}
                >
                  {off ? "Enable" : "Disable"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Launchers + the manager toggle — the stable button group at the bottom
          (nearest the corner); the panel above expands upward. */}
      {slots.map(({ overlay, key }) => (
        <button
          key={key}
          type="button"
          title={overlay.label}
          aria-pressed={openKey === key}
          style={launcherStyle}
          onClick={() => openOverlay(key)}
        >
          {overlay.icon ? `${overlay.icon} ` : ""}{overlay.label}
        </button>
      ))}
      <button
        type="button"
        title="Manage plugins"
        aria-pressed={showManager}
        style={launcherStyle}
        onClick={toggleManager}
      >
        ⚙ Plugins
      </button>
    </div>
  );
}
