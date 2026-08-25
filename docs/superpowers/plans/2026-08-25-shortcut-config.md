# Configurable Keyboard Shortcuts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every discrete keyboard shortcut a remappable *command* — a config modal (reached from the `?` guide) lists them, captures a new chord, persists it browser-globally, and every shortcut-consuming handler dispatches through the live keymap. Bundled: Esc lands on Select (§3a).

**Architecture:** A pure `keymap.ts` module (chord grammar, command registry, resolution, matching, a module-level live keymap with `subscribe`) is the single source of truth. `keybindStore.js` persists overrides to IndexedDB `metaPut` under `KEYBIND_KEY`. `useKeymap.js` is a `useSyncExternalStore` hook. `ShortcutConfig.jsx` is the modal. The hardcoded key handlers in `TakeoffCanvas.jsx` swap key-literal tests for `matchCommand`/`matches` against the live keymap; the label surfaces (`UserGuide`, `ToolMenu`, `railTile`) read the effective binding.

**Tech Stack:** React 18 + Vite; TypeScript pure modules (`.ts`) tested with `node:test` via `node --import tsx --test test/*.test.ts`; `fake-indexeddb` for the store test.

**Spec:** `docs/superpowers/specs/2026-08-25-shortcut-config-design.md` (binding authority — the plan argues from it; conflicts resolve against it).

## Global Constraints

- Node ≥24; run tests as `cd web && npm test -- test/keymap.test.ts` (single file) — never the whole suite mid-task.
- `npm run check` = typecheck + lint + test + bench + build. Run it once, at the end of Task 8, from `web/`.
- 25 commands, exactly — the table in spec §3 is verbatim truth; do not add/remove/rename commands.
- Chord canonical form: `mod`/`shift`/`alt` in that order, then the key token; letters lowercase, named keys lowercase (`escape`/`enter`/`backspace`/`delete`/`space`), `?` and digits as-is.
- Matching is two-step: exact, then (only when the chord's *sole* modifier is `shift`) drop the shift and retry. `mod` and `alt` are always exact.
- `deleteBack`'s default is the pair `["backspace", "delete"]`; every other command has a single-chord default.
- Conflict policy: **reject, never steal.** No unbound-command state. Rebinding to a command's own current chord is a no-op.
- Guard fidelity: the merged dispatch must reproduce today's per-command guards (target guard everywhere; `menuDepthRef` on letters/digits only; `shortcutsOpen` on *all* remappable commands; sweep hoisted above the gallery early-return). See Task 6.
- Persistence is browser-global (`KEYBIND_KEY`), overrides-only shape `{ [commandId]: chord }`, with a load-complete gate (Task 3).
- Copy: modal title "Keyboard shortcuts", button label "Keyboard shortcuts…", restore label "Restore all defaults", capture prompt "Press keys…". No vendor mimicry; match existing `Kbd` keycap styling as-is.
- No new npm dependencies.

---

### Task 1: `keymap.ts` — chord grammar + display (pure)

**Files:**
- Create: `web/src/lib/keymap.ts` (chord grammar + display only — registry/live state arrive in Task 2)
- Test: `web/test/keymap.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2, 4, 6, 7):
  - `export function normalizeChord(chord: string): string | null` — parse a stored/user string to canonical form; `null` if invalid.
  - `export function normalizeEvent(e: EventLike): string | null` — canonical chord from an event; `null` if modifier-only.
  - `export type EventLike = { key: string; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }`
  - `export function isModifierKey(key: string): boolean`
  - `export function chordToKeys(chord: string, apple?: boolean): string[]` — display tokens, e.g. `["⇧","D"]` / `["Shift","D"]`.

- [ ] **Step 1: Write the failing tests** — `web/test/keymap.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeChord, normalizeEvent, isModifierKey, chordToKeys } from "../src/lib/keymap.ts";

