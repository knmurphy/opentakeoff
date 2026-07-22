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
import { mintPluginCtx } from "../lib/plugins/host.js";
import { useDisabledPluginIds } from "../lib/plugins/useDisabledPlugins.js";
import { setPluginDisabled } from "../lib/plugins/pluginPrefs.js";
import PluginErrorBoundary from "./PluginErrorBoundary.jsx";

const launcherStyle = {
  padding: "6px 10px", border: "1px solid var(--ink-faint)",
  background: "var(--paper-bright)", color: "var(--ink)", cursor: "pointer",
  fontSize: 12, fontWeight: 600, boxShadow: "var(--shadow-1)", textAlign: "left",
};

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

  return (
    <>
      {/* Launcher + manager column. Anchored at left:58 — clear of the native
          zoom/fit/dark-mode control column (TakeoffCanvas, left:14 bottom:14, 34px
          wide) so plugin UI never covers those. See the host safe-zone note. */}
      <div
        style={{
          position: "absolute", left: 58, bottom: 14, zIndex: 40,
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

        {/* Plugin manager — always present whenever any plugin is loaded, so
            re-enable is reachable even with every plugin disabled (no launchers
            above). Lists the FULL set with a per-plugin Enable/Disable toggle. */}
        <button
          type="button"
          title="Manage plugins"
          aria-pressed={showManager}
          style={launcherStyle}
          onClick={() => setShowManager((v) => !v)}
        >
          ⚙ Plugins
        </button>

        {showManager && (
          <div
            role="dialog"
            aria-label="Plugin manager"
            style={{
              padding: "8px 10px", background: "var(--paper-bright)",
              border: "1px solid var(--ink-faint)", boxShadow: "var(--shadow-2)",
              minWidth: 200, display: "flex", flexDirection: "column", gap: 6,
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
      </div>

      {/* At most ONE overlay is rendered — openSlot is a single slot or null, so
          one-overlay-at-a-time is enforced structurally, not just visually. Each
          render-time slot is wrapped in its own error boundary: a plugin that
          throws in RENDER degrades to a "feature unavailable" notice and the
          canvas survives. Action-time throws (a plugin's own onClick calling a
          ctx command) can't reach the boundary; `onActionError`, threaded into
          the minted ctx, contains + surfaces those instead. */}
      {openSlot && (
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
      )}
    </>
  );
}
