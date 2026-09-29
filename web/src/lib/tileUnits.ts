// web/src/lib/tileUnits.ts
//
// The tile module straddles two unit systems: SKU/joint sizes are authored in
// INCHES (tileSetup.ts's `_in` fields) while the pattern generators, the room
// rings, and the classify pass all work in FEET (the plan's own coordinate
// space, matching `ring_ft`). Rotations are authored in DEGREES
// (tile_setup.rotation_deg) but every generator lays quads out in RADIANS.
//
// These are the ONE primitive for each conversion. Every `/12`, `*12`, and
// `deg → rad` in the tile modules routes through here, so a stray inline
// literal can never introduce a second, subtly-different conversion.
// tileSolve.ts remains the sole inch → foot bridge for the *solve* itself
// (feet → panel px lives there); this module is the shared arithmetic it and
// its siblings (optimize, classify, overlay, the takeoff band figure) call.
export const inToFt = (inches: number): number => inches / 12;
export const ftToIn = (feet: number): number => feet * 12;
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
