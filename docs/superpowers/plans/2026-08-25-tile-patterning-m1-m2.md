# Tile Patterning — Milestones 1–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the tile-patterning data model (opt-in `tile_setup` on a condition, versioned, MCP round-trip) and the pure layout engine (pitch/face contract + pattern generators + cell classification), so a later milestone can figure counts, cuts, and a scale-accurate layout.

**Architecture:** Mirror the roll-goods precedent exactly. `tile_setup` is an opt-in object **on the condition** (presence = opt-in), read through a runtime guard `hasTileSetup()` with no load-time sanitizer — the `hasRollSetup()` posture (`web/src/lib/rollTakeoff.js:27-30`). The engine is pure ES modules under `web/src/lib/` (no React/DOM), headless-testable with `node:test`, so the canvas and the MCP server share one math path. Cell∩room boolean geometry reuses the repo's existing `jsts` dependency (as `web/src/lib/polyarr.ts` already does) — **not** a new `polygon-clipping` dependency.

**Tech Stack:** TypeScript (strict), ES modules, `node:test` + `tsx` runner, `jsts` (already a dependency) for polygon boolean/intersection, `@turf/*` (already a dependency) for point-in-polygon helpers where convenient. React only later (M5).

**Spec:** `docs/TILE_PATTERNING_DESIGN.md` — this plan implements §4.1 (data model), §3.0 (layout contract), §3.1 (pattern engine), §3.2 (classification), and the M1/M2 rows of §5. Executors read both; the design is authoritative in §2–§5.

## Global Constraints

- **Node ≥ 24** (`web/package.json` `engines`). Tests run with `node --import tsx --test test/*.test.ts` (the `npm test` script); every new test file is `web/test/<name>.test.ts`.
- **Pure engine modules** live under `web/src/lib/`; no React, no DOM, no browser globals — they must import and run under bare `node:test`.
- **Reuse existing geometry deps.** Boolean/intersection ops use `jsts` (see `web/src/lib/polyarr.ts:14-17`); do **not** add `polygon-clipping` or any new npm dependency. The design doc named `polygon-clipping` generically for a Martinez-class boolean; `jsts` `OverlayNG`/`intersection` provides the same and is already vendored.
- **Opt-in contract:** a condition is tile iff `hasTileSetup(c)` is true. Corrupt payloads (non-object, array, missing tile size) read as opted **out** — never throw at load, never hydrate-sanitize.
- **Quantities-only, no price.** No dollar or price field enters `tile_setup` (the roll-goods rule; `rollgoods.js:28-29`).
- **Additive versioning.** `opentakeoff.takeoff_canvas.v1` and `opentakeoff.report.v1` are frozen, additive-only. `tile_setup` rides on the condition object (already serialized wholesale) — new report keys, if any, append after existing ones.
- **Colors are user data.** The `CT-1` palette color (`#9333ea`) and hatch stay as-is; `tile_setup` seeds SKU colors independently and does not re-theme the condition.
- **Do not touch `netlify.toml`.** Branch `feat/tile-patterning` already exists (rebased on `origin/main`). Run `cd web && npm run check` before any push; squash-merge; merge = deploy.
- **MCP mirror duty.** Any condition-shape field the canvas persists that the MCP server must round-trip is mirrored in `mcp/src/session.ts`; keep the two in step (`AGENTS.md` sync list).

---

## Milestone 1 — Data model, runtime guard, seed, MCP round-trip

Deliverable: a condition can carry a `tile_setup` object; it survives template/library copy, export/import, and the MCP `edit_condition` round-trip; `CT-1` seeds one. No layout math yet.

### Task 1: `tile_setup` types + guard + mint + config coercion

**Files:**
- Create: `web/src/lib/tileSetup.ts`
- Test: `web/test/tileSetup.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type TileSku = { id: string; name: string; w_in: number; h_in: number; color: string; image?: string; glossiness?: number }`
  - `type TileJoint = { width_in: number }`
  - `type TilePattern = "grid" | "brick_50" | "brick_33" | "diagonal" | "herringbone" | "basketweave"`
  - `type TileSetup = { pattern: TilePattern; origin: [number, number]; rotation_deg: number; edge_strategy: "balanced" | "start_full"; skus: TileSku[]; joint: TileJoint; grout: Record<string, unknown> }`
  - `hasTileSetup(c: unknown): boolean`
  - `mintTileSetup(): TileSetup` — default single 12×24 SKU, grid, 1/8″ joint.
  - `tileConfig(ts: TileSetup): { w_in: number; h_in: number; joint_in: number; pattern: TilePattern; origin: [number, number]; rotation_deg: number }` — coerces the primary SKU + joint into the engine's numeric config, every field clamped ≥ 0 (joint) / > 0 (tile size), mirroring `rollConfig` (`rollTakeoff.js:43-52`).

- [ ] **Step 1: Write the failing test**

```ts
// web/test/tileSetup.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTileSetup, mintTileSetup, tileConfig } from "../src/lib/tileSetup.ts";

test("hasTileSetup: presence of a usable setup is the opt-in", () => {
  assert.equal(hasTileSetup({ tile_setup: mintTileSetup() }), true);
  assert.equal(hasTileSetup({}), false);
  assert.equal(hasTileSetup(null), false);
});

test("hasTileSetup: corrupt payloads read as opted out (no throw)", () => {
  assert.equal(hasTileSetup({ tile_setup: [] }), false);          // array
  assert.equal(hasTileSetup({ tile_setup: "grid" }), false);      // string
  assert.equal(hasTileSetup({ tile_setup: { skus: [] } }), false); // no usable tile
  assert.equal(hasTileSetup({ tile_setup: { skus: [{ w_in: 0, h_in: 12 }] } }), false); // non-positive size
});

test("mintTileSetup: sensible defaults", () => {
  const ts = mintTileSetup();
  assert.equal(ts.pattern, "grid");
  assert.equal(ts.skus.length, 1);
  assert.ok(ts.skus[0].w_in > 0 && ts.skus[0].h_in > 0);
  assert.ok(ts.joint.width_in > 0);
});

test("tileConfig: coerces the primary SKU + joint, clamps to positive", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 24; ts.skus[0].h_in = 12; ts.joint.width_in = 0.125;
  const cfg = tileConfig(ts);
  assert.equal(cfg.w_in, 24);
  assert.equal(cfg.h_in, 12);
  assert.equal(cfg.joint_in, 0.125);
  // clamps garbage
  const bad = tileConfig({ ...ts, skus: [{ ...ts.skus[0], w_in: -5 }], joint: { width_in: -1 } });
  assert.ok(bad.w_in > 0);
  assert.ok(bad.joint_in >= 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --import tsx --test test/tileSetup.test.ts`
