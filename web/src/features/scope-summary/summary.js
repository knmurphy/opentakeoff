// Pure builder for the scope-summary export — separated from the descriptor so
// it is node-testable against a stub ctx without touching ctx.download.
//
// It reads ONLY the frozen v1 façade accessors (conditions, shapes, units,
// projectName) and produces a human-readable Markdown scope digest: one section
// per condition (its finish tag + color), the shapes assigned to it grouped by
// their label, and a tail of any orphan shapes. It deliberately computes NO
// quantities/costs — ctx exposes no totals and geometry is out of scope; this
// is a scope roll-up, not an estimate.

// Fields are the app's real condition/shape shape (opaque Record to the core):
//   condition: { id, finish_tag, color, ... }
//   shape:     { id, condition_id, label, ... }

function str(v, fallback = "") {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/** Group an array by a string key selector into a Map<key, count>, preserving
 *  first-seen order. */
function countBy(items, keyOf) {
  const counts = new Map();
  for (const it of items) {
    const k = keyOf(it);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Build the Markdown scope summary from a frozen ctx. Returns the file text. */
export function buildScopeSummary(ctx) {
  const projectName = str(ctx.getProjectName(), "Untitled project");
  const units = str(ctx.units, "unknown");
  const conditions = ctx.getConditions();
  const shapes = ctx.getShapes();

  const lines = [];
  lines.push(`# Takeoff scope — ${projectName}`);
  lines.push("");
  lines.push(`- Units: ${units}`);
  lines.push(`- Conditions: ${conditions.length}`);
  lines.push(`- Shapes: ${shapes.length}`);
  lines.push("");

  const claimed = new Set();
  for (const cond of conditions) {
    const condId = str(cond.id);
    const tag = str(cond.finish_tag, condId || "(unnamed condition)");
    const color = str(cond.color);
    const mine = shapes.filter((s) => str(s.condition_id) === condId && condId !== "");
    for (const s of mine) claimed.add(s);

    lines.push(`## ${tag}${color ? ` (${color})` : ""}`);
    lines.push("");
    lines.push(`- Shapes: ${mine.length}`);
    if (mine.length > 0) {
      const byLabel = countBy(mine, (s) => str(s.label, "(unlabeled)"));
      for (const [label, n] of byLabel) lines.push(`  - ${label}: ${n}`);
    }
    lines.push("");
  }

  const orphans = shapes.filter((s) => !claimed.has(s));
  if (orphans.length > 0) {
    lines.push(`## Unassigned shapes`);
    lines.push("");
    lines.push(`- Shapes: ${orphans.length}`);
    const byLabel = countBy(orphans, (s) => str(s.label, "(unlabeled)"));
    for (const [label, n] of byLabel) lines.push(`  - ${label}: ${n}`);
    lines.push("");
  }

  // Single trailing newline; no trailing blank-line pileup.
  return lines.join("\n").replace(/\n+$/, "\n");
}

/** A filesystem-safe filename derived from the project name. */
export function scopeSummaryFilename(projectName) {
  const base = str(projectName, "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "untitled"}-scope.md`;
}
