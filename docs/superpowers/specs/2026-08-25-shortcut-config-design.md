# Configurable Keyboard Shortcuts — Design

**Date:** 2026-08-25
**Branch:** `feat/shortcut-config`
**Mockup:** [`shortcut-config-mockup.html`](shortcut-config-mockup.html) (open in a browser)

## 1. Problem

Every shortcut in OpenTakeoff is hardcoded across ~5 separate `window.addEventListener("keydown")` handlers in `TakeoffCanvas.jsx`, with the *labels* already living as data in `canvasConstants.js` (`MEASURE_TOOLS`/`CUT_TOOLS`/`MARKUP_TOOLS` carry `shortcut` fields). There is no way for an estimator to change a binding. The motivating example from the product owner: estimators carry muscle memory where **Esc** drops back toward Select; in OpenTakeoff Esc already does "back out one level" (and it takes two presses to unwind deeply), but it is *not remappable* — and the owner's constraint is that remapping Esc must never "break the app."

## 2. The core idea: a command model

Every remappable shortcut becomes a **named command**. A **binding** is one **chord** (one non-modifier key plus any combination of modifiers). The handlers stop testing `e.key === "x"` and instead resolve *which command* the event fires, against a **live keymap**. Rebinding a command changes the trigger key everywhere at once; the command's behavior (its handler) is untouched. This is the answer to "remap Esc without breaking it": the "back out one level" ladder *is* the `escape` command's handler, keyed by command id, never by key literal.

## 3. Scope — what is remappable, what is not

**Remappable (25 commands):** discrete keypress/chord commands only.

| Category | Command id | Default chord |
|---|---|---|
| Tools | `oneclick` | `o` |
| | `area` | `a` |
| | `rect` | `r` |
| | `linear` | `l` |
| | `surface` | `s` |
| | `count` | `c` |
| | `deduct` | `d` |
| | `deduct-rect` | `shift+d` |
| | `highlighter` | `h` |
| | `dimension` | `n` |
| | `check` | `k` |
| | `select` | `v` |
| | `symbol` | `y` |
| | `curveFlip` | `q` |
| Navigation | `gallery` | `g` |
| | `focusMode` | `f` |
| | `guide` | `?` |
| Edit | `undo` | `mod+z` |
| | `redo` | `mod+shift+z` |
| | `copy` | `mod+c` |
| | `paste` | `mod+v` |
| | `duplicate` | `mod+d` |
| Escape hatch | `escape` | `escape` |
| | `commit` | `enter` |
| | `deleteBack` | `["backspace", "delete"]` |

`deleteBack` is the **one** command whose default binding is a *pair* (Backspace and Delete already fire the same ladder at `TakeoffCanvas.jsx:2685`). Its default is a two-element list; a remap replaces it with a single chord. No other command has a multi-binding.

