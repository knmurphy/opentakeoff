# Task 6 report — keymap dispatch, Select floor, modal mount

## What was merged

- **Imports:** `matchCommand`, `matches`, `chordToKeys`, `loadKeybindOverrides`, `useKeymap`, `ShortcutConfig`.
- **State:** `shortcutsOpen`; `useKeymap()` + `shortcutLabel()` for live labels.
- **Startup:** `void loadKeybindOverrides()` in the templates-hydrate mount effect (fire-and-forget).
- **Handlers:** Removed the separate single-letter and edit/escape `keydown` effects; replaced with one remappable dispatch ladder:
  1. INPUT/SELECT/TEXTAREA guard
  2. `shortcutsOpen` guard (all remappable commands)
  3. Symbol-sweep block (hoisted; `matches` for `commit`/`escape`; arrows literal)
  4. `matchCommand(e)` — replaces meta/ctrl/alt early-return and letter `map`
  5. Per-command dispatch with original guards (`menuDepthRef` only on tool/nav; edit/escape hatch always fire)
- **Select floor:** Final escape rung captures `hadSomething` over every field the rung clears (`poly`, `calib`, `check`, `checkStated`, `scaleGuide`, selections, drafts, anchors, `zoneCheck`, `hlRef.current`); `setTool("select")` only when `!hadSomething`.
- **Digits effect:** Added `shortcutsOpen` guard (unchanged otherwise).
- **Voice hold:** `matches(e, "escape")` for mid-hold discard (`m` hold stays literal).
- **UI:** `UserGuide` `onOpenShortcuts`; `ShortcutConfig` mounted after guide.
- **Labels:** `railTile` and command-backed menu rows use `shortcutLabel` + `chordToKeys`.

## Select-floor behavior

| Situation | Result |
|-----------|--------|
| Stray Esc/P (remapped escape) with nothing in progress | Arms **Select** |
| Esc/P while Area trace has points | Clears trace; **stays on Area** |
| Esc dismisses offer / ocSel / selVert rungs | Same as before (no Select floor on those rungs) |

## Browser verification (`npm run dev`, sample plan, http://localhost:5175/)

| Check | Result |
|-------|--------|
| `?` opens guide | Pass |
| Default `a` arms Area | Pass |
| Remap `escape` → `p` in modal; modal closes on `p` | Pass |
| Stray `p` arms Select | Pass |
| Area trace + `p` clears trace, Area stays armed | Pass |
| Config modal open: `a` does not arm Area | Pass |
| `⌘Z` dispatches without error | Pass |

**Note:** Remapping escape to `Q` conflicts with default `curveFlip` (`q`) — modal shows conflict; tested with `p` instead.

**Not automated in browser:** toolbar `menuDepthRef` (letter blocked, `⌘Z` still works), full matrix of default keys (`O A R L …`), hold-M voice, digits 1–9, Space-pan.

## `npm run check`

Green after changes (typecheck, lint warning only on unrelated eslint-disable elsewhere).
