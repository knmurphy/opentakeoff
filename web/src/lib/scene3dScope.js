// v1 isolation (spec: honest scope): a selected shape's room = itself, shapes
// whose origin.derived.from_shape_id (or .between_shape_ids) reaches it, and
// label-equal siblings. Shapes with NO linkage to anything stay visible —
// they can't be attributed, so hiding them would silently shrink the scene.
// Everything linked to a different room drops.
export function isolate3D(selectedId, shapes) {
  if (!selectedId) return null;
  const sel = shapes.find((s) => s.id === selectedId);
  if (!sel) return null;
  const vis = new Set([selectedId]);
  for (const s of shapes) {
    const d = s.origin?.derived;
    const linked = d && (d.from_shape_id === selectedId || (Array.isArray(d.between_shape_ids) && d.between_shape_ids.includes(selectedId)));
    if (linked) vis.add(s.id);
    else if (s.label && sel.label && s.label === sel.label) vis.add(s.id);
    else if (!s.origin?.derived && !s.label) vis.add(s.id); // unlinked: stays
  }
  return vis;
}
