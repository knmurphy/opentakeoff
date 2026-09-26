# Plan — rebase `feat/shortcut-config` onto `origin/main` (2026-09-25, rev 3)

Rev 3 folds round-2 review (SemMerge NITS-ONLY, ProcGit NITS-ONLY, TestRigor2
one major): the 7a2200d §15 resolution rule, plus nits — npm ci, phantom audit
item pruned, git-status wording, red-claim scoping, D2 escape-regression
scenario in T5.5. Rev 2 incorporated round 1 (SemMerge, ProcGit, TestRigor):
One-Click gate restore (blocker), live-table/COMMAND_ROW gap, 25-command
invariant, node_modules bootstrap, run-the-app verification, per-commit test
runs, consumer-side test cases, comment-restoration ownership, lease SHA pin,
.gitignore friction. Every round-1/round-2 blocker and major is addressed
below; nothing was declined.

## Context

`feat/shortcut-config` (18 commits, +2099/−124 over 16 files) turns the canvas's
fixed single-letter shortcuts into a user-configurable keymap: chord grammar +
command registry (`web/src/lib/keymap.ts`, pure), browser-global persistence
(`keybindStore.js`), a reactive hook (`useKeymap.js`), a config modal
(`ShortcutConfig.jsx`), live shortcut tables in the guide, and spec/plan docs.

`origin/main` moved 90 commits ahead. Merge-sim flags 4 conflicted files; the
live rebase confirms conflicts start at commit 13/18 (`4b5496e`). Main gained
features the branch predates; text resolution alone silently drops them (two
already observed in the paused worktree).

Branch state at writing: rebase paused at 13/18; `4b5496e`'s four marker blocks
resolved at marker level; no semantic edits applied. Worktree has NO
node_modules (root or web/) — bootstrap required before any test run
(T0). Untracked files (this plan) survive `rebase --continue` untouched.

## What main gained that must survive the rebase

1. **T — repeat/trace another** (`lib/repeatTool.js`, `repeatPlan`): from
   Select, `T` re-arms the selected shape's condition + drawing tool. Lives in
   the OLD letter-map handler the branch deletes → ported into the keymap (D1).
2. **One-Click keyboard gate**: `if (t === "oneclick" && !oneClickEnabled())
   { setCommitMsg(ONE_CLICK_GATE_MESSAGE); return; }` sat in the same deleted
   region. Gate is ON by default (`lib/gate.js` names the `O` shortcut a closed
   path). The branch's unified dispatch has NO gate — without restoration, `o`
   becomes the only ungated arming surface (rail tile and command row filter
   it; the keypress would silently arm a hidden tool instead of refusing with
   the message). Restored in D1.
3. **Image annotation placement state**: `imageAnchor`, `placingImageId`,
   `placeGrabRef`, `placeCrossSheetRef` belong in Escape's reset cascade AND
   `hadSomething` (without the latter, Escape during an image-capture marquee
   drops the armed tool via the Select floor — a regression main never had).
   The auto-merge dropped both; restored per D2.
4. **ToolMenu additions**: "Request Premium" + "Premium layout" items ahead of
   the guide item.
5. **Comments documenting precedence** — ⏎/⌘Z drawing-context-wins, Cut Out
   #137 deleteSelected routing, calibrate/check pop isolation. Owner: T1
   restores all three verbatim into the unified handler's undo/redo and
   deleteBack branches.

## Decisions

D1. **T becomes a first-class keymap command**, and **the One-Click gate moves
    into the dispatch**: registry entry
    `repeat: { label: "Trace another like the selection", category: "Tools", default: "t" }`
    in `DEFAULT_KEYMAP`; `"repeat"` added to `TOOL_COMMANDS` (uniform gallery +
    menu-depth gating); dispatched as a special case inside the existing
    `TOOL/NAV` branch, pattern-identical to `focusMode`/`curveFlip`; and inside
    that branch, before `setTool(cmd)`:
    `if (cmd === "oneclick" && !oneClickEnabled()) { setCommitMsg(ONE_CLICK_GATE_MESSAGE); return; }`.
    `t` is unbound in `DEFAULT_KEYMAP` (letters in use: o a r l s c d h n k v
    y q g f ?; plus shift+d), so no default conflict. `repeatPlan` can never
    return `oneclick`/`zone`, so the gate and the repeat case don't interact.

D2. **Escape block**: branch's Select-floor structure (`hadSomething` →
    resets → drop to Select) wins; main's image-placement resets restored into
    BOTH `hadSomething` and the reset cascade.

D3. **Effect deps**: union of main's and the branch's lists; main's deps
    comments kept (already present in the paused worktree).

