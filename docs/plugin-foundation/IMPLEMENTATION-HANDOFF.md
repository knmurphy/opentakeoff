# Plugin Foundation — Implementation Handoff

Issues: **#167** (Slice 2a, contract core) → **#168** (Slice 2b, overlay host) → **#169** (Slice 3, export plugin); **#170** (agentTools refactor, independent). Umbrella **#166**.

This plan survived 5 adversarial review rounds. The ACs on each issue are the contract — they are not suggestions, and they were written *because* a reviewer caught the failure mode they prevent. Implement to the ACs, then prove it with the per-issue adversarial review below. **Findings get applied, not filed.**

---

## 0. Definition of Done — the anti-sloppiness bar (applies to EVERY slice)

A slice is done when all its ACs are met AND none of the following are present. Each of these is an **automatic review failure** — reviewers must actively hunt for them:

**Tests that don't test**
- A test with no meaningful assertion, a tautology (`assert(true)`, `expect(x).toBe(x)`), or a snapshot that locks nothing.
- A test that mocks the unit under test into meaninglessness (e.g. mocking `metaGet` when the point is to test storage round-trip — use `fake-indexeddb`, the real thing).
- `.skip` / `.only` / commented-out tests. A disabled test is a missing test.
- A "committed test" named in an AC that doesn't actually run in `npm test` / `npm run typecheck` / the named CI layer. Prove it runs by running it.
- **Mutation check:** for each frozen-surface / behavior-parity test, break the code on purpose and confirm the test goes red. A test that passes against broken code is worthless.

**Contract / type laziness (fatal in the TS core, #167)**
- `any`, `as any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error`-without-a-reason, or loosening `tsconfig`. The whole point of authoring in `.ts` is that `tsc` enforces the public surface.
- Widening the frozen descriptor key set or the frozen `ctx` accessor set without a version bump. The surface is *exactly* what the issue lists.
- An error whose message names the storage backend (`IndexedDB`/`Drive`) — it names the scope contract only.

**Shipping debris**
- `TODO` / `FIXME` / `XXX` / placeholder / stubbed return left in shipped code. If it's not finished, it's not done.
- `console.log` debug noise (the deliberate `console.warn` on version-skip is required, not debris).
- Dead code, commented-out code, unused exports, "just in case" abstractions with no caller.
- Copy-pasting the spike where the spec says it diverges — the spike is throwaway and **wrong on purpose** in two spots: storage `scope` (`'device-local'`→`'device'`, field→input) and the naive `plugin:${id}:${key}` keyspace (must be escaped/length-prefixed), and the export `run(ctx)`→void `onSelect(ctx)`.

**Silent scope drift**
- Swallowed errors (`catch {}` / `catch (e) {}` with no handling). Every catch either handles or re-throws with context. The loader's "skip a broken plugin" is a *logged* skip, not a silent one.
- Non-additive canvas edits when the AC says additive-only. `git diff` on `TakeoffCanvas.jsx` must show **0 deletions** and no existing line modified.
- Weakening an assertion, loosening an AC, or deleting a failing test to get green. If an AC is wrong, say so and stop — don't route around it.

**Process**
- `npm run typecheck && npm run lint && npm test && npm run build` all green **locally** before the PR is opened. "CI will catch it" is not the bar.
- The PR description maps each AC → the commit/test that satisfies it. An AC with no cited proof is assumed unmet.

---

## 1. Per-slice workflow

1. Read the issue's ACs and the referenced spike files (reference, **not** copy — see divergences above).
2. TDD where the harness allows: write the committed test first (it goes red), then implement (green). Pure logic (registry, `validateDescriptor`, `selectRenderablePlugins`, storage) is all node-testable — no excuse for untested logic.
3. Self-run the Definition-of-Done checklist above.
4. Dispatch the slice's adversarial review personas (Section 3). Apply every surviving finding.
5. Re-review until a round is clean. **Kevin gives the merge word** (merge ≠ deploy).

---

## 2. Review protocol

- Run the slice's personas as independent subagents, each grounded in the real diff + the real repo (verify `file:line`, don't trust prose).
- Each persona returns ranked findings (blocker / major / minor) with a concrete failure scenario, not vibes. "This feels fragile" is not a finding; "a key containing `:` collides with plugin `a:b`, here's the input" is.
- **A persona that reports "looks good" without having tried to break something specific has not reviewed.** Every persona must state what it attacked and why the attack failed.
- Apply findings, re-dispatch, repeat until a full round is clean. Do not merge on a round with an open blocker/major.
- A default `ready-for-agent` slice is AFK-implementable; it still gets the human merge gate.

---

## 3. Adversarial code-review personas per issue

Each persona below is a lens with a mandate to *break* the slice. Spawn them per PR.

### #167 — Slice 2a (pure TS contract core)
This is a **public semver API**; a mistake here is frozen for every community plugin. Hardest review of the four.

