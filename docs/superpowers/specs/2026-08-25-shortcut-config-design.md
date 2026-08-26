# Configurable Keyboard Shortcuts — Design

**Date:** 2026-08-25
**Branch:** `feat/shortcut-config`
**Mockup:** [`shortcut-config-mockup.html`](shortcut-config-mockup.html) (open in a browser)

## 1. Problem

Every shortcut in OpenTakeoff is hardcoded across ~5 separate `window.addEventListener("keydown")` handlers in `TakeoffCanvas.jsx`, with the *labels* already living as data in `canvasConstants.js` (`MEASURE_TOOLS`/`CUT_TOOLS`/`MARKUP_TOOLS` carry `shortcut` fields). There is no way for an estimator to change a binding. The motivating example from the product owner: estimators carry muscle memory where **Esc** drops back toward Select; in OpenTakeoff Esc already does "back out one level" (and it takes two presses to unwind deeply), but it is *not remappable* — and the owner's constraint is that remapping Esc must never "break the app." Two asks are bundled: (1) make bindings remappable, and (2) make Esc land on the Select tool (§3a).

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

## 3a. The Select floor — Esc lands on the Select tool

The owner's motivating need is not only *remapping* Esc but what Esc *does*: estimators expect Esc to drop them back toward Select. Under the command model this is an isolated change to the `escape` command's canvas handler.

**Decision: keep the ladder; arm Select only on a truly stray Esc.** The `escape` command's canvas handler retains its existing rung order — dismiss a pending agent offer → clear the One-Click selection → clear the picked vertex → clear everything else (trace, calibration, check, selection, markup draft, proposal, armed stamp, zone). The refinement over the first draft: the final "clear everything" rung arms the Select tool **only when there was nothing to clear** (a genuinely stray Esc). If the rung actually cleared something, the tool stays armed.

Why: the first draft armed Select whenever Esc reached the final rung, but that rung is *also* where a live trace is cleared — so one Esc would both discard a mis-clicked trace **and** bounce the estimator off their tool. That breaks the "clear and continue" loop (Count, One-Click, trace→retrace) that depends on Esc clearing a bad gesture and staying put. Point-by-point backout is `⌫`'s job; Esc's job is "back out one level, and when there's nothing left, land on Select."

Net effect:

- Truly stray Esc (nothing in progress) → arms Select, one press.
- Esc over a live trace → clears the trace, **stays in the current tool** (clear-and-continue preserved; matches today).
- Esc over a One-Click selection or a picked vertex → clears that level, stays put; one more Esc reaches the floor.
- Esc over a selected shape / markup / calibration / check / armed stamp / zone → clears it, stays in the current tool.

The rejected alternative — Esc clears everything *and* selects unconditionally — conflates "cancel a gesture" with "switch tools" and strands the estimator mid-loop; the other rejected reading (arm Select even when a trace was cleared) has the same flaw for traces specifically.

Safety properties:

1. **Isolated to the canvas `escape` handler.** The other consumers of the `escape` trigger — sweep cancel, guide close, gallery close, menu close, navigator back, dictation discard — keep their own behavior and do NOT switch tools. A command determines *which key fires*; each handler keyed to it determines *what that key does* in its own context.
2. **Composes with remapping.** Whatever key is bound to `escape` inherits this behavior.

## 4. Chord grammar (the pure contract)

A canonical chord string has a fixed modifier order and a lowercase key token:

```
chord := (mod|shift|alt) ("+" (mod|shift|alt))* "+" key | key
```

- `mod` is the **primary modifier** — `⌘` on macOS (`metaKey`), `Ctrl` on Windows/Linux (`ctrlKey`). Both normalize to `mod`, exactly as today's handlers test `e.metaKey || e.ctrlKey` together. This is the same platform-independence `lib/keys.ts` already encodes for *labels*; here it is applied to *behavior*.
- `shift` = `shiftKey`, `alt` = `altKey`.
- Key token: single letters lowercase (`d`, `z`), digits as-is (`1`), named keys lowercase (`escape`, `enter`, `backspace`, `delete`, `space`, arrow keys, F-keys), punctuation as-is (`?`). `?` is the one punctuation key whose physical `shiftKey` varies by keyboard layout (shift+`/` on US, unshifted elsewhere) — see the matching rule below.
- **Modifier-only presses are not chords** — a chord requires a non-modifier key.
- `normalizeEvent(e)` derives the canonical string from a `KeyboardEvent`-shaped object; `normalizeChord(str)` parses a stored string. Both must agree on one canonical form (the storage form and the runtime form are identical).
- `normalizeEvent` reads `e.key` (the *character* — `"?"` for the shifted `/` key), never `e.code` (`"Slash"`), exactly as today's `e.key === "?"` does. This is what keeps `?` layout-independent.