D4. **The old letter map and the old separate delete/Escape/⌘Z effect stay
    deleted** (theirs) — behavior is subsumed by the unified `matchCommand`
    handler, whose deleted-region deltas (T, One-Click gate, image resets,
    comments) are each carried by D1/D2/T1 instead.

D5. **Tests land in the same resolution as the code they cover** (TDD within
    the replayed commit — matches the branch's own pairing in `56e3647`/
    `7b65ae4`). A replayed commit must stay coherent at its own hash.

D6. **Commits 14–18** (`f91a1e2` guide-in-gallery, `69b57b5` gitignore,
    `15af7af` escape consumers, `7a2200d` guide §15 + changelog, `06106d2`
    reserved-keys spec): resolve by intent — branch architecture is the
    substrate, main's features ride on it per D1–D4. Expected friction, all
    listed: `7a2200d` rewriting USER_GUIDE §15 (main added a T row to the old
    table) and CHANGELOG (both sides appended); `69b57b5` `.gitignore`
    (both sides edited; trivial union) — note the staged
    `.superpowers/sdd/task-6-report.md` flow is legitimate: `4b5496e` adds it,
    `f91a1e2` appends, `69b57b5` deletes all.

    **§15 resolution rule for `7a2200d` (round-2 major, test-enforced):** the
    branch's §15 rewrite lists `O` and `Hold M` as unconditional Tools-table
    rows (it predates the gate); the merged overlay keeps main's
    `oneClickEnabled()`/`commandBoxEnabled()` conditional spreads, and those
    gates are false under node:test — so guideParity's direction 2 (§15 tools
    reach the overlay) fails for `O`/`Hold M`, and direction 1 fails for the
    overlay's T row (branch §15 has none). The resolution is §15 restructured
    to MAIN's shape: gated keys stay OUT of table rows and live in the gate
    paragraph, and the T row is re-added to the table. The tempting
    alternative — making the overlay's O/hold-M rows unconditional (the
    branch's original shape) — turns parity green while documenting `O` as a
    live shortcut that D1's restored gate refuses at keypress. That fix is
    FORBIDDEN here; it is a doc-vs-code lie with no test catching it.

    **Run the pure test suite (`npm test` in web/) after every replayed
    commit** — a keymap/guideParity break must surface at its commit, not at
    T5 commits away from the cause.

D7. **The 26-command reality — four artifacts pin 25 and all get updated**:
    (a) `web/test/keymap.test.ts` count assertion 25→26, edited in T1's red
    phase together with the new repeat cases (not discovered in green);
    (b) `CHANGELOG.md` "all 25 remappable commands" → 26, plus the
    integration note; (c) `docs/superpowers/specs/2026-08-25-shortcut-config-design.md`
    §3 "Remappable (25 commands)" + a `repeat` table row (the spec is the
    branch's declared "verbatim truth"); (d) `UserGuide.jsx` — see D8.
    The 2026-08-25 plan doc's "25 commands, exactly — do not add/remove" is a
    point-in-time scope statement of that plan; this plan supersedes it and
    says so here rather than rewriting history in the old doc.

D8. **Guide tables are only half registry-driven — `repeat` gets a live row by
    hand**: `UserGuide.jsx` renders static TOOLS/DRAW/VIEW row arrays; a row's
    keycap is live only when its exact description string is a key in
    `COMMAND_ROW` (description→commandId). Main's T row already exists in DRAW
    (hardcoded "T" keycap). T1 adds the matching `COMMAND_ROW` entry so the
    keycap tracks rebinds (the live-table contract of commit `6f12409`), and
    `guideParity.test.ts` (§15↔overlay agreement) runs in the same cycle.
    Blind spot, accepted: guideParity imports only TOOLS/DRAW/VIEW — it never
    sees `COMMAND_ROW`, so the description-string match has no automated net
    at any commit; the T5.5 manual rebind check is the only guard.
    `ShortcutConfig.jsx` enumerates `DEFAULT_KEYMAP` directly — no edit needed.

## Task breakdown

- **T0 — bootstrap (before any test run)**: `mise exec -- npm ci` in the
  worktree's `web/` (Node 24 pin; `.nvmrc`=24, mise 2026.9.5 resolves 24.21.0;
  `npm ci`, not `npm install`, so the committed package-lock.json is not
  rewritten). Safe during the paused rebase (node_modules ignored).
  Acceptance: `npm test` runs the suite.

