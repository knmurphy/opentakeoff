# Task 4 — ShortcutConfig.jsx

## Status
Complete.

## Deliverable
- `web/src/components/ShortcutConfig.jsx` — keyboard-shortcut config modal with capture, conflict detection, per-row reset, restore-all, search filter, a11y (dialog, focus trap, focus on mount), and load gate.

## Implementation notes
- Rows subscribe to `keymap.subscribe()` for `isKeymapLoaded()` because `useKeymap()` snapshot is keyed only on overrides JSON — an empty first load would not re-render otherwise.
- Close uses `matches(e, "escape")` (capture phase); capture-cancel uses physical Esc/Backspace only while rebinding.

## Browser verification (`/shortcut-smoke` temporary route, reverted)
- 25 commands render in Tools → Navigation → Edit → Escape hatch order.
- Row click / Tab+Enter enters capture ("Press keys…" + caret).
- Rebinding Area to ⇧P updates keycap and shows reset; ⇧D on Highlighter shows conflict banner naming Deduct rectangle.
- Per-row reset and Restore all defaults restore default keycaps.
- Screenshot: `.superpowers/sdd/task-4-modal.webp`

## Commit
`feat(shortcuts): config modal (capture, conflict, reset)`

## Fix round 1 (review)
- **Nested buttons:** each row is now a `<div>` with sibling `<button>`s — main row control (label + keycaps/capture) and a separate `reset` button when overridden.
- **Capture + search:** `onFocus={cancelCapture}` on the search input; `handleReset` calls `cancelCapture()` before resetting.
- Re-smoke-tested at `/shortcut-smoke`: Tab order is row main → reset; Enter on reset restores default; clicking search mid-capture cancels capture and allows typing.
- Commit: `fix(shortcuts): valid row buttons + cancel capture on search focus`