- **The Contract Freezer.** Mandate: prove the public surface can't drift. Add a key to the descriptor and to `buildCanvasContext` — the frozen-key test and the surface-lock test MUST go red. If either stays green, the lock is fake. Verify the frozen sets are *exactly* `{id, minCtxVersion, overlays, exports}` and the 10 enumerated ctx accessors — no accidental extras, no missing ones.
- **The Reversibility Auditor.** Mandate: make a plugin observe how storage is backed. Try `ctx.storage.scope`, `.backend`, any enumerable property; inspect the `scope:'project'` rejection for a sync-vs-async tell or a backend name in the message; time device vs project to see if they differ observably. Then attack namespacing: find two `(id, key)` pairs that collide (`"a"+"b:c"` vs `"a:b"+"c"`); the escaping must defeat it. Any leak = blocker (irreversible once shipped).
- **The Type Enforcer.** Mandate: find the escape hatch. Grep for `any`/`@ts-ignore`/`as unknown`; confirm `npm run typecheck` actually covers the new files; confirm the `.d.ts`/public-types artifact is complete and importable. Check the `major.minor` comparison math by hand: `1.1` needed vs `1.2` host (pass), vs `1.0` host (skip), vs `2.0` host (skip). Off-by-one here breaks every gate.
- **The Forward-Compat Adversary.** Mandate: break the gate-before-reject ordering. Feed a descriptor with a future `minCtxVersion` AND a `panels` key the host doesn't know — assert it version-skips ("host too old"), not unknown-key-rejects. Feed a version-*compatible* descriptor with a junk key — assert it hard-rejects. If the ordering is ambiguous in code, that's a major.
- **The CI-Guard Auditor.** Mandate: make the Axis-A guard rot silently. Rename/break the `__ci_probe__` fixture — the guard must fail on missing canary, not pass vacuously. Confirm it also fails if a real `features/*` module lands in the entry chunk (introduce one, watch it go red).

### #168 — Slice 2b (rendered overlay host + mutating reference plugin)
Touches the hottest file in the repo. Two mandates: contain plugin failures, and don't diverge the monolith.

- **The Monolith Guardian.** Mandate: prove the canvas edit is truly additive. `git diff TakeoffCanvas.jsx` must be 0 deletions, no existing line altered. Reject any coupling that leaked into the canvas beyond the `pluginApi` bag + one render. Confirm the footprint claim is honest (report the real line count).
- **The Isolation Breaker.** Mandate: white-screen the canvas. Ship a plugin that throws in render, one that throws in `useEffect`, one that throws during its mutation. The per-slot error boundary must contain each (render-phase), the app must survive, and the failure must degrade to "feature missing." If any throw escapes, blocker.
- **The Provenance Auditor.** Mandate: verify the mutation is *real*, not faked. The reference plugin's mutation must route `commands.dispatchShape` → `applyShapeCommand` (undo/redo works, provenance stamped, contribute.v2 intact) — NOT a raw `setShapes`. Undo the plugin's mutation; it must undo cleanly like any canvas edit.
- **The Stale-State & Lifecycle Hunter.** Mandate: catch stale reads and leaks. Change canvas state while an overlay is open — accessors must return live values, not a snapshot from mount. Verify StrictMode double-invoke safety, unmount cleanup (no leaked listeners), and that one-overlay-at-a-time is actually enforced (not just visually).

### #169 — Slice 3 (export slot + export plugin)
The event-handler isolation trap and the second-façade trap are the whole review.

- **The Single-Façade Enforcer.** Mandate: find a second `buildCanvasContext`. There must be exactly one definition, reused; ReportPanel must NOT construct its own ctx. Confirm the prop is *pre-bound* items (`onSelect: () => descriptor.onSelect(ctx)`), not a raw `api` that forces ReportPanel to build ctx. A second façade = major (diverges from #167's frozen surface).
- **The Event-Handler Isolation Auditor.** Mandate: prove the render boundary is NOT what's catching export throws (it structurally can't — `ToolMenu.jsx:90` fires `onSelect` from `onClick`). The isolation must be a real dispatch-time `try/catch` around each `onSelect`. Ship a throwing export: the report flow survives with a non-fatal notice. If the implementer "relied on the error boundary," it will crash — catch that.
- **The Divergence Accountant.** Mandate: minimize the footprint in ReportPanel (the #2 hottest file). The append into the `Export ▾` items array must be additive and small; flag anything that restructures the menu or would conflict hard on an upstream sync.
- **The Descriptor Conformance Cop.** Mandate: the export plugin passes `validateDescriptor` with no new top-level keys, and uses the frozen void `onSelect(ctx)` convention — NOT the spike's returning `run(ctx)`. If it copied the spike, fail it.

### #170 — agentTools switch→handler-map (independent)
Small, but "byte-identical" is a strong claim that's easy to violate.

- **The Behavior-Parity Auditor.** Mandate: find a semantic difference. Exercise all **8** tools through both success and error paths; the handler-map output must match the old `switch` exactly (including the "unknown tool" and validation-failure messages). Extend `agentTools.test.ts` to cover each — a parity claim with partial coverage is unproven.
- **The Scope Cop.** Mandate: confirm the blast radius is one file. Touches only `agentTools.js`; introduces no public/plugin surface; the handler-map entry shape is not accidentally exported or documented as a contract (it's explicitly non-normative — #167 owns the real descriptor).

---

## 4. What "good" looks like here
The spike (`spike/166-plugin-feasibility`) is proof the happy path works — 19-line additive canvas footprint, own lazy chunk, live-state reads, storage round-trip, all driven in a browser. The bar for the real slices is *that, plus every edge the ACs name, plus tests that would catch the regression a year from now*. If a reviewer can't break it and every AC cites its proof, it's ready for Kevin's merge call.