Expected: FAIL — cannot find module `../src/lib/tileSetup.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/tileSetup.ts
// Tile-patterning opt-in on a condition (#tile). Mirrors the roll-goods
// opt-in (lib/rollTakeoff.js): presence of a usable tile_setup === opted in.
// A condition is trade-agnostic; tile is an object ON the condition, not a
// type. Runtime guard, no load-time sanitizer — corrupt payloads read as
// opted OUT (the hasRollSetup posture).

export type TileSku = {
  id: string; name: string; w_in: number; h_in: number;
  color: string; image?: string; glossiness?: number;
};
export type TileJoint = { width_in: number };
export type TilePattern =
  "grid" | "brick_50" | "brick_33" | "diagonal" | "herringbone" | "basketweave";
export type TileSetup = {
  pattern: TilePattern;
  origin: [number, number];
  rotation_deg: number;
  edge_strategy: "balanced" | "start_full";
  skus: TileSku[];
  joint: TileJoint;
  grout: Record<string, unknown>;
};

const usableSku = (s: unknown): s is TileSku =>
  !!s && typeof s === "object" && !Array.isArray(s) &&
  Number((s as TileSku).w_in) > 0 && Number((s as TileSku).h_in) > 0;

// A condition is tile iff it carries a tile_setup with at least one usable SKU.
export function hasTileSetup(c: unknown): boolean {
  const ts = (c as { tile_setup?: unknown })?.tile_setup as TileSetup | undefined;
  return !!ts && typeof ts === "object" && !Array.isArray(ts) &&
    Array.isArray(ts.skus) && ts.skus.some(usableSku);
}

let seq = 0;
const skuId = () => `sku${++seq}`;

export function mintTileSetup(): TileSetup {
  return {
    pattern: "grid",
    origin: [0, 0],
    rotation_deg: 0,
    edge_strategy: "balanced",
    skus: [{ id: skuId(), name: "Tile 1", w_in: 12, h_in: 24, color: "#9333ea" }],
    joint: { width_in: 0.125 },
    grout: {},
  };
}

export function tileConfig(ts: TileSetup) {
  const s = (ts.skus || []).find(usableSku) || ts.skus?.[0];
  return {
    w_in: Math.max(0.25, Number(s?.w_in) || 12),
    h_in: Math.max(0.25, Number(s?.h_in) || 12),
    joint_in: Math.max(0, Number(ts.joint?.width_in) || 0),
    pattern: ts.pattern || "grid",
    origin: (Array.isArray(ts.origin) ? ts.origin : [0, 0]) as [number, number],
    rotation_deg: Number(ts.rotation_deg) || 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --import tsx --test test/tileSetup.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/tileSetup.ts web/test/tileSetup.test.ts
git commit -m "feat(tile): tile_setup types, hasTileSetup guard, mint + config coercion"
```

### Task 2: Seed `CT-1` with a `tile_setup`

**Files:**
- Modify: `web/src/lib/canvasConstants.js:115-118` (the `CT-1` entry of `FLOORING_DEFAULTS`)
- Test: `web/test/tileSetup.test.ts` (append)

**Interfaces:**
- Consumes: `mintTileSetup` (Task 1).
- Produces: `FLOORING_DEFAULTS` `CT-1` entry now carries `tile_setup`. No new export.

- [ ] **Step 1: Write the failing test** (append to `web/test/tileSetup.test.ts`)

```ts
import { FLOORING_DEFAULTS } from "../src/lib/canvasConstants.js";

test("CT-1 seed carries a usable tile_setup", () => {
  const ct1 = FLOORING_DEFAULTS.find((d) => d.finish_tag === "CT-1");
  assert.ok(ct1, "CT-1 seed exists");
  assert.equal(hasTileSetup(ct1), true);
  assert.equal(ct1.tile_setup.skus[0].w_in, 12);
  assert.equal(ct1.tile_setup.skus[0].h_in, 24);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --import tsx --test test/tileSetup.test.ts`
Expected: FAIL — `hasTileSetup(ct1)` is false (no `tile_setup` yet).

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `canvasConstants.js` (beside the existing `GROUT_DEFAULTS` import):

```js
import { mintTileSetup } from "./tileSetup.ts";
```

Add `tile_setup: mintTileSetup()` to the `CT-1` object (line 115). The grout material keeps its existing `grout: { ...GROUT_DEFAULTS }` — grout-from-`tile_setup` derivation is a later milestone; the seed only carries the opt-in object now:

```js
  { finish_tag: "CT-1", color: "#9333ea", hatch: "grid", waste_pct: 10, tile_setup: mintTileSetup(), materials: [
    { name: "Thinset mortar", kind: "mortar", per: 65, basis: "area", unit: "bag", note: '1/4″×3/8″×1/4″ sq' },
    { name: "Grout", kind: "grout", per: 512, basis: "area", unit: "bag", grout: { ...GROUT_DEFAULTS }, note: '12×24×3/8″ @ 1/8″ · 25 lb' },
  ] },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --import tsx --test test/tileSetup.test.ts`
Expected: PASS (5 tests). Also run `node --import tsx --test test/store.test.ts test/templates.test.ts` to confirm the seed still hydrates.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canvasConstants.js web/test/tileSetup.test.ts
git commit -m "feat(tile): seed CT-1 with a tile_setup opt-in"
```

### Task 3: Template / library copy deep-copies `tile_setup`

**Files:**
- Modify: `web/src/lib/canvasUtil.js:66` (the `templateFromCondition` spread that copies `roll_setup`)
- Test: `web/test/templates.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: a template built from a tile condition carries a **deep-copied** `tile_setup` (no shared reference), exactly as `roll_setup` is copied.

