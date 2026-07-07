// Leaf numeric helpers — import nothing, so anything may import from here
// without creating a cycle (reportColumns.js and totals.js both do).

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