`commit` and `escape` are the **global** Enter/Esc only. Enter inside an `INPUT`/`TEXTAREA` field (calibration apply, check grade, revision name, inline markup editor, the agent goal box's `⌘⏎`) is field-local submission and stays fixed; the sweep's arrow-key navigation also stays fixed. Only the key a command is *bound to* changes — never the command's semantics.

**Fixed — not commands, not in the modal:** Space (hold-pan), hold-`M` (dictation), hold-`⇧` (angle lock), `⌥`-click and `⇧`-click (pointer gestures), digits `1`–`9` (positional condition palette), and scroll/zoom/pan gestures. The modal footer states this.

## 4. Chord grammar (the pure contract)

A canonical chord string has a fixed modifier order and a lowercase key token:

```
chord := (mod|shift|alt) ("+" (mod|shift|alt))* "+" key | key
```

- `mod` is the **primary modifier** — `⌘` on macOS (`metaKey`), `Ctrl` on Windows/Linux (`ctrlKey`). Both normalize to `mod`, exactly as today's handlers test `e.metaKey || e.ctrlKey` together. This is the same platform-independence `lib/keys.ts` already encodes for *labels*; here it is applied to *behavior*.
- `shift` = `shiftKey`, `alt` = `altKey`.
- Key token: single letters lowercase (`d`, `z`), digits as-is (`1`), named keys lowercase (`escape`, `enter`, `backspace`, `delete`, `space`, arrow keys, F-keys), punctuation as-is (`?`).
- **Modifier-only presses are not chords** — a chord requires a non-modifier key.
- `normalizeEvent(e)` derives the canonical string from a `KeyboardEvent`-shaped object; `normalizeChord(str)` parses a stored string. Both must agree on one canonical form (the storage form and the runtime form are identical).

Display (in the modal, guide tables, tool labels) reuses `lib/keys.ts` vocabulary: `mod`→`⌘`/`Ctrl`, `shift`→`⇧`/`Shift`, `alt`→`⌥`/`Alt`, `escape`→`Esc`, `enter`→`⏎`/`Enter`, `backspace`→`⌫`/`Backspace`, `delete`→`Delete`.

## 5. Keymap resolution and persistence

- `DEFAULT_KEYMAP`: a frozen command registry — id → `{ label, category, default }`.
- **Overrides** are stored **browser-globally** (an app setting, not project data — same rationale and store mechanism as condition templates, materials, and stamps): a `metaPut` under a `KEYBIND_KEY`, value shape `{ [commandId]: chord }` containing *only* non-default bindings. No IndexedDB version bump.
- `resolveKeymap(overrides)` = defaults spread, overrides applied. This is the **effective** keymap.
- Overrides load asynchronously on startup; until they resolve, defaults apply (correct: the default keymap is always safe). Save is fire-and-forget on each set/reset.
- **Conflict is computed against the effective map**, not defaults: if `area` is currently rebound to `x`, binding `rect` to `a` (area's *default*) is *not* a conflict.

## 6. Conflict policy — reject, never steal (v1)

Assigning a chord that the effective map already assigns to another command is **rejected**: an inline banner names the conflicting command and the capture stays active so the user types a different key or cancels. Rebinding a command to its own current chord is a no-op (not a conflict). There is **no** "steal/unbind" in v1 — it would introduce an *unbound command* state that every downstream consumer must handle. The cost (swapping two keys takes a two-step dance through a free key) is accepted and recorded here.

## 7. The dispatch refactor

Today the key consumers are:

- `TakeoffCanvas.jsx` single-letter tool effect (`~2575`) — the `map = { v: "select", … }`, `?`, `g`, `f`, `⇧D`, Enter, sweep Escape/Enter/arrows.
- `TakeoffCanvas.jsx` delete/escape/edit effect (`~2678`) — Backspace/Delete ladder, Esc ladder, `⌘Z`/`⌘C`/`⌘V`/`⌘D`.
- `TakeoffCanvas.jsx` digits effect (`~2664`) — **fixed**, positional.
- `TakeoffCanvas.jsx` Space (`~2568`) and `M` (`~5734`) — **fixed** holds.
- `UserGuide.jsx` — its own Escape (self-close).
- `PlanNavigator.jsx` — Escape → `back()`.
- Gallery / `ToolMenu` — Escape closes.

The refactor replaces the hardcoded key tests with a **single matcher over the live keymap**:

- `matches(e, commandId): boolean` — synchronous, reads the live keymap at call time (no listener re-registration on override change).
- `matchCommand(e): commandId | null` — for a dispatch table.

Each consumer swaps its key literal for a command id: the single-letter effect and the `⌘`-chord effect **merge** into one dispatch (the existing code splits them; the keymap unifies them — `mod+z` is a chord, `z` alone would be a different chord, and the letter handler's current `metaKey||ctrlKey` early-return is exactly what the chord grammar encodes). The `escape` command's *handler* is unchanged — it still runs the "back out one level" ladder; only its trigger is looked up.

The **live keymap** is a module-level binding (mirroring the existing `export let store` live-binding pattern in `store.js`): dispatch paths read it synchronously, the config modal and label surfaces subscribe to it.

## 8. Label surfaces stay true

A remapped binding must be reflected everywhere a shortcut is shown, or the app lies to the user:

- `UserGuide.jsx` tables (`TOOLS`/`DRAW`/`VIEW`) — render the effective binding.
- `ToolMenu.jsx` shortcut labels and `railTile` badges in `TakeoffCanvas.jsx` — derive from the keymap by tool id (tool id ⇄ command id is 1:1 for the tool commands).
- `canvasConstants.js` `shortcut` fields become the *default* source; live display reads the keymap.

Toolbar/tooltip copy that mentions a key inline (e.g. "Copied — ⌘V pastes…") is out of scope for v1 and remains the default text; only the *keycap/label* surfaces listed above read the live keymap.

## 9. The config modal

Reached from a **"Keyboard shortcuts…"** button in the `UserGuide` footer. One modal, matching existing panel chrome (square corners, `--shadow-2`, `--paper-bright`, cobalt accent, `--r-1` keycaps per the existing `Kbd`):

1. Header + close (`×`), `Esc` closes (capture-phase, like `UserGuide`).
2. Search/filter field (mono).
3. Grouped command list (Tools / Navigation / Edit / Escape hatch) — label left, keycap(s) right.
4. **Click a row → capture mode.** The modal installs a capture-phase `keydown` that swallows keys (`preventDefault` + `stopPropagation`) so the canvas never reacts. It ignores incomplete chords (modifier held with no key yet), applies the first complete chord, and cancels on `Esc`/`Backspace`.
5. **Conflict** → inline danger banner naming the conflicting command; capture stays active.
6. A binding that differs from its default shows a **reset** affordance; **Restore all defaults** clears every override (deletes the stored key).
7. While the modal (or capture) is open, the canvas single-letter shortcuts are paused (the `menuDepthRef`-style guard, extended to a `shortcutsOpen` state).

Changes apply immediately and persist to this browser.

## 10. Architecture / files

| File | Responsibility |
|---|---|
| `web/src/lib/keymap.ts` (new) | Pure: registry + `normalizeChord`/`normalizeEvent`, `resolveKeymap`, `findConflict`, `matches`, `matchCommand`. Live keymap binding + `subscribe`. |
| `web/src/lib/keybindStore.js` (new) | `metaPut`/load/save/reset of overrides under `KEYBIND_KEY` (browser-global). |
| `web/src/lib/useKeymap.js` (new, or a hook in `keymap.ts`) | `useSyncExternalStore` wrapper so React surfaces re-render on override change. |
| `web/src/components/ShortcutConfig.jsx` (new) | The modal + capture/conflict/reset UI. |
| `web/src/components/UserGuide.jsx` (modify) | Footer button; tables read effective bindings. |
| `web/src/pages/TakeoffCanvas.jsx` (modify) | Merge letter+edit effects into keymap dispatch; swap key literals for `matches`/`matchCommand`; `shortcutsOpen` state + render modal. |
| `web/src/components/PlanNavigator.jsx`, gallery, `ToolMenu.jsx` (modify) | Escape consumers read `escape` binding. |
| `web/test/keymap.test.ts` (new) | TDD over the pure layer. |
| `docs/USER_GUIDE.md` §15, `CHANGELOG.md` | Document the feature + the remap note. |

## 11. Testing

TDD over `keymap.ts` (pure, no DOM — `KeyboardEvent` is simulated with a plain object, mirroring how `keys.ts` takes `navigator` as an argument):

- `normalizeChord`/`normalizeEvent`: lowercase letters; canonical modifier order; `mod` = meta *or* ctrl; named keys lowercase; `?`/digits as-is; rejects modifier-only.
- `resolveKeymap`: default map, override wins, override == default is idempotent.
- `findConflict`: collision detected; self-chord ignored; computed against the *effective* map (an overridden-away default is not a conflict).
- `matches`/`matchCommand`: `mod+z` matches both `metaKey` and `ctrlKey`; `shift+d` ≠ `d`; letter case-insensitive.

The modal and the handler swap are verified in the running app (Vite): load the sample plan, remap a tool key, press it; remap `escape`, confirm every Esc consumer (ladder, sweep cancel, guide close, gallery close) follows; restore defaults.

## 12. Non-goals (YAGNI)

- No multi-key *sequences* (chord state machine + timeout) — single chord confirmed by the owner.
- No per-command "unbound"/steal state (see §6).
- No multi-binding *editor* (a command holds one chord after remap; `deleteBack`'s pair is only a default).
- No remapping of holds, pointer gestures, or positional digits (see §3).
- No per-project or per-user (cloud) keymap — browser-global only.
- No inline prose copy re-derivation (toast strings keep default key text).
