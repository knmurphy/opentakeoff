// Reference EXPORT-format plugin — the first real consumer of the frozen v1
// `exports` slot (#167). It lives entirely outside the canvas and the report:
// it imports nothing from core state, only reads the ctx façade and writes via
// ctx.download.
//
// Descriptor: exactly the four frozen keys { id, minCtxVersion, overlays,
// exports }, no overlays, one export slot using the FROZEN VOID `onSelect(ctx)`
// convention — it does its OWN ctx.download and returns nothing (NOT the spike's
// returning run(ctx)). It resolves to its own lazy chunk via the registry glob,
// never pulled into the entry bundle (Axis A).

import { buildScopeSummary, scopeSummaryFilename } from "./summary.js";

export default {
  id: "scope-summary",
  minCtxVersion: "1.0",
  overlays: [],
  exports: [
    {
      id: "markdown",
      label: "Scope summary (Markdown)",
      // Void onSelect — performs its own download; returns nothing.
      onSelect: (ctx) => {
        const text = buildScopeSummary(ctx);
        const filename = scopeSummaryFilename(ctx.getProjectName());
        ctx.download(filename, text, "text/markdown");
      },
    },
  ],
};