const ev = (key: string, m: Partial<{ shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) =>
  ({ key, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...m });

test("normalizeEvent: bare letters lowercase", () => {
  assert.equal(normalizeEvent(ev("d")), "d");
  assert.equal(normalizeEvent(ev("A")), "shift+a");   // e.key reports the shifted char; shiftKey carries the modifier
});

test("normalizeEvent: mod is meta OR ctrl", () => {
  assert.equal(normalizeEvent(ev("z", { metaKey: true })), "mod+z");
  assert.equal(normalizeEvent(ev("z", { ctrlKey: true })), "mod+z");
});

test("normalizeEvent: modifier order is canonical", () => {
  assert.equal(normalizeEvent(ev("z", { metaKey: true, shiftKey: true })), "mod+shift+z");
  assert.equal(normalizeEvent(ev("d", { shiftKey: true, altKey: true })), "shift+alt+d");
});

test("normalizeEvent: named keys lowercase, punctuation/digits as-is", () => {
  assert.equal(normalizeEvent(ev("Escape")), "escape");
  assert.equal(normalizeEvent(ev("Enter")), "enter");
  assert.equal(normalizeEvent(ev("Backspace")), "backspace");
  assert.equal(normalizeEvent(ev("Delete")), "delete");
  assert.equal(normalizeEvent(ev("?")), "?");
  assert.equal(normalizeEvent(ev("1")), "1");
});

test("normalizeEvent: caps lock does not read as shift", () => {
  assert.equal(normalizeEvent(ev("A")), "shift+a");       // real shift
  assert.equal(normalizeEvent(ev("a", { shiftKey: false })), "a"); // (caps-lock "A" arrives as e.key "A" but shiftKey false — see next)
  assert.equal(normalizeEvent({ key: "A" }), "a");        // e.key already shifted, no shiftKey flag
});

test("normalizeEvent: modifier-only presses are not chords", () => {
  assert.equal(normalizeEvent(ev("Shift", { shiftKey: true })), null);
  assert.equal(normalizeEvent(ev("Meta", { metaKey: true })), null);
  assert.equal(normalizeEvent(ev("Control", { ctrlKey: true })), null);
  assert.equal(normalizeEvent(ev("Alt", { altKey: true })), null);
});

test("normalizeChord: parses canonical and round-trips", () => {
  assert.equal(normalizeChord("mod+shift+z"), "mod+shift+z");
  assert.equal(normalizeChord("shift+d"), "shift+d");
  assert.equal(normalizeChord("d"), "d");
  assert.equal(normalizeChord("escape"), "escape");
  assert.equal(normalizeChord("?"), "?");
});

test("normalizeChord: rejects invalid", () => {
  assert.equal(normalizeChord("shift"), null);           // modifier-only
  assert.equal(normalizeChord("shift+shift+d"), null);   // duplicate modifier
  assert.equal(normalizeChord(""), null);
  assert.equal(normalizeChord("d+e"), null);             // two keys
});

test("normalizeChord: reorders modifiers to canonical order", () => {
  assert.equal(normalizeChord("alt+shift+d"), "shift+alt+d");
});

test("isModifierKey", () => {
  for (const k of ["Shift", "Control", "Ctrl", "Alt", "Meta", "Option"]) assert.equal(isModifierKey(k), true);
  assert.equal(isModifierKey("d"), false);
  assert.equal(isModifierKey("Escape"), false);
});

test("chordToKeys: display tokens, platform-aware", () => {
  assert.deepEqual(chordToKeys("shift+d", true), ["⇧", "D"]);
  assert.deepEqual(chordToKeys("shift+d", false), ["Shift", "D"]);
  assert.deepEqual(chordToKeys("mod+z", true), ["⌘", "Z"]);
  assert.deepEqual(chordToKeys("mod+z", false), ["Ctrl", "Z"]);
  assert.deepEqual(chordToKeys("escape", true), ["Esc"]);
  assert.deepEqual(chordToKeys("enter", true), ["⏎"]);
  assert.deepEqual(chordToKeys("backspace", true), ["⌫"]);
  assert.deepEqual(chordToKeys("delete", false), ["Delete"]);
  assert.deepEqual(chordToKeys("?", true), ["?"]);
});
```

- [ ] **Step 2: Run to verify they fail** — `cd web && npm test -- test/keymap.test.ts`. Expected: FAIL, "Cannot find module '../src/lib/keymap.ts'".

- [ ] **Step 3: Implement** — `web/src/lib/keymap.ts`:

```ts
// Keyboard-shortcut command model — the chord grammar, the command registry,
// resolution, matching, and the live keymap. Pure and DOM-free: KeyboardEvent is
// simulated with a plain object (like lib/keys.ts takes `navigator`), so it runs
// under node:test.

export type Category = "Tools" | "Navigation" | "Edit" | "Escape hatch";
export interface EventLike { key: string; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; }

const MODIFIERS = ["mod", "shift", "alt"] as const;

export function isModifierKey(key: string): boolean {
  return ["Shift", "Control", "Ctrl", "Alt", "Meta", "Option"].includes(key);
}

// One non-modifier key -> its canonical token: letters lowercase, digits and
// punctuation as-is ("?" stays "?"), named keys lowercase ("Escape" -> "escape").
function keyToken(key: string): string {
  if (key.length === 1) return /[a-zA-Z]/.test(key) ? key.toLowerCase() : key;
  return key.toLowerCase();
}

// "mod" is the primary modifier: ⌘ (metaKey) on macOS, Ctrl (ctrlKey) elsewhere.
function modsOf(e: { shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }): string[] {
  const out: string[] = [];
  if (e.metaKey || e.ctrlKey) out.push("mod");
  if (e.shiftKey) out.push("shift");
  if (e.altKey) out.push("alt");
  return out;
}

export function normalizeEvent(e: EventLike): string | null {
  if (!e.key || isModifierKey(e.key)) return null; // incomplete — a modifier with no key
  return [...modsOf(e), keyToken(e.key)].join("+");
}

export function normalizeChord(chord: string): string | null {
  if (!chord) return null;
  const parts = chord.split("+");
  const mods: string[] = [];
  let key: string | null = null;
  for (const raw of parts) {
    const p = raw.trim().toLowerCase();
    if (p === "mod" || p === "shift" || p === "alt") {
      if (mods.includes(p)) return null; // duplicate modifier
      mods.push(p);
    } else {
      if (key !== null) return null; // two keys
      key = raw.trim();
    }
  }
  if (key === null) return null; // modifier-only
  const ordered = MODIFIERS.filter((m) => mods.includes(m));
  return [...ordered, keyToken(key)].join("+");
}

const GLYPH: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", enter: "⏎", backspace: "⌫" };
const PC: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt", enter: "Enter", backspace: "Backspace" };

export function chordToKeys(chord: string, apple: boolean = typeof navigator === "undefined" ? false : /Mac|iPhone|iPad|iPod/i.test(navigator.platform)): string[] {
  return chord.split("+").map((p) => {
    if (apple) {
      if (p === "escape") return "Esc";
      if (p === "delete") return "Delete";
      return GLYPH[p] ?? (p.length === 1 ? p.toUpperCase() : p);
    }
    return PC[p] ?? (p.length === 1 ? p.toUpperCase() : p);
  });
}
```

- [ ] **Step 4: Run to verify they pass** — `cd web && npm test -- test/keymap.test.ts`. Expected: PASS (all tests).

- [ ] **Step 5: Commit** — `git add web/src/lib/keymap.ts web/test/keymap.test.ts && git commit -m "feat(shortcuts): chord grammar + display (keymap.ts, pure)"`.

---

### Task 2: `keymap.ts` — registry, resolution, matching, live keymap

**Files:**
- Modify: `web/src/lib/keymap.ts` (append to Task 1's file)
- Test: `web/test/keymap.test.ts` (append)

**Interfaces:**
- Produces:
  - `export const DEFAULT_KEYMAP: Readonly<Record<string, CommandDef>>` — `CommandDef = { label: string; category: Category; default: string | string[] }`.
  - `export function resolveKeymap(overrides: Record<string, string>): Record<string, string[]>` — commandId → effective chords.
  - `export function findConflict(chord: string, overrides: Record<string, string>, excludeId: string): string | null` — the commandId currently owning `chord`, or `null`.
  - `export function matchCommand(e: EventLike): string | null` — reads the live keymap.
  - `export function matches(e: EventLike, commandId: string): boolean`
  - Live state: `getOverrides()`, `applyOverrides(o)`, `setOverride(commandId, chord)`, `resetCommand(commandId)`, `resetAll()`, `subscribe(fn)`.

- [ ] **Step 1: Write the failing tests** (append):

```ts
import { DEFAULT_KEYMAP, resolveKeymap, findConflict, matchCommand, matches, getOverrides, applyOverrides, setOverride, resetCommand, resetAll } from "../src/lib/keymap.ts";

test("DEFAULT_KEYMAP: 25 commands, categories partition", () => {
  const ids = Object.keys(DEFAULT_KEYMAP);
  assert.equal(ids.length, 25);
  for (const cat of ["Tools", "Navigation", "Edit", "Escape hatch"]) {
    assert.ok(ids.some((id) => DEFAULT_KEYMAP[id].category === cat), cat);
  }
  assert.deepEqual(DEFAULT_KEYMAP.deleteBack.default, ["backspace", "delete"]);
  assert.equal(DEFAULT_KEYMAP.escape.default, "escape");
});

test("resolveKeymap: defaults spread, override wins", () => {
  const eff = resolveKeymap({});
  assert.deepEqual(eff.area, ["a"]);
  assert.deepEqual(eff.deductRect ?? eff["deduct-rect"], ["shift+d"]);
  const over = resolveKeymap({ area: "x" });
  assert.deepEqual(over.area, ["x"]);
});

test("resolveKeymap: deleteBack pair indexes both tokens", () => {
  const eff = resolveKeymap({});
  assert.deepEqual(eff.deleteBack, ["backspace", "delete"]);
});

test("findConflict: collision, self, overridden-away default", () => {
  assert.equal(findConflict("a", {}, "rect"), "area");       // "a" is area's default
  assert.equal(findConflict("a", {}, "area"), null);          // self is not a conflict
  assert.equal(findConflict("a", { area: "x" }, "rect"), null); // area moved off "a" -> no conflict
});

test("matchCommand: exact then shift-fallback", () => {
  applyOverrides({});
  assert.equal(matchCommand({ key: "a" }), "area");
  assert.equal(matchCommand({ key: "A", shiftKey: true }), "area");     // shift+A -> fallback -> a
  assert.equal(matchCommand({ key: "D", shiftKey: true }), "deduct-rect"); // shift+d exact
  assert.equal(matchCommand({ key: "d" }), "deduct");
  assert.equal(matchCommand({ key: "z", metaKey: true }), "undo");
  assert.equal(matchCommand({ key: "z", shiftKey: true, metaKey: true }), "redo");
  assert.equal(matchCommand({ key: "?" }), "guide");
  assert.equal(matchCommand({ key: "?", shiftKey: true }), "guide");     // US shift+/ -> "?" via fallback
  assert.equal(matchCommand({ key: "Backspace" }), "deleteBack");
  assert.equal(matchCommand({ key: "Delete" }), "deleteBack");
});

test("matchCommand: override changes the trigger", () => {
  applyOverrides({ area: "shift+p" });
  assert.equal(matchCommand({ key: "p", shiftKey: true }), "area");
  assert.equal(matchCommand({ key: "a" }), null); // a no longer binds anything
});

test("matches: is-event-the-binding", () => {
  applyOverrides({});
  assert.equal(matches({ key: "Escape" }, "escape"), true);
  assert.equal(matches({ key: "Enter" }, "escape"), false);
  assert.equal(matches({ key: "z", metaKey: true }, "undo"), true);
});

test("live state: set/reset/round-trip", () => {
  resetAll();
  setOverride("area", "x");
  assert.deepEqual(getOverrides(), { area: "x" });
  resetCommand("area");
  assert.deepEqual(getOverrides(), {});
  setOverride("area", "x"); setOverride("rect", "r");
  resetAll();
  assert.deepEqual(getOverrides(), {});
});
```

- [ ] **Step 2: Run to verify they fail** — Expected: FAIL, `DEFAULT_KEYMAP`/`resolveKeymap`/etc. not exported.

- [ ] **Step 3: Implement** — append to `keymap.ts`:

```ts
// ── command registry ─────────────────────────────────────────────────────────
export interface CommandDef { label: string; category: Category; default: string | string[]; }

export const DEFAULT_KEYMAP: Readonly<Record<string, CommandDef>> = Object.freeze({
  oneclick:   { label: "One-Click Area", category: "Tools", default: "o" },
  area:       { label: "Area", category: "Tools", default: "a" },
  rect:       { label: "Rectangle", category: "Tools", default: "r" },
  linear:     { label: "Linear", category: "Tools", default: "l" },
  surface:    { label: "Surface Area", category: "Tools", default: "s" },
  count:      { label: "Count", category: "Tools", default: "c" },
  deduct:     { label: "Deduct shape", category: "Tools", default: "d" },
  "deduct-rect": { label: "Deduct rectangle", category: "Tools", default: "shift+d" },
  highlighter:{ label: "Highlighter", category: "Tools", default: "h" },
  dimension:  { label: "Dimension line", category: "Tools", default: "n" },
  check:      { label: "Check dimension", category: "Tools", default: "k" },
  select:     { label: "Select", category: "Tools", default: "v" },
  symbol:     { label: "Symbol sweep", category: "Tools", default: "y" },
  curveFlip:  { label: "Straight ⇄ Curve", category: "Tools", default: "q" },
  gallery:    { label: "Sheet gallery", category: "Navigation", default: "g" },
  focusMode:  { label: "Focus mode", category: "Navigation", default: "f" },
  guide:      { label: "Open this guide", category: "Navigation", default: "?" },
  undo:       { label: "Undo", category: "Edit", default: "mod+z" },
  redo:       { label: "Redo", category: "Edit", default: "mod+shift+z" },
  copy:       { label: "Copy", category: "Edit", default: "mod+c" },
  paste:      { label: "Paste", category: "Edit", default: "mod+v" },
  duplicate:  { label: "Duplicate", category: "Edit", default: "mod+d" },
  escape:     { label: "Back out one level · drop to Select", category: "Escape hatch", default: "escape" },
  commit:     { label: "Commit · create · accept", category: "Escape hatch", default: "enter" },
  deleteBack: { label: "Delete back one step", category: "Escape hatch", default: ["backspace", "delete"] },
});

// ── resolution & conflict ─────────────────────────────────────────────────────
export function resolveKeymap(overrides: Record<string, string>): Record<string, string[]> {
  const eff: Record<string, string[]> = {};
  for (const [id, def] of Object.entries(DEFAULT_KEYMAP)) {
    const bound = overrides[id] ?? def.default;
    eff[id] = Array.isArray(bound) ? bound : [bound];
  }
  return eff;
}

function reverseIndex(eff: Record<string, string[]>): Map<string, string> {
  const idx = new Map<string, string>();
  for (const [id, chords] of Object.entries(eff)) for (const c of chords) if (!idx.has(c)) idx.set(c, id);
  return idx;
}

// A chord collides if the EFFECTIVE map already assigns it to another command.
export function findConflict(chord: string, overrides: Record<string, string>, excludeId: string): string | null {
  const eff = resolveKeymap(overrides);
  const idx = reverseIndex(eff);
  const hit = idx.get(chord);
  return hit && hit !== excludeId ? hit : null;
}

// ── live keymap (module-level binding, like `export let store` in store.js) ──
let overrides: Record<string, string> = {};
const listeners = new Set<() => void>();
function notify() { for (const fn of listeners) fn(); }

export function getOverrides(): Record<string, string> { return { ...overrides }; }
export function applyOverrides(next: Record<string, string>): void { overrides = { ...next }; notify(); }
export function setOverride(commandId: string, chord: string): void { overrides = { ...overrides, [commandId]: chord }; notify(); }
export function resetCommand(commandId: string): void { if (!(commandId in overrides)) return; const n = { ...overrides }; delete n[commandId]; overrides = n; notify(); }
export function resetAll(): void { if (Object.keys(overrides).length === 0) return; overrides = {}; notify(); }
export function subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

// ── matching ─────────────────────────────────────────────────────────────────
function commandForChord(eff: Record<string, string[]>, chord: string): string | null {
  const idx = reverseIndex(eff);
  const hit = idx.get(chord);
  if (hit) return hit;
  const parts = chord.split("+");
  if (parts.length === 2 && parts[0] === "shift") return idx.get(parts[1]) ?? null; // shift-insensitive fallback
  return null;
}

export function matchCommand(e: EventLike): string | null {
  const chord = normalizeEvent(e);
  if (!chord) return null;
  return commandForChord(resolveKeymap(overrides), chord);
}

export function matches(e: EventLike, commandId: string): boolean {
  return matchCommand(e) === commandId;
}
```

- [ ] **Step 4: Run to verify they pass** — `cd web && npm test -- test/keymap.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(shortcuts): command registry, resolution, matching, live keymap"`.

---

### Task 3: `keybindStore.js` + `useKeymap.js` + load gate

**Files:**
- Create: `web/src/lib/keybindStore.js`
- Create: `web/src/lib/useKeymap.js`
- Test: `web/test/keybindStore.test.ts`

**Interfaces:**
- Produces:
  - `export const KEYBIND_KEY = "keybindings"` (from keybindStore.js).
  - `export async function loadKeybindOverrides(): Promise<void>` — `metaGet(KEYBIND_KEY)` then `applyOverrides(parsed ?? {})`.
  - `export async function saveKeybindOverrides(): Promise<void>` — `metaPut(KEYBIND_KEY, getOverrides())`.
  - `export async function clearKeybindOverrides(): Promise<void>` — `metaDelete(KEYBIND_KEY)` then `resetAll()`.
  - `export function useKeymap(): Record<string, string[]>` (from useKeymap.js) — reactive effective keymap via `useSyncExternalStore`.

- [ ] **Step 1: Write the failing tests** — `web/test/keybindStore.test.ts`:

```ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { loadKeybindOverrides, saveKeybindOverrides, clearKeybindOverrides, KEYBIND_KEY } from "../src/lib/keybindStore.js";
import { getOverrides, applyOverrides, resetAll } from "../src/lib/keymap.ts";
import { metaGet, metaPut, metaDelete } from "../src/lib/store.js";

beforeEach(async () => { resetAll(); await metaDelete(KEYBIND_KEY).catch(() => {}); });

test("save/load round-trips overrides", async () => {
  applyOverrides({ area: "x", escape: "q" });
  await saveKeybindOverrides();
  applyOverrides({});                       // simulate a fresh boot
  await loadKeybindOverrides();
  assert.deepEqual(getOverrides(), { area: "x", escape: "q" });
});

test("load with nothing stored leaves empty overrides", async () => {
  await loadKeybindOverrides();
  assert.deepEqual(getOverrides(), {});
});

test("clear removes the key and resets live state", async () => {
  applyOverrides({ area: "x" });
  await saveKeybindOverrides();
  await clearKeybindOverrides();
  assert.deepEqual(getOverrides(), {});
  assert.equal(await metaGet(KEYBIND_KEY), undefined);
});

test("a save writes only overrides (not defaults)", async () => {
  applyOverrides({ area: "x" });
  await saveKeybindOverrides();
  assert.deepEqual(await metaGet(KEYBIND_KEY), { area: "x" });
});
```

- [ ] **Step 2: Run to verify they fail** — Expected: FAIL, module missing.

- [ ] **Step 3: Implement** — `web/src/lib/keybindStore.js`:

```js
// Browser-global keybinding overrides, persisted under their own key in the
// keyPath-less meta store (the templates/materials/stamps pattern — no DB bump).
// keymap.ts owns the live state; this module is the IndexedDB seam for it.
import { metaGet, metaPut, metaDelete } from "./store.js";
import { getOverrides, applyOverrides, resetAll } from "./keymap.ts";

export const KEYBIND_KEY = "keybindings";

// Load-complete gate: applyOverrides is the ONLY thing that mutates the live map
// from disk. Call this once at startup (app shell); the config modal stays
// disabled until it resolves so an early save can't be stomped by this read.
export async function loadKeybindOverrides() {
  const stored = await metaGet(KEYBIND_KEY);
  applyOverrides(stored && typeof stored === "object" ? stored : {});
}

export async function saveKeybindOverrides() {
  await metaPut(KEYBIND_KEY, getOverrides());
}

export async function clearKeybindOverrides() {
  await metaDelete(KEYBIND_KEY);
  resetAll();
}
```

`web/src/lib/useKeymap.js`:

```js
// Reactive effective keymap for React surfaces (the config modal, guide tables,
// tool labels). Dispatch paths do NOT need this — they read the live keymap
// synchronously through matchCommand/matches at keydown time.
import { useSyncExternalStore } from "react";
import { subscribe, resolveKeymap, getOverrides } from "./keymap.ts";

const EMPTY = {};
let cache = EMPTY;

function getSnapshot() {
  // getOverrides returns a fresh object each call; useSyncExternalStore requires
  // a stable snapshot between changes, so cache by JSON identity.
  const o = getOverrides();
  const key = JSON.stringify(o);
  if (cache === EMPTY || cacheKey !== key) { cacheKey = key; cache = resolveKeymap(o); }
  return cache;
}
let cacheKey = "";

export function useKeymap() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

> Note for the implementer: verify `getSnapshot` returns a stable reference between calls when overrides are unchanged (the `cacheKey` guard above); `useSyncExternalStore` throws "getSnapshot should be cached" otherwise. If the lint/linter flags module-scoped mutable `cache`/`cacheKey`, hoist them above `getSnapshot` in one closure.

- [ ] **Step 4: Run to verify they pass** — `cd web && npm test -- test/keybindStore.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(shortcuts): browser-global persistence + reactive useKeymap hook"`.

---

### Task 4: `ShortcutConfig.jsx` — the modal

**Files:**
- Create: `web/src/components/ShortcutConfig.jsx`

**Interfaces:**
- Consumes: `DEFAULT_KEYMAP`, `getOverrides`, `setOverride`, `resetCommand`, `resetAll`, `normalizeChord`, `findConflict`, `chordToKeys`, `matches` from `../lib/keymap.ts`; `saveKeybindOverrides`, `clearKeybindOverrides` from `../lib/keybindStore.js`; `useKeymap` from `../lib/useKeymap.js`; `Z` from `../lib/ui.js`; `keyLabel`, `keyText`, `isApplePlatform` from `../lib/keys.ts`.
- Produces: `export default function ShortcutConfig({ onClose })` — renders nothing that depends on the canvas; self-closing on Esc (capture-phase, mirroring `UserGuide.jsx`).

- [ ] **Step 1: Skeleton + a11y shell.** Model on `UserGuide.jsx`'s overlay (scrim + `role="dialog"` `aria-modal="true"` panel + capture-phase Esc). Add: header "Keyboard shortcuts" + `×` close; a search `<input>`; a grouped list rendered from `DEFAULT_KEYMAP` grouped by `category` in the order Tools → Navigation → Edit → Escape hatch. Each row is a `<button>` (full-width, label left, keycap(s) right) — never a bare `div`; the keycaps reuse the `Kbd`-style markup from `UserGuide.jsx` verbatim (mono, 5px radius, bottom-border). Footer: **Restore all defaults** button (left) + the fixed-keys note (Space, hold M, hold ⇧, ⌥/⇧-click, 1–9). Focus moves into the modal on mount; trap focus while open.

- [ ] **Step 2: Live bindings.** Read `const eff = useKeymap()`; render each row's keycap(s) from `eff[id]` via `chordToKeys`. Show a `reset` affordance on a row when `id in getOverrides()` — wait, `getOverrides()` isn't reactive; instead derive "is overridden" from `useKeymap` + `DEFAULT_KEYMAP` (compare `eff[id]` joined vs the default joined). Implement reset as `resetCommand(id)` then `saveKeybindOverrides()`.

- [ ] **Step 3: Capture mode.** Clicking/Enter on a row sets `capturing = id`. While capturing, install a capture-phase `keydown` that `preventDefault()` + `stopPropagation()`s everything, then: `Esc`/`Backspace` → cancel capture; `normalizeEvent(e)` → if `null` (modifier-only) stay capturing; else apply (Step 4). Also cancel capture on `blur` of the modal and on a scrim click. The row shows the capture prompt "Press keys…" with the blinking caret (respect `prefers-reduced-motion`). `matches(e, "escape")`/`matches(e, "deleteBack")` are NOT consulted here — capture cancel is the physical Esc/Backspace (spec §9).

- [ ] **Step 4: Apply + conflict.** On a complete chord `c`: if `c` equals the command's current binding → exit capture (no-op). Else `findConflict(c, getOverrides(), id)` → if non-null, show an inline danger banner "`<chordToKeys(c)>` is already bound to `<label>` — press a different key, or Esc to cancel" and stay capturing. Else `setOverride(id, c)`; `saveKeybindOverrides()`; clear capture.

- [ ] **Step 5: Restore all + search.** "Restore all defaults" → `resetAll()` then `clearKeybindOverrides()`. Search filters rows by label (case-insensitive substring).

- [ ] **Step 6: Verify in the browser.** `cd web && npm run dev`, open `http://localhost:5173`, load the sample plan, press `?`, click "Keyboard shortcuts…". Confirm: the 25 commands group correctly; a row click enters capture; typing `⇧P` rebinds Area (keycap updates); the conflict banner appears when typing `⇧D`; reset and Restore all work; Esc closes; the modal is Tab-navigable (Tab to a row, Enter to capture). Screenshot the modal for the PR.

- [ ] **Step 7: Commit** — `git commit -m "feat(shortcuts): config modal (capture, conflict, reset)"`.

---

### Task 5: `UserGuide.jsx` — entry point + live tables

**Files:**
- Modify: `web/src/components/UserGuide.jsx`

**Interfaces:**
- Consumes: `useKeymap`, `DEFAULT_KEYMAP`, `chordToKeys` from `../lib/keymap.ts`; imports `ShortcutConfig` (rendered by the *canvas*, not here — this task only adds the footer button that calls a new `onOpenShortcuts` prop).

- [ ] **Step 1: Add the `onOpenShortcuts` prop + footer button.** Change the signature to `function UserGuide({ onClose, onOpenShortcuts })`. In the footer (`<div>` that holds the "full manual" link), add a right-aligned cluster: a muted "Want to change a key?" line + a `<button>` labeled **Keyboard shortcuts…** that calls `onOpenShortcuts` (then `onClose`). Match the mockup: mono button, cobalt border, no radius.

- [ ] **Step 2: Make command-backed rows live.** `TOOLS`/`DRAW`/`VIEW` are currently `[combo, what]` literal arrays where `combo` is a glyph array. Convert the command-backed entries to reference a command id and render the *effective* chord via `useKeymap` + `chordToKeys`. Fixed rows (hold-`M`, `1`–`9`, Space, the `⌥`/`⇧`-click gestures, field-local `⏎`/`⌫`) stay literal glyphs. The minimal change that stays faithful: add a parallel map `COMMAND_ROW = { "One-Click Area": "oneclick", "Area": "area", … }` keyed by the existing label, and in `Table`, when a row's label is in `COMMAND_ROW`, render `chordToKeys(eff[id])` instead of the literal `combo`. Also update the `VIEW` "Open this guide" row and the `DRAW` "⏎ / double-click" row only where they correspond to `guide`/`commit`.

- [ ] **Step 3: Verify in the browser.** After a remap (Task 4), reopen the guide and confirm the remapped command shows its new keycap, and the fixed rows are unchanged.

- [ ] **Step 4: Commit** — `git commit -m "feat(shortcuts): guide footer entry + live shortcut tables"`.

---

### Task 6: `TakeoffCanvas.jsx` — the dispatch refactor + Select floor + modal mount

**Files:**
- Modify: `web/src/pages/TakeoffCanvas.jsx`

**Interfaces:**
- Consumes: `matchCommand`, `matches`, `normalizeEvent` from `../lib/keymap.ts`; `loadKeybindOverrides` from `../lib/keybindStore.js`; `ShortcutConfig` from `../components/ShortcutConfig.jsx`.
- Produces: a single merged `keydown` handler replacing the letter effect and the edit/escape effect; a `shortcutsOpen` state; the Select floor in the escape ladder.

- [ ] **Step 1: `shortcutsOpen` state + load gate.** Near `const [guideOpen, setGuideOpen] = useState(false)`, add `const [shortcutsOpen, setShortcutsOpen] = useState(false)`. In the app-startup effect that hydrates browser-global libraries (search for the existing `loadTemplates`/stamp-library hydrate pattern), add `loadKeybindOverrides()` — fire-and-forget; defaults apply until it resolves.

- [ ] **Step 2: The Select floor.** In the escape ladder (the edit effect's `else { clearPoly(); …; hlPathRef… }` final rung), arm Select **only when nothing was cleared**. Wrap the final rung so it first tests whether anything is in progress; if so, clear and return (tool unchanged); if not, `setTool("select")`. Concretely, before the final `else`, capture `const hadSomething = poly.length > 0 || ocSel || selVert != null || calib.length > 0 || check.length > 0 || selectedId || selectedMarkupId || markupDraft || proposal || armedStamp || scheduleAnchor || symbolAnchor || alignPt || zoneCheck;` and at the end of the final rung: `if (!hadSomething) setTool("select");`. Keep `agentOfferFnsRef.current?.pending()` / `ocSel` / `selVert` rungs exactly as-is (they already return without reaching the final rung).

- [ ] **Step 3: Merge the letter + edit effects into one keymap dispatch.** Replace the single-letter effect's body (after the target guard and the `?`/Enter special-cases) AND the edit/escape effect with ONE handler whose priority ladder is (spec §7):

  1. `const tg = e.target.tagName; if (tg === "INPUT" || tg === "SELECT" || tg === "TEXTAREA") return;`
  2. `if (shortcutsOpen) return;` (config modal open — suppresses everything remappable)
  3. sweep block (hoisted **above** the gallery check): copy the existing `if (sweepRef.current) { … Enter/ArrowLeft/ArrowRight/Escape with stopImmediatePropagation … }` block verbatim, but swap its `e.key === "Escape"` for `matches(e, "escape")` and its `e.key === "Enter"` for `matches(e, "commit")`. (Arrow keys stay literal — fixed.)
  4. `const cmd = matchCommand(e);` then `if (!cmd) return;` — `matchCommand` already returns `null` for modifier-only and unmatched keys, and its shift-fallback reproduces the letter handler's shift-insensitivity, so the old `metaKey||ctrlKey||altKey` early-return and the `map = { v:"select", … }` lookup are **replaced** by this one call.
  5. dispatch `cmd` through a `switch`/`if` chain that preserves each command's existing guards and behavior, mapping:
     - `guide` → `e.preventDefault(); setGuideOpen(true);`
     - `gallery` → `if (viewRef.current === "gallery") return; setView("gallery");` (note: `matchCommand` for `g` is `gallery`; keep the gallery early-return *before* acting, and note the letter handler also returned early in gallery — replicate that: `if (cmd === "gallery") { if (viewRef.current !== "gallery") setView("gallery"); return; }` and for tool/nav commands `if (viewRef.current === "gallery") return;` before switching.)
     - `focusMode` → `toggleFocusMode();`
     - tool commands (`oneclick area rect linear surface count deduct "deduct-rect" highlighter dimension check select symbol`) → `setTool(cmd)` (with `deduct-rect` mapped to `setTool("deduct-rect")`; `check`/`select`/`symbol` already take those ids; see the old `map`).
     - `curveFlip` → the existing `if (CURVABLE.has(tool) && poly.length) setCurveMode((c) => !c);`
     - `commit` → the existing Enter ladder (offer confirm → oneclick create → finish → accept all), unchanged.
     - `undo`/`redo` → the existing ⌘Z logic (`poly.length ? dropLastPoint() : shiftKey? redo : undo`) — but note `redo` is a distinct chord (`mod+shift+z`) so dispatch `undo` (no shift) and `redo` (shift) to the same body; keep `e.shiftKey` out of it and rely on the chord.
     - `copy`/`paste`/`duplicate` → the existing `if (selectedId) …` guards.
     - `escape` → the escape ladder (with the Step 2 Select floor).
     - `deleteBack` → the Backspace/Delete ladder.
  6. **Guard fidelity:** the `menuDepthRef.current > 0` early-return applies ONLY to the tool/nav/digit commands (letter class), NOT to `escape`/`commit`/`deleteBack`/`undo`/`redo`/`copy`/`paste`/`duplicate` — those keep firing with a menu open exactly as today (the edit effect had no menuDepth guard). Place the `menuDepthRef` check inside the tool/nav dispatch branch, not at the top.

  Remove the old single-letter effect's `map`/`lower`/`?`/`g`/`f`/`⇧D`/`q` handling and the old edit/escape effect's key-literal chain once the merged handler is in. Keep the **digits effect** untouched (positional, fixed) but add `if (shortcutsOpen) return;` to its guard (alongside `menuDepthRef`).

- [ ] **Step 4: The voice effect's Esc.** In the voice-hold effect (`~5734`), replace `e.key === "Escape"` with `matches(e, "escape")` (its `m` hold stays literal/fixed).

- [ ] **Step 5: Mount the modal.** Where `{guideOpen && <UserGuide … />}` renders, also pass `onOpenShortcuts={() => { setGuideOpen(false); setShortcutsOpen(true); }}`, and render `{shortcutsOpen && <ShortcutConfig onClose={() => setShortcutsOpen(false)} />}` after the guide (last in the tree, above panels/docks).

- [ ] **Step 6: Verify in the browser — the critical pass.** `npm run dev`, sample plan loaded:
  1. Every default key still works: `O A R L S C D ⇧D H K N V Y Q G F ?`, `⌘Z ⇧⌘Z ⌘C ⌘V ⌘D`, `Esc`/`Enter`/`Backspace`/`Delete`, `1–9`, Space-pan, hold-`M`.
  2. Remap `escape` to `Q` in the modal, then confirm **every** consumer follows: canvas ladder (trace → Esc-then-Q), sweep cancel, dictation discard, guide close, gallery close, menu close, navigator back. Confirm the Select floor: a stray `Q` arms Select; `Q` over a live trace clears it and stays in Area.
  3. `menuDepthRef` fidelity: with a toolbar menu open, a tool letter does nothing but `⌘Z` still undoes.
  4. With the config modal open, type letters/digits/⌘Z — nothing leaks to the canvas.
  5. `npm run check` still green (run once at the end).

- [ ] **Step 7: Commit** — `git commit -m "feat(shortcuts): keymap dispatch, Select floor, modal mount"`.

---

### Task 7: Escape consumers — `PlanNavigator.jsx` + `ToolMenu.jsx`

**Files:**
- Modify: `web/src/components/PlanNavigator.jsx`
- Modify: `web/src/components/ToolMenu.jsx`

**Interfaces:**
- Consumes: `matches` from `../lib/keymap.ts`.

- [ ] **Step 1: PlanNavigator.** In the capture-phase `onKey` (`~156`), replace `if (e.key === "Escape")` with `if (matches(e, "escape"))`. Leave the `?` exemption and the INPUT-target guard as-is.

- [ ] **Step 2: ToolMenu.** In the `open` effect's `onKey` (`~28`), replace `if (e.key === "Escape") setOpen(false)` with `if (matches(e, "escape")) setOpen(false)`.

- [ ] **Step 3: Sweep for any remaining literal Esc consumers.** Grep `web/src` for `e.key === "Escape"` / `key === "Escape"` / `"Escape"` and confirm the only remaining literal-Esc sites are: the config modal's capture-cancel (intentional, spec §9), and any already-covered fixed/field-local path. Report the list in the task report.

- [ ] **Step 4: Commit** — `git commit -m "feat(shortcuts): escape consumers resolve the live binding"`.

---

### Task 8: Docs + changelog + final check

**Files:**
- Modify: `docs/USER_GUIDE.md` (§15 — add a "Custom shortcuts" note + the Select-floor sentence)
- Modify: `CHANGELOG.md` (add an entry)
- Modify: `README.md` (if "What's in the box" lists keyboard shortcuts — check; add a one-liner only if a shortcut list exists)

- [ ] **Step 1: USER_GUIDE §15.** After the intro line of §15 ("Letter keys are suppressed while typing…"), add: a sentence that every shortcut can be rebound in **Keyboard shortcuts…** (opened from the in-app `?` guide), changes save to the browser, and the fixed keys (Space, hold `M`, hold `⇧`, `⌥`/`⇧`-click, `1`–`9`) cannot be rebound. Update the `Esc` row(s) in §15 to note it now drops to **Select** when there's nothing to back out of.

- [ ] **Step 2: CHANGELOG.** Add an entry under the current unreleased/version heading (match the file's existing format): configurable keyboard shortcuts via a new modal, Esc drops to Select, browser-global persistence.

- [ ] **Step 3: Full check + build.** `cd web && npm run check`. Expected: green (typecheck + lint + test + bench + build). Fix any failures.

- [ ] **Step 4: Commit** — `git commit -m "docs(shortcuts): guide §15, changelog"`.

---

## Self-review (run by the planner before execution handoff)

- **Spec coverage:** §3 (25 commands) → Task 2 registry. §3a (Select floor) → Task 6 Step 2. §4 (grammar/matching) → Task 1–2. §5 (persistence + load gate) → Task 3. §6 (conflict) → Task 2/4. §7 (dispatch ladder + guard fidelity + voice Esc) → Task 6. §8 (label surfaces) → Task 5. §9 (modal + a11y + reserved keys) → Task 4. §10 files → Tasks 1–8. §11 testing → Tasks 1–3 + Task 6 Step 6.
- **Placeholder scan:** no TBD/TODO/"handle edge cases". All pure code is given verbatim; integration tasks carry exact targets, guards, and the priority ladder.
- **Type consistency:** `normalizeChord`/`normalizeEvent`/`resolveKeymap`/`findConflict`/`matchCommand`/`matches`/`getOverrides`/`applyOverrides`/`setOverride`/`resetCommand`/`resetAll`/`subscribe`/`chordToKeys`/`useKeymap`/`KEYBIND_KEY`/`loadKeybindOverrides`/`saveKeybindOverrides`/`clearKeybindOverrides` are named identically across Tasks 1–7 and match the spec §10.
- **Plan-vs-spec delta (ruled):** the spec §10 lists a `keys.ts` modification for new glyphs; the plan instead keeps `chordToKeys` self-contained in `keymap.ts` (it needs the `mod`→`⌘`/`Ctrl` token keys.ts doesn't carry), so `keys.ts` is NOT modified. No behavior difference.
