# Spike #166 — plugin/module feasibility (fork-only, throwaway)

**Question:** can opt-in features live *outside* the canvas monolith against a stable
façade, with a small enough core footprint to be upstreamable and to not corner us?

**Verdict: FEASIBLE.** A real reference feature (`features/spike-summary/`) runs entirely
through a `canvasContext` façade, imports nothing from the canvas, ships as its own lazy
chunk, and the canvas touch is 19 additive lines. Built, typechecked, and driven in a
browser end-to-end (screenshots in this folder).

## What was built (all throwaway)
- `web/src/lib/plugins/context.js` — the `canvasContext` façade (accessors + `commands.dispatchShape` routing through the real chokepoint + per-plugin `storage` + `download`). Versioned (`CANVAS_CONTEXT_VERSION = 1`).
- `web/src/lib/plugins/registry.js` — lazy `import.meta.glob('../../features/*/plugin.{js,jsx}')`.
- `web/src/components/PluginOverlayHost.jsx` — the single injection point; owns all plugin UI state, mints per-plugin ctx, gates on `minCtxVersion`.
- `web/src/components/PluginErrorBoundary.jsx` — per-slot isolation.
- `web/src/features/spike-summary/plugin.jsx` — reference plugin: reads conditions/shapes/units, persists a note, exports a summary. Zero core imports.
- `web/src/pages/TakeoffCanvas.jsx` — **+19 lines, additive only** (1 import, a ~9-line `pluginApi` capability bag, 1 `<PluginOverlayHost/>` render).

## Measurements
| Claim | Result |
|---|---|
| Core footprint minimal & additive | ✅ **19 insertions** in TakeoffCanvas.jsx, no existing code touched |
| Façade covers a real feature w/o leaking raw state | ✅ plugin read `units=imperial` + all **9 live conditions** + shapes via accessors only |
| Axis A — plugin out of the entry bundle | ✅ built to its **own chunk** `dist/assets/plugin-*.js (3.11 kB)`, not in `index-*.js` |
| Storage round-trip | ✅ note survived a full reload (device-local) |
| Error isolation | ✅ boundary wired per slot |
| typecheck / build | ✅ green |

## Gaps surfaced (feed the real design)
1. **Synced plugin storage is a real gap.** `metaGet/metaPut` are device-local IndexedDB and Drive-free BY DESIGN (`store.js`), so the note does NOT travel with the project in cloud mode. `ctx.storage.scope = "device-local"` is honest about this. Project-scoped *synced* plugin data needs a separate seam (ride the annotations payload, or add a plugin-data method to the store adapter interface + sync composite). **Decide before v1.**
2. **Command surface only lightly exercised.** `commands.dispatchShape` wires to the real `dispatchShape` chokepoint (applyShapeCommand + undo/redo + provenance) but the reference plugin only reads. A mutating reference plugin should be built through it before freezing the contract.
3. **Export-menu slot not wired.** The reference plugin self-serves `ctx.download`; slotting `...extraExports` into ReportPanel's menu is a trivial, low-risk add left out to keep the spike minimal.
4. **Per-render ctx vs injection** resolved in favor of **per-render prop** (host mints ctx each open) — accessors read live state, no staleness. Matches the additive-slot model.

## Not in scope (confirms the plan)
Drawing-**tool** plugins (85 `tool === "..."` pointer-loop conditionals) untouched — v2, as planned. v1 = panels/overlays/exports/agent-tools.
