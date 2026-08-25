# Task 5 report — UserGuide footer + live shortcut tables

## Status
Complete. `npm run check` passes.

## Changes (`web/src/components/UserGuide.jsx`)

1. **Footer entry point** — Added optional `onOpenShortcuts` prop. When provided, footer shows a right-aligned “Want to change a key?” line and a mono cobalt-bordered “Keyboard shortcuts…” button (no radius) that calls `onOpenShortcuts()` then `onClose()`.

2. **Live shortcut tables** — Added `COMMAND_ROW` map (description text → command id). `UserGuide` calls `useKeymap()` once and passes the effective map to `Table`. Command-backed rows render chords via `chordToKeys` (multiple chords joined with “or”, matching `ShortcutConfig`). Fixed rows keep literal glyph arrays.

3. **Esc dismiss** — Guide close listener uses `matches(e, "escape")` instead of `e.key === "Escape"`.

## Row wiring

**Command-backed (live keymap):** oneclick, area, rect, linear, curveFlip, surface, count, deduct, deduct-rect, highlighter, check, dimension, select, gallery, commit, deleteBack, undo, redo, escape, copy, paste, duplicate, focusMode, guide.

**Fixed (literal glyphs):** Arm condition N (1–9), hold M (dictation), hold ⇧ (angle lock), ⌥/⇧ click gestures, scroll / two-finger / ⇧ scroll / hold Space (navigation gestures).

## Verification
- `npm run check` — green (typecheck, lint, tests, bench, build).