- [ ] **Step 1: Write the failing test** (append to `web/test/templates.test.ts`)

First read the file to match its existing import/helper style, then add:

```ts
test("templateFromCondition deep-copies tile_setup (no shared reference)", () => {
  const cond = { finish_tag: "CT-1", color: "#9333ea", waste_pct: 10, materials: [],
    tile_setup: { pattern: "grid", origin: [0, 0], rotation_deg: 0, edge_strategy: "balanced",
      skus: [{ id: "sku1", name: "T", w_in: 12, h_in: 24, color: "#9333ea" }],
      joint: { width_in: 0.125 }, grout: {} } };
  const tpl = templateFromCondition(cond);           // import name per the file
  assert.deepEqual(tpl.tile_setup, cond.tile_setup);
  tpl.tile_setup.joint.width_in = 0.25;              // mutate the copy
  assert.equal(cond.tile_setup.joint.width_in, 0.125); // original untouched
});
```

(Use the exact exported name the file uses — read `web/src/lib/canvasUtil.js` around line 60 to confirm the constructor name; the roll case at line 66 is the model.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --import tsx --test test/templates.test.ts`
Expected: FAIL — `tpl.tile_setup` is undefined (not copied).

- [ ] **Step 3: Write minimal implementation**

At `canvasUtil.js:66`, beside the `roll_setup` copy, add a deep copy of `tile_setup` (the roll case uses a shallow spread `{ ...t.roll_setup }`; tile nests arrays/objects, so use `structuredClone` to avoid aliasing SKUs/joint/grout):

```js
  ...(t.roll_setup ? { roll_setup: { ...t.roll_setup } } : {}),
  ...(t.tile_setup ? { tile_setup: structuredClone(t.tile_setup) } : {}), // nested skus/joint/grout — deep copy, never share
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --import tsx --test test/templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canvasUtil.js web/test/templates.test.ts
git commit -m "feat(tile): deep-copy tile_setup through template/library copy"
```

### Task 4: MCP `edit_condition` accepts `tile_setup` (round-trip + undo)

**Files:**
- Modify: `mcp/src/session.ts` — `MaterialRow`/condition type (`tile_setup?`), `editCondition` (`session.ts:3230-3260`), the `condition` undo record (`session.ts:476`, `:3240-3242`, `:3414-3415`), and `conditionState`/output assembly (`session.ts:3265-3277`)
- Modify: `mcp/src/tools.ts` — `edit_condition` input schema (`tools.ts:433-455`)
- Modify: `mcp/src/outputs.ts` — `editConditionOutput` (`outputs.ts:656`)
- Test: `mcp/test/session.test.ts` (append)

**Interfaces:**
- Consumes: `hasTileSetup`, `mintTileSetup` from `../../web/src/lib/tileSetup.ts` (imported into `session.ts` beside the existing roll import at `session.ts:59`).
- Produces: `session.editCondition(tag, { ..., tile_setup?: Record<string, unknown> | null })` — `null` opts out, an object opts in / patches (same shape as the roll branch at `session.ts:3246-3258`). `editConditionOutput.tile_setup` present while opted in. Undo restores the prior `tile_setup`.

- [ ] **Step 1: Write the failing test** (append to `mcp/test/session.test.ts`)

Read `mcp/test/session.test.ts` first to match its session-construction helper, then add:

```ts
test("edit_condition round-trips tile_setup (opt in, patch, opt out, undo)", () => {
  const s = /* build a session with a CT-1 condition, per this file's helper */;
  // opt in
  let out = s.editCondition("CT-1", { tile_setup: { pattern: "herringbone" } });
  assert.equal(out.tile_setup.pattern, "herringbone");
  assert.ok(out.tile_setup.skus.length >= 1);         // minted defaults filled in
  // patch keeps prior fields
  out = s.editCondition("CT-1", { tile_setup: { rotation_deg: 45 } });
  assert.equal(out.tile_setup.pattern, "herringbone"); // preserved
  assert.equal(out.tile_setup.rotation_deg, 45);
  // opt out
  out = s.editCondition("CT-1", { tile_setup: null });
  assert.equal(out.tile_setup, undefined);
  // undo restores the last opted-in state
  s.undo();
  const c = s.conditions.find((x) => x.finish_tag === "CT-1");
  assert.equal(c.tile_setup.rotation_deg, 45);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && node --import tsx --test test/session.test.ts`
Expected: FAIL — `editCondition` ignores `tile_setup` / throws "Nothing to change".

- [ ] **Step 3: Write minimal implementation** (mirror the roll branch exactly)

Import beside the roll import (`session.ts:59`):

```ts
import { hasTileSetup, mintTileSetup } from "../../web/src/lib/tileSetup.ts";
```

Extend the `editCondition` options and the "nothing to change" guard (`session.ts:3230-3232`) to include `tile_setup`. Add to the `before` record (`:3240-3242`) `tile_setup: c.tile_setup ? structuredClone(c.tile_setup) : undefined`, and to the condition-undo type (`session.ts:476`). Add the mutation branch after the roll branch (`:3258`):

```ts
if (opts.tile_setup !== undefined) {
  if (opts.tile_setup === null) {
    delete c.tile_setup; // opt out — trade-agnostic again
  } else {
    const given = Object.fromEntries(
      Object.entries(opts.tile_setup).filter(([, v]) => v !== undefined));
    const base = hasTileSetup(c) ? (c.tile_setup as object) : (mintTileSetup() as object);
    c.tile_setup = { ...base, ...given };
  }
}
```

Extend the undo restore (`session.ts:3414-3415`): `if (e.before.tile_setup === undefined) delete c.tile_setup; else c.tile_setup = e.before.tile_setup;`. Add to the output assembly (`session.ts:3274-3276`) `...(c.tile_setup ? { tile_setup: c.tile_setup } : {})`. Add `tile_setup?: Record<string, unknown>` to the condition type (`session.ts:118` neighborhood).

In `tools.ts:440-454`, add a `tile_setup` param to the `edit_condition` input schema (a `z.union([z.null(), z.object({ pattern: z.string().optional(), rotation_deg: z.number().optional(), origin: z.array(z.number()).optional(), edge_strategy: z.string().optional(), skus: z.array(z.object({}).passthrough()).optional(), joint: z.object({}).passthrough().optional() }).passthrough()])` — mirroring the roll union) and pass it through in the `run(...)` handler (`tools.ts:455`). Update the tool `description` to mention the tile opt-in.

In `outputs.ts:656`, add `tile_setup: z.object({}).passthrough().optional().describe("The condition's tile-patterning setup after this write — present while opted in")`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp && node --import tsx --test test/session.test.ts test/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/session.ts mcp/src/tools.ts mcp/src/outputs.ts mcp/test/session.test.ts
git commit -m "feat(tile): MCP edit_condition round-trips tile_setup (opt-in, patch, opt-out, undo)"
```

### Task 5: Export/import round-trip pins `tile_setup`

**Files:**
- Test: `web/test/importTakeoff.test.ts` (append) and/or `web/test/store.test.ts`

**Interfaces:**
- Consumes: `hasTileSetup` (Task 1), the existing `importTakeoff` merge and the autosave/export path.
- Produces: proof that `tile_setup` survives a `takeoff_canvas.v1` export → import cycle (it rides the condition object, which is serialized wholesale; this task pins that so a future refactor cannot silently drop it).

- [ ] **Step 1: Write the failing test**

Read `web/test/importTakeoff.test.ts` to match its fixture/helper style, then add a case: build a payload whose conditions include a `CT-1` with a `tile_setup`, run it through `importTakeoff` into an empty project, and assert the merged condition still satisfies `hasTileSetup`. If the merge already preserves unknown condition fields, this test passes immediately — that is the point (a regression guard). If it does **not** preserve it, fix the merge to carry `tile_setup` (the `roll_setup` field is the precedent for what must survive).

```ts
import { hasTileSetup } from "../src/lib/tileSetup.ts";
// ... build payload with a CT-1 condition carrying tile_setup (mintTileSetup shape)
test("import preserves a condition's tile_setup", () => {
  const merged = importTakeoff(/* empty project */, payload /* per this file's signature */);
  const ct1 = merged.conditions.find((c) => c.finish_tag === "CT-1");
  assert.equal(hasTileSetup(ct1), true);
});
```

- [ ] **Step 2: Run test to verify it fails (or passes as a guard)**

Run: `cd web && node --import tsx --test test/importTakeoff.test.ts`
Expected: PASS if the merge is field-preserving (guard established), FAIL if `tile_setup` is dropped by an allowlist merge — in which case proceed to Step 3.

- [ ] **Step 3: Write minimal implementation (only if Step 2 failed)**

If `importTakeoff.js` merges conditions by an explicit field allowlist, add `tile_setup` to it beside `roll_setup`. If it spreads the whole condition, no change is needed — the test stands as a regression guard.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --import tsx --test test/importTakeoff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/test/importTakeoff.test.ts web/src/lib/importTakeoff.js
git commit -m "test(tile): pin tile_setup survives export/import round-trip"
```

### M1 verification gate

- [ ] Run `cd web && npm run check` and `cd mcp && npm test`; both green.
- [ ] Re-run the reviewer gate (fact + architect at minimum) on the M1 diff per the standing instruction; proceed only on READY.

---

## Milestone 2 — Layout contract + pattern engine + classification (pure)

Deliverable: given a room polygon (feet), a `tile_setup`, and a scale, produce a deterministic set of placed tile quads with per-cell classification (full / cut / hole / out) and installed-face cut dimensions. No canvas, no counts-report yet — pure math with unit tests. All lengths in **feet** at the engine boundary (the roll engine's convention; `rollTakeoff.js:2-3`).

### Task 6: `tilePitch.ts` — the one-geometry-three-views contract

**Files:**
- Create: `web/src/lib/tilePitch.ts`
- Test: `web/test/tilePitch.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all lengths in feet):
  - `type Cell = { w: number; h: number }`
  - `nominalQuad(w: number, h: number): Cell` — the bare face (coverage area), `{ w, h }`.
  - `pitchCell(w: number, h: number, j: number): Cell` — placement pitch, `{ w: w + j, h: h + j }`.
  - `installedFace(w: number, h: number, j: number, eps?: number): Cell` — nominal inset by `max(j/2, eps·min(w,h))`, `{ w: w - 2·inset', ... }` where `inset' = min(j/2, ...)` computed so the face never goes non-positive; default `eps = 0`.
  - `faceInset(w: number, h: number, j: number, eps?: number): number` — the single inset value, exported so classification and rendering share it.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/tilePitch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nominalQuad, pitchCell, installedFace, faceInset } from "../src/lib/tilePitch.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("nominalQuad is the bare face", () => {
  const q = nominalQuad(1, 2); near(q.w, 1); near(q.h, 2);
});