**Matching** is a two-step lookup over the effective keymap:

1. **Exact match** — normalize the event to its canonical chord and look it up.
2. **Shift-insensitive fallback** — if nothing is bound to that chord and its only modifier is `shift`, drop the shift and look up again.

This reproduces today's behavior exactly: `⇧D` resolves to `shift+d` (deduct-rect) at step 1, while `⇧A` misses step 1 (no `shift+a` binding) and falls back to `a` (area) at step 2; `⇧⌘Z` → `mod+shift+z` (redo); and the `?` key — physically shift+`/` on US layouts, unshifted elsewhere — reaches `guide` via the fallback regardless. A user who binds a command to `shift+a` makes `⇧A` resolve to *that* command (exact match wins). `mod` and `alt` are always exact — there is no fallback that drops them, mirroring today's `metaKey || ctrlKey || altKey` early-return.

Display (in the modal, guide tables, tool labels) reuses `lib/keys.ts` vocabulary: `mod`→`⌘`/`Ctrl`, `shift`→`⇧`/`Shift`, `alt`→`⌥`/`Alt`, `escape`→`Esc`, `enter`→`⏎`/`Enter`, `backspace`→`⌫`/`Backspace`, `delete`→`Delete`. `keys.ts` today lacks `Esc`/`Delete`/`Space`/`mod` glyph entries; the plan adds them (a superset, not a re-theme).

## 5. Keymap resolution and persistence

