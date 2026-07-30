// RECEIPT COMPLETENESS ACROSS THE CANVAS'S OWN SURFACES — the same defect
// class engineParity.test.ts pins for the MCP side (F7(d): a hand-listed
// receipt set going stale under a new engine signal), one surface closer in.
//
// The flood emits a fixed receipt vocabulary (hatchFiltered, sealedPx,
// gapBridged, minPassPx/minPassDelta, wedges, ringWedges), and floodSignals →
// traceConfidence can NAME any of those rules in confidence_factors. So every
// place the canvas mints an origin from a flood must carry the same field set
// under the same gating: an origin whose factors say "min-passage-rule(…)" but
// which carries no min_pass_* fields is an asymmetric receipt — the score
// moved and nothing machine-readable says why.
//
// Found by the surface-parity review of the 0.9.7 merge: the Detect-rooms
// batch path (detectPass item → acceptDetected origin) omitted gap_bridged_px,
// min_pass_px/min_pass_delta and ring_interiors, and the agent one-click reply
// omitted gap_bridged_px (a bridged pinhole read as a clean fill to the model)
// and confidence_factors (score only). TakeoffCanvas.jsx is a React component
// this suite can't execute, so — like benchProductionRing's F7(b) guard and
// engineParity's F7(d) guard — this is a SOURCE-LEVEL pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const canvas = readFileSync(fileURLToPath(new URL("../src/pages/TakeoffCanvas.jsx", import.meta.url)), "utf8");

/** A component-level function body: from its declaration to the first close
 *  brace at the component's 2-space indent (the engineParity body idiom). */
function fnBody(decl: string): string {
  const m = canvas.match(new RegExp(`  (?:async )?function ${decl}\\([\\s\\S]*?\\n  \\}`));
  assert.ok(m, `function ${decl} not found in TakeoffCanvas.jsx — re-point this guard`);
  return m[0];
}

/** The keys of an `origin: {...}` literal, read the way engineParity reads
 *  receipts(): every `key:` that opens a property, including inside spreads.
 *  Handles both shapes the file uses — the commit gate's one-line literal and
 *  acceptDetected's multi-line one (closed by `},` on its own line). */
function originKeys(body: string, label: string): Set<string> {
  const m = body.match(/origin: \{ .*\},?$/m) || body.match(/origin: \{\n[\s\S]*?\n\s*\},/);
  assert.ok(m, `${label}: origin literal not found — re-point this guard`);
  const code = m[0].replace(/\/\/.*$/gm, "");   // comment lines would hide the key that follows them from [{,]\s*key:
  return new Set([...code.matchAll(/[{,]\s*([a-z][a-z0-9_]*):/g)].map((x) => x[1]));
}

// The engine-receipt vocabulary both origins must speak. fill_sensitivity is
// conditional-on-non-default on both paths but must be REFERENCED by both.
const RECEIPTS = [
  "confidence", "confidence_factors", "hatch_filtered", "gap_sealed_px",
  "gap_bridged_px", "min_pass_px", "min_pass_delta", "door_wedges",
  "ring_interiors", "fill_sensitivity",
];

test("detect-rooms origins carry the SAME receipt field set as the click path's commit gate", () => {
  const click = originKeys(fnBody("commitOneClickRegions"), "commitOneClickRegions");
  const detect = originKeys(fnBody("acceptDetected"), "acceptDetected");

  // each required receipt, by name, in both — so a failure names the field
  for (const k of RECEIPTS) {
    assert.ok(click.has(k), `commitOneClickRegions origin lost \`${k}\``);
    assert.ok(detect.has(k), `acceptDetected origin does not mint \`${k}\` — its confidence_factors can name the rule while the origin stays silent about it (the asymmetric-receipt defect)`);
  }

  // …and set equality up to the documented path-specific fields, so the NEXT
  // engine signal cannot land on one origin and not the other:
  //   click-only:  raster_traced (detect is vector-mask only),
  //                edited_before_create / proposed_verts_norm (handle edits
  //                exist only on the staged-proposal path)
  //   detect-only: detected (the batch-proposed marker itself)
  const clickOnly = new Set(["raster_traced", "edited_before_create", "proposed_verts_norm"]);
  const detectOnly = new Set(["detected"]);
  assert.deepEqual(
    [...click].filter((k) => !clickOnly.has(k)).sort(),
    [...detect].filter((k) => !detectOnly.has(k)).sort(),
    "the two origins' receipt sets diverged beyond the documented path-specific fields — thread the new signal through both, or document the exception here",
  );
});

test("the detect item records every flood signal its origin needs, gated exactly like buildOneClickRegion", () => {
  const body = fnBody("detectPass");
  // same record names, same expressions, same gating as buildOneClickRegion —
  // in particular the min-pass pair gated on minPassDelta (the engine's call)
  assert.match(body, /hf: !!f\.hatchFiltered/, "detect item lost hf");
  assert.match(body, /sl: f\.sealedPx \|\| 0/, "detect item lost sl");
  assert.match(body, /gap: f\.gapBridged \|\| 0/, "detect item does not record gapBridged — a bridged fill would commit as a clean one");
  assert.match(body, /mp: f\.minPassDelta \? \(f\.minPassPx \|\| 0\) : 0, mpd: f\.minPassDelta \|\| 0/,
    "detect item must carry the min-passage pair gated on minPassDelta, the click path's own condition");
  assert.match(body, /rw: f\.ringWedges \|\| 0/, "detect item does not record ringWedges — door_wedges would be the whole story again (F7(g))");
  // and acceptDetected commits them under the click path's conditions
  const accept = fnBody("acceptDetected");
  assert.match(accept, /\.\.\.\(r\.gap \? \{ gap_bridged_px: r\.gap \} : \{\}\)/);
  assert.match(accept, /\.\.\.\(r\.mp \? \{ min_pass_px: r\.mp, min_pass_delta: r\.mpd \} : \{\}\)/);
  assert.match(accept, /\.\.\.\(r\.rw \? \{ ring_interiors: r\.rw \} : \{\}\)/);
});

test("the agent one-click reply carries gap_bridged_px and confidence_factors, same conditions as the commit gate", () => {
  const body = fnBody("agentOneClickProbe");
  assert.match(body, /\.\.\.\(f\.gapBridged \? \{ gap_bridged_px: f\.gapBridged \} : \{\}\)/,
    "agent reply must surface a bridged pinhole — otherwise a rescued fill reads as a clean one to the model");
  assert.match(body, /\.\.\.\(conf\.factors\.length \? \{ confidence_factors: conf\.factors \} : \{\}\)/,
    "agent reply must carry the WHY beside the confidence score (the receipts() condition, factors non-empty)");
  // the engineParity pin's own line must also still be here (shared condition)
  assert.match(body, /f\.minPassDelta \? \{ min_pass_px: f\.minPassPx, min_pass_delta: f\.minPassDelta \}/);
});

test("the live preview carries gapBridged, so the hover badge can say what the commit will stamp", () => {
  const body = fnBody("ocLiveRun");
  assert.match(body, /gap: f\.gapBridged \|\| 0/, "st.last does not carry gapBridged — the hover badge cannot say 'bridged' while the commit stamps gap_bridged_px");
  const draw = fnBody("ocLiveDraw");
  assert.match(draw, /res\.gap \? " · bridged a hairline gap" : ""/, "the badge chain lost its gap-bridge readout");
});
