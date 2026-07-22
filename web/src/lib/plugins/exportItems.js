// Build pre-bound ReportPanel export menu items from loaded plugin descriptors.
//
// Each item is `{ id, label, onSelect }` where `onSelect` is a NO-ARG closure
// (ReportPanel's ToolMenu fires `it.onSelect?.()` from an onClick — no ctx is
// passed there). We pre-bind the frozen void `descriptor.onSelect(ctx)` behind
// that closure, minting ctx via the shared façade so ReportPanel never builds
// its own.
//
// DISPATCH-TIME ISOLATION: ToolMenu's onClick is an event handler, so a React
// error boundary structurally cannot catch a throw from here. The try/catch in
// each closure IS the isolation — a throwing export is caught at dispatch time,
// the report flow survives, and `onError` surfaces a user-visible notice
// (console.error alongside is diagnostics, not a swallow).

import { mintPluginCtx } from "./host.js";

/**
 * @param {import("./descriptor.ts").PluginDescriptor[]} plugins loaded descriptors
 * @param {import("./context.ts").CanvasApi} api the LIVE canvas api bag (rebuilt each render)
 * @param {(pluginId: string, exportId: string, err: unknown) => void} onError
 *        called at dispatch time if a plugin export throws (surface a notice)
 * @returns {{ id: string, label: string, onSelect: () => void }[]}
 */
export function buildExportItems(plugins, api, onError) {
  const items = [];
  for (const plugin of plugins) {
    for (const slot of plugin.exports) {
      items.push({
        id: `${plugin.id}::${slot.id}`,
        label: slot.label,
        onSelect: () => {
          // Mint ctx against the CURRENT api (passed in this render) so reads
          // are live, then run the plugin's own ctx.download inside the guard.
          try {
            slot.onSelect(mintPluginCtx(api, plugin.id));
          } catch (err) {
            // Real dispatch-time isolation: contain the throw, keep the report
            // alive, and hand the failure up so the user sees a notice.
            console.error(`[plugins] export "${plugin.id}::${slot.id}" threw:`, err);
            onError(plugin.id, slot.id, err);
          }
        },
      });
    }
  }
  return items;
}