- **T1 — repeat command + gate, test-first (commit 13 resolution)**
  Red phase — extend `web/test/keymap.test.ts`: registry shape
  (`DEFAULT_KEYMAP.repeat` label/category/default `"t"`); count 25→26;
  `matchCommand({key:"t"}) === "repeat"`; shift-fallback
  `matchCommand({key:"T", shiftKey:true}) === "repeat"`;
  `matches({key:"t"}, "repeat") === true` (dispatch-facing API pin);
  `findConflict("t", {}, "area") === "repeat"` and self-exclusion
  `findConflict("t", {}, "repeat") === null`; consumer round-trip:
  `applyOverrides({repeat:"x"})` → `matchCommand({key:"x"})==="repeat"`,
  `matchCommand({key:"t"})===null`, `findConflict("t",{repeat:"x"},"area")===null`,
  `setOverride`/`resetCommand` restore default; module-state hygiene —
  `applyOverrides({})`/`resetAll()` at test start (matchCommand reads
  module-level overrides earlier tests mutate). Run → red. Red-tracing scope
  (round-2 nit): the registry-shape, count-25→26, matchCommand-t,
  shift-fallback, matches-pin, and override-on-x assertions fail pre-change;
  the three unbound-`t` consumer cases (`findConflict` self-exclusion, freed-t
  `matchCommand`, `findConflict("t",{repeat:"x"},"area")`) PASS pre-change by
  construction — `t` being unbound is why — and become meaningful post-green,
  pinning that an override frees the default key. Not a mistake; don't "fix"
  them out.
  Green phase — apply D1 (registry + `TOOL_COMMANDS` + dispatch special case +
  One-Click gate), D2 (escape + hadSomething), D4 + item-5 comments
  (⌘Z precedence, #137 routing, calibrate/check pop isolation) into
  `TakeoffCanvas.jsx`; apply D8 (`COMMAND_ROW` entry, exact description string
  verified against the DRAW row at edit time). Run → green, full suite.
  Acceptance: red→green demonstrated; no unrelated test regressed.

- **T2 — replay 14–18** per D6, running `npm test` after each commit.
  Acceptance: each commit applies with intent preserved; suite green at every
  stop; no staged/unstaged leftovers between commits (the untracked plan file
  legitimately shows as `??` throughout).

- **T3 — post-rebase audit** (silent-loss sweep): T works end-to-end
  (dispatch → repeatPlan → armed tool); One-Click gate fires at keypress with
  `ONE_CLICK_GATE_MESSAGE` when gated; image-placement escapes present (reset
  cascade + hadSomething); premium/workspace menu items present; no double
  dispatch of Backspace/⌘Z; `grep` for
  `repeatPlan|shortcutLabel|condById|oneClickEnabled|ONE_CLICK_GATE_MESSAGE`
  confirms every used identifier is defined/imports present (Vite does not
  flag undefined JSX identifiers).

- **T4 — doc sync** per D7: CHANGELOG (count + integration note), spec §3
  (count + repeat row), USER_GUIDE §15 per D6's resolution rule; commit this
  plan file (rev 3 + review provenance) as its own commit.

- **T5 — verification**: `mise exec -- npm run check --prefix web`;
  `node scripts/check-doc-links.mjs`.

- **T5.5 — run-the-app verification** (repo-guide: canvas changes are verified
  by hand; the branch's own plan mandated browser verification + screenshot):
  dev server via `hub start` (web, Node 24); in a browser (OMP task subagent
  with browser, or playwright MCP): load sample plan → trace + commit a shape →
  select it → press `T` → assert the recorded condition's tool arms and the
  message bar confirms; press `o` with the gate on → assert the gate message
  (not a silent arm); open `?` guide → assert the T row's keycap; open the
  shortcut config modal → rebind repeat → assert the guide keycap updates
  (live-table contract) → reset; open guide + modal from the gallery view.
  D2 escape-regression scenario (ProcGit round-2): arm the image tool, click
  the first marquee corner, press `Esc` → assert placement state resets AND
  the armed tool does NOT drop to Select (the hadSomething restoration).
  Capture screenshots for the eventual PR body.

- **T6 — push**: `git push --force-with-lease=refs/heads/feat/shortcut-config:06106d285f2353b5be057843476b214f797c7496 origin feat/shortcut-config`
  (lease pinned to the verified pre-rebase remote tip; NOT the rebased local
  head). No PR rides this branch; PR opens later per repo-guide flow.

## Risks / open questions

- Later replayed commits editing the same handler regions edited at 13 →
  resolve by intent; rerere enabled.
- The exact DRAW-row description string for the `COMMAND_ROW` key must be
  copied from the row at edit time (a mismatch means a static keycap that
  silently stops tracking rebinds — the failure mode D8 exists to prevent).
- If reviewers find further gate/precedence losses in the deleted regions,
  they get the same treatment: named decision + owner task before T1 runs.

## Out of scope

Other feature branches (tile-patterning #207, 3d-takeoff-view #216, …) —
subsequent passes, one branch per session. No behavior changes beyond
preserving both sides' existing behavior.