- `DEFAULT_KEYMAP`: a frozen command registry — id → `{ label, category, default }`.
- **Overrides** are stored **browser-globally** (an app setting, not project data — same rationale and store mechanism as condition templates, materials, and stamps): a `metaPut` under a `KEYBIND_KEY`, value shape `{ [commandId]: chord }` containing *only* non-default bindings. No IndexedDB version bump.
- `resolveKeymap(overrides)` = defaults spread, overrides applied. This is the **effective** keymap.
- Overrides load asynchronously on startup; until they resolve, defaults apply (correct: the default keymap is always safe). **Load-complete gate:** the config modal does not accept edits until the initial load has resolved and its overrides are merged into the live keymap — so a save issued during startup can never be stomped by a later-resolving IndexedDB read. Post-load saves are fire-and-forget but always write the *merged* override map, never a partial one.
- **Conflict is computed against the effective map**, not defaults: if `area` is currently rebound to `x`, binding `rect` to `a` (area's *default*) is *not* a conflict.

## 6. Conflict policy — reject, never steal (v1)

Assigning a chord that the effective map already assigns to another command is **rejected**: an inline banner names the conflicting command and the capture stays active so the user types a different key or cancels. Rebinding a command to its own current chord is a no-op (not a conflict). There is **no** "steal/unbind" in v1 — it would introduce an *unbound command* state that every downstream consumer must handle. The cost (swapping two keys takes a two-step dance through a free key) is accepted and recorded here.

## 7. The dispatch refactor

Today the key consumers are:

- `TakeoffCanvas.jsx` single-letter tool effect (`~2575`) — the `map = { v: "select", … }`, `?`, `g`, `f`, `⇧D`, Enter, sweep Escape/Enter/arrows.
- `TakeoffCanvas.jsx` delete/escape/edit effect (`~2678`) — Backspace/Delete ladder, Esc ladder, `⌘Z`/`⌘C`/`⌘V`/`⌘D`.
- `TakeoffCanvas.jsx` digits effect (`~2664`) — **fixed**, positional.
- `TakeoffCanvas.jsx` Space (`~2568`) — **fixed** hold.
- `TakeoffCanvas.jsx` voice-hold effect (`~5734`) — `M` hold (**fixed**) *plus* its own `Escape` test that discards a live dictation (an **`escape` consumer**).
- `UserGuide.jsx` — its own Escape (self-close).
- `PlanNavigator.jsx` — Escape → `back()`.
- Gallery / `ToolMenu` — Escape closes.

The refactor replaces the hardcoded key tests with a **single matcher over the live keymap**: `matches(e, commandId)` (synchronous, reads the live keymap at call time) and `matchCommand(e)` (commandId | null).

The single-letter effect and the `⌘`-chord effect **merge** into one dispatch. But the merge must preserve the code's existing *context* — the two effects are split today because they carry different guards and different runtime state. The merged handler is an explicit **priority ladder**, top to bottom:

1. **Target guard** — `INPUT`/`SELECT`/`TEXTAREA` returns early (field-local typing is never a command).
2. **Overlay guard** — `shortcutsOpen` (config modal open) suppresses every remappable command; `menuDepthRef > 0` suppresses letter/digit commands exactly as today.
3. **Sweep overlay** — while a sweep is open, its Enter/Escape/arrows are handled here with `stopImmediatePropagation()` **before** the gallery early-return (today the sweep checks sit *after* `if (viewRef.current === "gallery") return` at ~2601, which would swallow sweep keys under an open gallery; the merged handler hoists sweep above the gallery check).
4. **Gallery early-return** — in gallery view, letter/digit commands do not fire (preserved).
5. **Chord match** — `matchCommand(e)` against the live keymap.
6. **Per-command contextual handler** — each command's handler keeps its existing runtime guards (`commit` only accepts agent proposals when nothing mid-draw; `undo` pops the last point mid-trace vs. undoing otherwise; `curveFlip` only mid-trace on a bendable tool; `copy`/`paste`/`duplicate` only with a selection). The keymap resolves *which command*; the command's handler still decides *whether* in this state.

**Guard fidelity:** today the letter effect pauses on `menuDepthRef` but the edit/escape effect does **not** (⌘Z/Backspace/Esc still fire with a toolbar menu open). The merged handler preserves this asymmetry rather than silently unifying it — the plan must list, per command, which guards bind it, copied from the code being replaced.

The `escape` command's *handler* is unchanged — it still runs the ladder; only its trigger is looked up, and every `escape` consumer (ladder, sweep cancel, dictation discard, guide close, gallery close, menu close, navigator back) resolves the binding through the same keymap.

The **live keymap** is a module-level binding (mirroring the existing `export let store` live-binding pattern in `store.js`): dispatch paths read it synchronously, the config modal and label surfaces subscribe to it.

## 8. Label surfaces stay true

A remapped binding must be reflected everywhere a shortcut is shown, or the app lies to the user:

- `UserGuide.jsx` tables (`TOOLS`/`DRAW`/`VIEW`) — command-backed rows read the effective binding; **fixed rows** (hold-`M`, `1`–`9`, Space, the `⌥`/`⇧`-click gestures, field-local `⏎`/`⌫`) render as static literals — they are not commands and never change.
- `ToolMenu.jsx` shortcut labels and `railTile` badges in `TakeoffCanvas.jsx` — derive from the keymap by tool id (tool id ⇄ command id is 1:1 for the tool commands).
- `canvasConstants.js` `shortcut` fields become the *default* source; live display reads the keymap.

Toolbar/tooltip copy that mentions a key inline (e.g. "Copied — ⌘V pastes…") is out of scope for v1 and remains the default text; only the *keycap/label* surfaces listed above read the live keymap.

## 9. The config modal

Reached from a **"Keyboard shortcuts…"** button in the `UserGuide` footer. One modal matching existing panel chrome (square corners, `--shadow-2`, `--paper-bright`, cobalt accent), reusing the existing `Kbd` keycap component **as-is** (its 5px radius ships today; do not re-theme it here).

1. Header + close (`×`); `Esc` closes (capture-phase, like `UserGuide`). `role="dialog"`, `aria-modal="true"`, `aria-label`, focus moved into the modal on open, and a focus trap while open — this is a *keyboard* editor, so it must be fully keyboard-operable.
2. Search/filter field (mono).
3. Grouped command list (Tools / Navigation / Edit / Escape hatch). Each row is a real control — a native `<button>` (or `role="button"` + `tabindex="0"` + Enter/Space activation), never a bare `div` — so a keyboard user can Tab to a row and press Enter to capture. Label left, keycap(s) right.
4. **Click (or Enter on) a row → capture mode.** The modal installs a capture-phase `keydown` that swallows keys (`preventDefault` + `stopPropagation`) so the canvas never reacts. It ignores incomplete chords (modifier held with no key yet) and applies the first complete chord. **Capture cancels on physical `Esc`/`Backspace`, and on blur / click-outside** (focus loss cancels the capture).
5. **Conflict** → inline danger banner naming the conflicting command; capture stays active.
6. A binding that differs from its default shows a **reset** affordance; **Restore all defaults** clears every override (deletes the stored key).
7. While the modal (or capture) is open, **every** remappable command is suppressed — not just single letters: the `shortcutsOpen` guard gates the letter effect *and* the edit/escape effect *and* the digits effect, so ⌘Z/Backspace/Delete/`1`–`9` cannot leak through to the canvas when focus is not inside a field.

Changes apply immediately and persist to this browser.

**v1 limitation (documented):** capture cancels on physical `Esc`/`Backspace`, so those two keys cannot be *assigned* as a new binding through the modal. `Enter` and `Delete` are **assignable** once `commit`/`deleteBack` are rebound away — while those commands still hold them, reject-not-steal blocks the assignment (the effective map still owns them). Rebinding the `escape`/`commit`/`deleteBack` commands *away* from their defaults works normally (click the row, type the new chord).

## 10. Architecture / files

| File | Responsibility |
|---|---|
| `web/src/lib/keymap.ts` (new) | Pure: registry + `normalizeChord`/`normalizeEvent`, `resolveKeymap`, `findConflict`, `matches`, `matchCommand`. Live keymap binding + `subscribe`. |
| `web/src/lib/keybindStore.js` (new) | `metaPut`/load/save/reset of overrides under `KEYBIND_KEY` (browser-global). |
| `web/src/lib/useKeymap.js` (new, or a hook in `keymap.ts`) | `useSyncExternalStore` wrapper so React surfaces re-render on override change. |
| `web/src/components/ShortcutConfig.jsx` (new) | The modal + capture/conflict/reset UI. |
| `web/src/components/UserGuide.jsx` (modify) | Footer button; tables read effective bindings (command rows dynamic, fixed rows literal). |
| `web/src/components/PlanNavigator.jsx`, gallery, `ToolMenu.jsx` (modify) | Escape consumers read `escape` binding. |
| `web/test/keymap.test.ts` (new) | TDD over the pure layer. |
| `docs/USER_GUIDE.md` §15, `CHANGELOG.md` | Document the feature + the remap note + the Select floor. |

## 11. Testing

TDD over `keymap.ts` (pure, no DOM — `KeyboardEvent` is simulated with a plain object, mirroring how `keys.ts` takes `navigator` as an argument):

- `normalizeChord`/`normalizeEvent`: lowercase letters; canonical modifier order; `mod` = meta *or* ctrl; named keys lowercase; `?`/digits as-is; rejects modifier-only; reads `e.key` not `e.code`.
- `resolveKeymap`: default map, override wins, override == default is idempotent.
- `findConflict`: collision detected; self-chord ignored; computed against the *effective* map (an overridden-away default is not a conflict).
- `matches`/`matchCommand`: `mod+z` matches both `metaKey` and `ctrlKey`; `shift+d` ≠ `d`; letter case-insensitive; `?` matches via the shift-fallback.

The modal and the handler swap are verified in the running app (Vite): load the sample plan, remap a tool key, press it; remap `escape`, confirm every Esc consumer (ladder, sweep cancel, dictation discard, guide close, gallery close) follows; confirm the Select floor arms Select only on a stray Esc and stays put when Esc clears a trace/selection; restore defaults.

## 12. Non-goals (YAGNI)

- No multi-key *sequences* (chord state machine + timeout) — single chord confirmed by the owner.
- No per-command "unbound"/steal state (see §6); no one-click swap (the 3-step dance is accepted for v1).
- No multi-binding *editor* (a command holds one chord after remap; `deleteBack`'s pair is only a default).
- No remapping of holds, pointer gestures, or positional digits (see §3).
- No per-project or per-user (cloud) keymap — browser-global only.
- No assigning *to* `Esc`/`Backspace` (capture cancels on them, §9). `Enter`/`Delete` become assignable once `commit`/`deleteBack` move off them.
- No inline prose copy re-derivation (toast strings keep default key text).