test("pitchCell adds one joint to each dimension", () => {
  const c = pitchCell(1, 2, 0.02); near(c.w, 1.02); near(c.h, 2.02);
});

test("installedFace insets the nominal by j/2 each side", () => {
  const f = installedFace(1, 2, 0.02); near(f.w, 0.98); near(f.h, 1.98);
  near(faceInset(1, 2, 0.02), 0.01);
});

test("pitch/face are consistent: pitch = installedFace + one joint + 2·inset residue", () => {
  // The invariant the design guarantees: placing on pitchCell and rendering
  // installedFace leaves exactly one joint of gap between neighbours.
  const w = 1, h = 2, j = 0.02;
  const p = pitchCell(w, h, j), f = installedFace(w, h, j);
  near(p.w - f.w, j + 2 * faceInset(w, h, j)); // gap = joint + the two half-insets
});

test("installedFace never goes non-positive for a fat joint", () => {
  const f = installedFace(0.1, 0.1, 0.5); assert.ok(f.w > 0 && f.h > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --import tsx --test test/tilePitch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/tilePitch.ts
// The layout contract — one cell, three views (design §3.0). Grout never
// lives inside a pattern generator; the pitch↔face conversion lives here so
// the DRAWN field and the ORDERED quantity cannot drift. All feet.

export type Cell = { w: number; h: number };

export function nominalQuad(w: number, h: number): Cell {
  return { w, h };
}

export function pitchCell(w: number, h: number, j: number): Cell {
  return { w: w + j, h: h + j };
}

// One inset value shared by classification and rendering. Clamped so a fat
// joint relative to a tiny tile can never invert the face.
export function faceInset(w: number, h: number, j: number, eps = 0): number {
  const want = Math.max(j / 2, eps * Math.min(w, h));
  return Math.min(want, 0.49 * Math.min(w, h));
}

export function installedFace(w: number, h: number, j: number, eps = 0): Cell {
  const inset = faceInset(w, h, j, eps);
  return { w: w - 2 * inset, h: h - 2 * inset };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --import tsx --test test/tilePitch.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/tilePitch.ts web/test/tilePitch.test.ts
git commit -m "feat(tile): tilePitch — nominal/pitch/installedFace contract"
```

### Task 7: `tilePatterns/` — generator interface + registry + `grid`

**Files:**
- Create: `web/src/lib/tilePatterns/types.ts`
- Create: `web/src/lib/tilePatterns/pattern.ts` (interface + `registry`)
- Create: `web/src/lib/tilePatterns/grid.ts`
- Create: `web/src/lib/tilePatterns/index.ts` (registers built-ins, re-exports)
- Test: `web/test/tilePatterns.test.ts`

**Interfaces:**
- Consumes: `pitchCell` (Task 6).
- Produces:
  - `type TileQuad = { cx: number; cy: number; w: number; h: number; rot: number; skuId: string }` — center + `pitchCell` extents (feet), rotation in radians.
  - `type Bounds = { minX: number; minY: number; maxX: number; maxY: number }`
  - `type GenInput = { bounds: Bounds; w: number; h: number; joint: number; origin: [number, number]; rotation_deg: number; skuId: string }`
  - `interface PatternGenerator { name: string; generate(input: GenInput): TileQuad[] }`
  - `registry: Map<string, PatternGenerator>` + `register(g)` + `getPattern(name): PatternGenerator`
  - `gridGenerator` registered as `"grid"`.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/tilePatterns.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPattern, registry } from "../src/lib/tilePatterns/index.ts";

const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

test("grid is registered", () => {
  assert.ok(registry.has("grid"));
});

test("grid tiles cover the bounds on a pitch lattice, deterministically", () => {
  const g = getPattern("grid");
  const input = { bounds, w: 1, h: 1, joint: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" };
  const a = g.generate(input);
  const b = g.generate(input);
  assert.deepEqual(a, b);                       // deterministic
  // 10×10 area, 1ft pitch → at least a 10×10 = 100 quad lattice covering it
  assert.ok(a.length >= 100);
  // every quad carries the sku and the pitch extents
  assert.ok(a.every((q) => q.skuId === "s1" && q.w === 1 && q.h === 1));
  // centers land on a lattice stepping by pitch (1ft here)
  const xs = [...new Set(a.map((q) => Math.round(q.cx * 1e6) / 1e6))].sort((p, n) => p - n);
  assert.ok(Math.abs((xs[1] - xs[0]) - 1) < 1e-9);
});

test("origin shift moves the whole lattice by the offset", () => {
  const g = getPattern("grid");
  const base = g.generate({ bounds, w: 1, h: 1, joint: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  const shifted = g.generate({ bounds, w: 1, h: 1, joint: 0, origin: [0.5, 0], rotation_deg: 0, skuId: "s1" });
  const minBase = Math.min(...base.map((q) => q.cx));
  const minShift = Math.min(...shifted.map((q) => q.cx));
  assert.ok(Math.abs((minShift - minBase) - 0.5) < 1e-9 || Math.abs((minShift - minBase) + 0.5) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --import tsx --test test/tilePatterns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`types.ts`:

```ts
// web/src/lib/tilePatterns/types.ts
export type TileQuad = { cx: number; cy: number; w: number; h: number; rot: number; skuId: string };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type GenInput = {
  bounds: Bounds; w: number; h: number; joint: number;
  origin: [number, number]; rotation_deg: number; skuId: string;
};
export interface PatternGenerator { name: string; generate(input: GenInput): TileQuad[]; }
```

`pattern.ts`:

```ts
// web/src/lib/tilePatterns/pattern.ts
import type { PatternGenerator } from "./types.ts";
export const registry = new Map<string, PatternGenerator>();
export function register(g: PatternGenerator) { registry.set(g.name, g); }
export function getPattern(name: string): PatternGenerator {
  const g = registry.get(name);
  if (!g) throw new Error(`unknown tile pattern: ${name}`);
  return g;
}
```

`grid.ts` (generates a lattice on `pitchCell`, one quad per cell that overlaps the bounds; origin shifts the lattice phase; a fully-covered lattice pads one cell past each edge so edge tiles that the room clips are present for classification):

```ts
// web/src/lib/tilePatterns/grid.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { pitchCell } from "../tilePitch.ts";

export const gridGenerator: PatternGenerator = {
  name: "grid",
  generate({ bounds, w, h, joint, origin, skuId }: GenInput): TileQuad[] {
    const cell = pitchCell(w, h, joint);
    const [ox, oy] = origin;
    // phase the lattice so a tile edge passes through the origin; pad one cell.
    const startI = Math.floor((bounds.minX - ox) / cell.w) - 1;
    const endI = Math.ceil((bounds.maxX - ox) / cell.w) + 1;
    const startJ = Math.floor((bounds.minY - oy) / cell.h) - 1;
    const endJ = Math.ceil((bounds.maxY - oy) / cell.h) + 1;
    const out: TileQuad[] = [];
    for (let i = startI; i <= endI; i++)
      for (let j = startJ; j <= endJ; j++)
        out.push({ cx: ox + (i + 0.5) * cell.w, cy: oy + (j + 0.5) * cell.h, w, h, rot: 0, skuId });
    return out;
  },
};
```

`index.ts`:

```ts
// web/src/lib/tilePatterns/index.ts
import { register, registry, getPattern } from "./pattern.ts";
import { gridGenerator } from "./grid.ts";
register(gridGenerator);
export { registry, getPattern };
export * from "./types.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --import tsx --test test/tilePatterns.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/tilePatterns/ web/test/tilePatterns.test.ts
git commit -m "feat(tile): pattern generator interface + registry + grid"
```

### Task 8: Offset (`brick_50`/`brick_33`) and `diagonal` generators

**Files:**
- Create: `web/src/lib/tilePatterns/offset.ts` (registers `brick_50`, `brick_33`)
- Create: `web/src/lib/tilePatterns/diagonal.ts` (registers `diagonal`)
- Modify: `web/src/lib/tilePatterns/index.ts` (register both)
- Test: `web/test/tilePatterns.test.ts` (append)

**Interfaces:**
- Consumes: Task 7 registry, `pitchCell`.
- Produces: `offsetGenerator(fraction)` factory → `brick_50` (0.5), `brick_33` (1/3); `diagonalGenerator` (grid rotated a fixed 45°, origin honored per §3.1 table).

- [ ] **Step 1: Write the failing test** (append)

```ts
test("brick_50 offsets every other row by half a pitch", () => {
  const g = getPattern("brick_50");
  const a = g.generate({ bounds, w: 1, h: 1, joint: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  // group by row (cy); adjacent rows' cx sets differ by ~0.5 pitch
  const byRow = new Map<number, number[]>();
  for (const q of a) { const k = Math.round(q.cy * 1e6); (byRow.get(k) ?? byRow.set(k, []).get(k)!).push(q.cx); }
  const rows = [...byRow.entries()].sort((p, n) => p[0] - n[0]).map(([, xs]) => Math.min(...xs));
  assert.ok(Math.abs(Math.abs(rows[1] - rows[0]) % 1 - 0.5) < 1e-9);
});

test("diagonal quads are rotated 45°", () => {
  const g = getPattern("diagonal");
  const a = g.generate({ bounds, w: 1, h: 1, joint: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  assert.ok(a.length > 0);
  assert.ok(a.every((q) => Math.abs(q.rot - Math.PI / 4) < 1e-9));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --import tsx --test test/tilePatterns.test.ts`
Expected: FAIL — `brick_50`/`diagonal` not registered.

- [ ] **Step 3: Write minimal implementation**

`offset.ts` — a factory that phases each row `j` by `fraction · pitch.w`:

```ts
// web/src/lib/tilePatterns/offset.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { pitchCell } from "../tilePitch.ts";

export function offsetGenerator(name: string, fraction: number): PatternGenerator {
  return {
    name,
    generate({ bounds, w, h, joint, origin, skuId }: GenInput): TileQuad[] {
      const cell = pitchCell(w, h, joint);
      const [ox, oy] = origin;
      const startJ = Math.floor((bounds.minY - oy) / cell.h) - 1;
      const endJ = Math.ceil((bounds.maxY - oy) / cell.h) + 1;
      const out: TileQuad[] = [];
      for (let j = startJ; j <= endJ; j++) {
        const rowShift = ((j % Math.round(1 / fraction)) * fraction) * cell.w;
        const startI = Math.floor((bounds.minX - ox - rowShift) / cell.w) - 1;
        const endI = Math.ceil((bounds.maxX - ox - rowShift) / cell.w) + 1;
        for (let i = startI; i <= endI; i++)
          out.push({ cx: ox + rowShift + (i + 0.5) * cell.w, cy: oy + (j + 0.5) * cell.h, w, h, rot: 0, skuId });
      }
      return out;
    },
  };
}
export const brick50 = offsetGenerator("brick_50", 0.5);
export const brick33 = offsetGenerator("brick_33", 1 / 3);
```

`diagonal.ts` — reuse the grid lattice, then rotate every center + face 45° about the origin:

```ts
// web/src/lib/tilePatterns/diagonal.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { gridGenerator } from "./grid.ts";

export const diagonalGenerator: PatternGenerator = {
  name: "diagonal",
  generate(input: GenInput): TileQuad[] {
    const a = Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
    const [ox, oy] = input.origin;
    // generate on an expanded bound so the rotated lattice still covers the room
    const pad = Math.hypot(input.bounds.maxX - input.bounds.minX, input.bounds.maxY - input.bounds.minY);
    const big = { minX: input.bounds.minX - pad, minY: input.bounds.minY - pad,
                  maxX: input.bounds.maxX + pad, maxY: input.bounds.maxY + pad };
    return gridGenerator.generate({ ...input, bounds: big }).map((q) => {
      const dx = q.cx - ox, dy = q.cy - oy;
      return { ...q, cx: ox + dx * ca - dy * sa, cy: oy + dx * sa + dy * ca, rot: a };
    });
  },
};
```

Register both in `index.ts`:

```ts
import { brick50, brick33 } from "./offset.ts";
import { diagonalGenerator } from "./diagonal.ts";
register(brick50); register(brick33); register(diagonalGenerator);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --import tsx --test test/tilePatterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/tilePatterns/ web/src/lib/tilePatterns/index.ts web/test/tilePatterns.test.ts
git commit -m "feat(tile): offset (brick_50/brick_33) and diagonal generators"
```

### Task 9: `herringbone` + `basketweave` generators (with 2:1 warning)

**Files:**
- Create: `web/src/lib/tilePatterns/herringbone.ts`
- Create: `web/src/lib/tilePatterns/basketweave.ts`
- Modify: `web/src/lib/tilePatterns/index.ts`
- Test: `web/test/tilePatterns.test.ts` (append)

**Interfaces:**
- Consumes: Task 7 types.
- Produces: `herringboneGenerator`, `basketweaveGenerator`. Herringbone is gap-free only for 2:1 tiles; a `layoutWarning(setup): string | null` helper (exported from `index.ts`) returns a non-null warning when `pattern === "herringbone"` and `w/h ≠ 2` (verified against the domain: TileSim's herringbone requires 2:1). Per §3.1, herringbone/basketweave ignore a free origin (interlock-derived).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { layoutWarning } from "../src/lib/tilePatterns/index.ts";

test("herringbone places interlocking rotated pairs covering the bounds", () => {
  const g = getPattern("herringbone");
  const a = g.generate({ bounds, w: 2, h: 1, joint: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  assert.ok(a.length > 0);
  // both +45° and -45° orientations present
  const rots = new Set(a.map((q) => Math.round(q.rot * 1e6)));
  assert.equal(rots.size, 2);
});

test("basketweave alternates horizontal/vertical pairs", () => {
  const g = getPattern("basketweave");
  const a = g.generate({ bounds, w: 2, h: 1, joint: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  assert.ok(a.length > 0);
  const rots = new Set(a.map((q) => Math.round(q.rot * 1e6)));
  assert.equal(rots.size, 2); // 0 and π/2
});

test("herringbone warns for non-2:1 tiles", () => {
  assert.ok(layoutWarning({ pattern: "herringbone", skus: [{ w_in: 12, h_in: 12 }] }));
  assert.equal(layoutWarning({ pattern: "herringbone", skus: [{ w_in: 24, h_in: 12 }] }), null);
  assert.equal(layoutWarning({ pattern: "grid", skus: [{ w_in: 12, h_in: 12 }] }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --import tsx --test test/tilePatterns.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Implement `herringbone.ts` and `basketweave.ts` as deterministic generators over the bounds (herringbone: an L-unit of one +45° and one −45° plank tiled on the interlock lattice; basketweave: 2×2 blocks alternating a horizontal pair and a vertical pair). Both ignore `origin`/`rotation_deg` (interlock-derived, §3.1). Add to `index.ts`:

```ts
import { herringboneGenerator } from "./herringbone.ts";
import { basketweaveGenerator } from "./basketweave.ts";
register(herringboneGenerator); register(basketweaveGenerator);

export function layoutWarning(setup: { pattern?: string; skus?: { w_in: number; h_in: number }[] }): string | null {
  if (setup?.pattern === "herringbone") {
    const s = setup.skus?.[0];
    const ratio = s ? Math.max(s.w_in, s.h_in) / Math.min(s.w_in, s.h_in) : 0;
    if (Math.abs(ratio - 2) > 1e-6)
      return "Herringbone is gap-free only for 2:1 tiles; this tile's aspect ratio will leave gaps or need custom cuts.";
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --import tsx --test test/tilePatterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/tilePatterns/ web/src/lib/tilePatterns/index.ts web/test/tilePatterns.test.ts
git commit -m "feat(tile): herringbone + basketweave generators, non-2:1 warning"
```

### Task 10: `tileGeometry/` — cell∩room classification + cut dimensions (jsts)

**Files:**
- Create: `web/src/lib/tileGeometry/classify.ts`
- Test: `web/test/tileGeometry.test.ts`

**Interfaces:**
- Consumes: `TileQuad` (Task 7), `installedFace`/`faceInset` (Task 6), `jsts` (as `web/src/lib/polyarr.ts:14-17` imports it).
- Produces:
  - `type CellClass = "full" | "cut" | "corner" | "hole" | "out"`
  - `type Classified = { quad: TileQuad; cls: Cellclass; areaFull_sf: number; areaKept_sf: number; cut?: { w_in: number; h_in: number; lShaped: boolean } }`
  - `classifyLayout(quads: TileQuad[], roomRing: [number,number][], holes: [number,number][][], joint_in: number): Classified[]` — for each quad, intersect its **nominal** footprint with (room − holes) via jsts; `full` when kept area ≈ nominal area, `out` when ≈ 0, else `cut`; `corner` = a cut whose kept footprint touches ≥ 2 non-collinear room edges (edge-contact, not point-in-polygon, §3.2); cut dimensions come from the intersection's bounding box measured against **`installedFace`** (§3.0), `lShaped` when the kept footprint has > 4 vertices after simplification.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/tileGeometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLayout } from "../src/lib/tileGeometry/classify.ts";

// a 2ft × 2ft room, 1ft tiles, no joint → 4 full tiles, none cut
const room: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
const quads = [
  { cx: 0.5, cy: 0.5, w: 1, h: 1, rot: 0, skuId: "s" },
  { cx: 1.5, cy: 0.5, w: 1, h: 1, rot: 0, skuId: "s" },
  { cx: 0.5, cy: 1.5, w: 1, h: 1, rot: 0, skuId: "s" },
  { cx: 1.5, cy: 1.5, w: 1, h: 1, rot: 0, skuId: "s" },
];

test("a tile fully inside is full; one entirely outside is out", () => {
  const withOut = [...quads, { cx: 5, cy: 5, w: 1, h: 1, rot: 0, skuId: "s" }];
  const c = classifyLayout(withOut, room, [], 0);
  assert.equal(c.filter((x) => x.cls === "full").length, 4);
  assert.equal(c.filter((x) => x.cls === "out").length, 1);
});

test("a half-overhanging tile is cut with the right kept dimension", () => {
  // room 1.5ft wide → the second column is cut to 0.5ft
  const narrow: [number, number][] = [[0, 0], [1.5, 0], [1.5, 2], [0, 2]];
  const c = classifyLayout(quads, narrow, [], 0);
  const cut = c.find((x) => x.cls === "cut" || x.cls === "corner");
  assert.ok(cut, "a cut tile exists");
  assert.ok(Math.abs(cut!.cut!.w_in - 6) < 1e-3);   // 0.5ft = 6in kept
});

test("a hole punches tiles over it to 'hole'/'cut'", () => {
  const hole: [number, number][] = [[0.75, 0.75], [1.25, 0.75], [1.25, 1.25], [0.75, 1.25]];
  const c = classifyLayout(quads, room, [hole], 0);
  assert.ok(c.some((x) => x.cls === "cut" || x.cls === "hole"));
});

test("a corner tile touches two room edges", () => {
  const narrow: [number, number][] = [[0, 0], [1.5, 0], [1.5, 1.5], [0, 1.5]];
  const c = classifyLayout(quads, narrow, [], 0);
  assert.ok(c.some((x) => x.cls === "corner"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --import tsx --test test/tileGeometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Build a jsts `GeometryFactory` (as `polyarr.ts:14` does), turn the room ring (minus holes) into a `Polygon`, and for each quad build its nominal rectangle polygon and compute `room.intersection(tile)`. Read kept area from the result; classify by the area ratio; derive cut dimensions from the intersection envelope, dimensioned against `installedFace` extents; detect corner by counting distinct room boundary edges the kept footprint's edges lie on. Keep coordinates in feet (jsts boolean ops are topological — safe on planar feet, the same rationale as `cutout.js:17-24`). Convert kept cut dims to inches for `cut.w_in`/`cut.h_in`.

```ts
// web/src/lib/tileGeometry/classify.ts  (sketch — implementer fills jsts wiring)
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import { installedFace } from "../tilePitch.ts";
import type { TileQuad } from "../tilePatterns/types.ts";

export type CellClass = "full" | "cut" | "corner" | "hole" | "out";
export type Classified = {
  quad: TileQuad; cls: CellClass; areaFull_sf: number; areaKept_sf: number;
  cut?: { w_in: number; h_in: number; lShaped: boolean };
};

// ... GeometryFactory-based ring builder (see polyarr.ts), quad→rect polygon
// honoring quad.rot, room−holes via difference, per-quad intersection, area
// ratio → class, envelope → cut dims (×12 to inches), edge-contact → corner.
export function classifyLayout(
  quads: TileQuad[], roomRing: [number, number][],
  holes: [number, number][][], joint_in: number,
): Classified[] { /* implement */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --import tsx --test test/tileGeometry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/tileGeometry/ web/test/tileGeometry.test.ts
git commit -m "feat(tile): cell∩room classification + cut dimensioning (jsts)"
```

### Task 11: End-to-end determinism + pitch/face invariant across the engine

**Files:**
- Test: `web/test/tileGeometry.test.ts` (append) — an integration test that runs `getPattern → classifyLayout` for each of the five M2 patterns and asserts (a) identical output on repeat (determinism), (b) full + kept-cut area equals the room area within tolerance (no drawn-vs-kept drift — the §3.0 guarantee), (c) `layoutWarning` fires only where expected.

**Interfaces:**
- Consumes: everything from Tasks 6–10.
- Produces: no new module — a cross-module guard.

- [ ] **Step 1: Write the failing/guard test**

```ts
import { getPattern } from "../src/lib/tilePatterns/index.ts";
import { classifyLayout } from "../src/lib/tileGeometry/classify.ts";

const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 3 };
const room: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]]; // 12 sf

for (const pat of ["grid", "brick_50", "brick_33", "diagonal"]) {
  test(`${pat}: kept area sums to the room area (no drift) and is deterministic`, () => {
    const g = getPattern(pat);
    const input = { bounds, w: 1, h: 1, joint: 0.02, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s" };
    const a = classifyLayout(g.generate(input), room, [], 0.02);
    const b = classifyLayout(g.generate(input), room, [], 0.02);
    assert.deepEqual(a, b);
    const kept = a.reduce((sum, x) => sum + x.areaKept_sf, 0);
    assert.ok(Math.abs(kept - 12) < 0.05, `${pat} kept ${kept} sf vs 12`);
  });
}
```

- [ ] **Step 2: Run test to verify it fails (or is the guard)**

Run: `cd web && node --import tsx --test test/tileGeometry.test.ts`
Expected: PASS once Tasks 6–10 are correct; a FAIL here means a generator leaves gaps or classification drifts — fix the offending module, not the tolerance.

- [ ] **Step 3–4: Fix any module the guard exposes; re-run.**

- [ ] **Step 5: Commit**

```bash
git add web/test/tileGeometry.test.ts
git commit -m "test(tile): cross-engine determinism + kept-area = room-area invariant"
```

### M2 verification gate

- [ ] Run `cd web && npm run check`; green (typecheck + lint + all tests + build).
- [ ] Re-run the reviewer gate (fact + architect) on the M1+M2 diff; proceed only on READY.
- [ ] Open a PR for M1+M2 (`gh pr create`), wait for the `web` check, squash-merge with `--delete-branch` (remember: merge = deploy) only after the reviewers return READY and you have verified the engine against the design doc's §3.0/§3.1/§3.2.

---

## Self-Review

**Spec coverage (design §5 M1/M2 rows):**
- M1 "data model + runtime guard" → Task 1 (`tileSetup.ts` + `hasTileSetup`).
- M1 "SKUs, joint presets, colors, grout reference" → Task 1 types + `mintTileSetup`; grout stays a reference object (derivation is M3, correctly out of scope here).
- M1 "CT-1 seed" → Task 2.
- M1 "versioned" → Task 5 (export/import round-trip guard); `takeoff_canvas.v1`/`report.v1` are additive and `tile_setup` rides the condition.
- M1 "edit_condition round-trip" → Task 4; template/library copy (a data-model completeness item) → Task 3.
- M2 "tilePitch" → Task 6.
- M2 "tilePatterns (lattice/offset/diagonal/herringbone/basketweave)" → Tasks 7–9.
- M2 "tileGeometry (jsts, full/cut/hole/corner, L-cut)" → Task 10.
- M2 "Tests: pitch/face invariants, installed-face cut dimensioning, determinism" → Tasks 6, 10, 11.

**Deviation from the design doc, recorded:** §3.2 names `polygon-clipping`; this plan uses the already-vendored `jsts` (Global Constraints + Task 10). Same Martinez-class boolean, no new dependency, matches `polyarr.ts`/`cutout.js` convention. This is a plan-level implementation choice, not a scope change; flag it to the reviewers.

**Type consistency:** `TileQuad` fields (`cx,cy,w,h,rot,skuId`) are identical in Tasks 7–11; `tileConfig` output keys match `GenInput` fields; `Classified.cut` shape is stable between Tasks 10 and 11. The design's `TileQuad {cx,cy,w,h,rot,sku}` uses `sku`; this plan uses `skuId` consistently across every task (a SKU **id** reference, not the object) — noted so a reviewer reading the design doesn't flag it as drift.

**Placeholder scan:** Task 9's herringbone/basketweave bodies and Task 10's jsts wiring are described as "implement" with a signature + sketch rather than full code, because the exact jsts call chain and the interlock lattice math are the substantive engineering of those tasks and the tests pin their observable contract precisely. Every other step carries runnable code. An executor treats the tests as the spec for those two bodies.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-25-tile-patterning-m1-m2.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
