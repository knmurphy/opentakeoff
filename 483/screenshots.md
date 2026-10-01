# #483 PR A: screenshot evidence (wave B, fresh profile)

**Head** is `fix/483-schedule-reader-gaps`. The app code is at `4fef1918` (wave A); `b0e458d4` adds only a USER_GUIDE line. **Base** is `60c82e34`.

All data is public: the bundled demo, and the tracked synthetic fixture `mcp/test/fixtures/reader483-set.pdf`, which uses invented codes (VENDOR-A …).

The slice-6 images and scripts were taken from a pre-seeded profile at `bcd3663d`. They are now in `_superseded-slice6/` and aren't used here. That folder is **not for publishing**: its scripts hard-code a local home path.

## Reproduce (outside reviewer, fresh profile)

```bash
cd repro
npm install                          # playwright 1.63.0, pinned (package.json + package-lock.json)
npx playwright install chromium      # its Chromium (headless shell 1243 / Chrome 153)
(cd <checkout>/web && npx vite --port 5287 --strictPort) &
node run.mjs --url http://localhost:5287 --repo <checkout> --looks all --out ../shots    # → "344/344 passed", exit 0
```

`run.mjs` is a single entry script with no hard-coded paths. It opens **a new browser context per look**, with no stored data. Before the app loads, it writes the look to the same `localStorage` keys the app's own controls write:

- `ot.workspace-layout.v1`: layout on or off, and the surface;
- `opentakeoff_theme`: the chrome theme.

`colorScheme` is set to match. Everything after that goes through the UI:

1. **Load sample plan**. A fresh profile starts with the sample's starter conditions (CPT-1, BRD-1, LVT-1, WD-1, VCT-1, SV-1, CT-1, RB-1, TR-1). That's why CPT-1, VCT-1, RB-1, CT-1 and LVT-1 show **in use**.
2. **Open** → `reader483-set.pdf` through the file chooser.
3. Seed the in-use code: ⋯ → **Import from schedule** around A-601's table, **Deselect all**, tick TS-1, **Create 1 condition**.
4. Run the scenes. Each box is clicked from page-px coordinates mapped through the sheet canvas's on-screen rect (canvas px = page px at the app's render scale, 2). Every assertion prints PASS/FAIL, and the run ends with `N/M passed`, exiting 1 on any FAIL.

For base, `node run.mjs --mode base --url <base app> --repo <checkout>` runs only the demo scenes (01, 01b, 09), since base has no fixture, NOT USED or banner: **80/80 passed**.

Logs:

- `repro/out/run-head.log`: 344/344, with a `CONTRAST {…}` JSON line;
- `repro/out/run-base.log`: 80/80.

`node repro/contrast-table.mjs repro/out/run-head.log repro/out/run-base.log` prints the contrast table below.

## Looks (enumerated from the code)

- `web/src/lib/workspaceLayout.js` has three workspace surfaces: `graphite` (default), `light` and `hud` (Instrument HUD, reachable only from the Layout dialog).
- `web/src/lib/theme.js` + `public/theme-init.js` set the chrome theme `<html data-theme>`, light or dark. It follows the OS until it's toggled with ⋯ → Light/Dark chrome.
- `enabled: false` gives the **classic layout** (⋯ → "Classic layout"). Its dialog takes the root tokens, not the workspace surface.

That makes **8 looks**: `graphite-light` (the default on a light-OS machine), `graphite-dark`, `light-light`, `light-dark`, `hud-light`, `hud-dark`, `classic-light` and `classic-dark`. File names end `--<look>.png`.

**About "the workspace layout preview OFF".** The doubled chrome in slice 6's `01-demo-graphite.png` was the All-controls strip stacked under the workspace chrome. In the workspace layout, that strip is the only way to reach ⋯ → Import from schedule. For each workspace look, the script now arms the tool through All controls, clicks **Close controls**, then draws the box, so the dialog shots show a single chrome. The classic layout ("preview off") is shot as two looks of its own. The context shots `_a60N-sheet` are taken with the controls strip open because the sheet navigator lives there, so they do show both rows.

## Scenes and assertions (43 per look × 8 = 344, all PASS)

| File | What it shows | Assertions (all PASS in all 8 looks) |
|---|---|---|
| `01-demo--*` (full page), `01b-demo-end--*` (dialog, scrolled to end) | Demo AF600 MATERIAL SCHEDULE | demo sheet 2 (AF600) shown; title `Import from schedule — 28 finishes found`; the 28 codes, sorted, equal the codes of the committed base golden `mcp/test/fixtures/reader-483/demo-p2-table.json`; no banner and no `aria-describedby`; 0 NOT USED labels; no group indeterminate; **in use** exactly CPT-1, VCT-1, RB-1, CT-1, TS-1; **Create 17 conditions**. Group states, logged: No section, Floor, Base, Wall, Wall protection and Transition all `all`; Ceiling and Other `none`. |
| `02-p1-banner-notused-mixed--*` | A-601: skipped banner, NOT USED label, Floor dash | banner text is exactly `1 code wasn't read: SEAL. A four- or five-letter code with no number is read only when the header or a read row is above it, it fills two or more other columns, and a row with a numbered code, like CPT-1, comes after it — if it's a finish, add it as a condition yourself.`; dialog `aria-describedby` = banner id; title `14 finishes found`; the 14 codes the MCP test asserts; Floor `data-state="some"`, unchecked, **`indeterminate === true`**; no other group indeterminate; CPT-2 unticked and pickable, described by its NOT USED label; hidden note ends "The schedule marks this row not used. Select it to create a condition anyway." |
| `03-p1-twolabel-inuse--*` | End of list: TS-1 in use, from description, NOT USED | TS-1 locked with flag **in use**; `aria-describedby` = `…-guess …-notused` (in-use flag not in it); its note ends "NOT USED The schedule marks this row not used." with no "Select it…" |
| `04-p1-floor-dash-clicked--*` | After clicking the Floor dash | Floor → `all`, checked, not indeterminate; CPT-2 (NOT USED) ticked; Create count +1 (8 → 9) |
| `05-p1-duplicate-after-rename--*` | P-2 renamed P-1 | two rows read P-1; the first (`SAT — PAINT`) keeps it, ticked and pickable; the renamed one is locked with **duplicate**; exactly one `span[title="Click the code to rename it."]`; Create count −1 (8 → 7) |
| `06-p2-zero-rows--*` | A-602 (EPOX, CONC, SEAL only) | title `Import from schedule — no rows read`; banner exactly `3 codes weren't read: EPOX, CONC, SEAL. … — if they're finishes, add them as conditions yourself.`; `aria-describedby` = banner id; the only button is **Close**; focus on Close, inside the dialog; `Esc` closes it |
| `07-p3-short-table--*` | A-603 short table | 4 rows: CPT-1, EPOX and PT-1 under No section; RB-1 under Base, **from description**, its description `RUBBER BASE` only (no EPOXY); no banner |
| `08-p1-375px-dialog--*`, `08-p1-375px-twolabel-inuse--*` | 375 × 812, TS-1 row | dialog 343 px wide (100vw − 32); TS-1's code, in-use flag and both descriptors: no two intersect. The box is drawn at 1200 px and the viewport then narrows with the dialog open, because the classic layout's wrapped toolbars leave too little canvas to draw on at 375. The dialog is fixed, `min(560px, 100vw − 32px)` wide, so it reflows the same way. |
| `09-demo-duplicate--*` | Demo with P-2 renamed P-1 (a duplicate measurable at base too) | the renamed row shows **duplicate** |
| `_a601-sheet--*`, `_a602-sheet--*`, `_a603-sheet--*` | The fixture sheets as drawn | context only |

Base (`shots-base/`, `--mode base`) runs scenes 01, 01b and 09 in all 8 looks, all PASS. There is no TS-1 seed there, so **in use** is CPT-1, VCT-1, RB-1, CT-1 and the button reads **Create 18 conditions**.

Every image in `shots/` (112), `shots-base/` (24) and `shots-docs/` (4) was opened and checked.

**Swatch colours shift after a tick or a rename.** This is not a change in this PR. In the dialog, a row's colour swatch comes from its position among the rows that will be created, so ticking or renaming a row recolours every swatch below it. At head, compare `02` with `04`: CPT-3SAT is orange in 02 and green in 04. Base does the same, as `shots-base/01-demo--graphite-light.png` vs `09-demo-duplicate--graphite-light.png` shows: PR-1 is green in 01 and orange in 09.

## Contrast (WCAG 2.x, computed in the page from computed styles)

Method:

1. Convert each colour to sRGB through a 1 × 1 canvas.
2. Multiply opacity up the ancestor chain.
3. Blend the colour over the first opaque ancestor background.
4. Take the ratio of the blended colour to that background.

Text needs 4.5:1; the label border is a non-text mark and needs 3:1. Head values come from the A-601 dialog (the duplicate scene for the duplicate flag); base values come from the demo dialog at `60c82e34`.

| Element | graphite-light | graphite-dark | light-light | light-dark | hud-light | hud-dark | classic-light | classic-dark |
|---|---|---|---|---|---|---|---|---|
| Dialog background | rgb(24,30,42) | rgb(24,30,42) | rgb(255,255,255) | rgb(255,255,255) | rgb(5,7,11) | rgb(5,7,11) | rgb(250,252,254) | rgb(3,4,5) |
| Banner text (`--ink`), new | 14.20 | 14.20 | 12.33 | 12.33 | 17.15 | 17.15 | 17.72 | 15.65 |
| NOT USED label text (`--ink`), new | 14.20 | 14.20 | 12.33 | 12.33 | 17.15 | 17.15 | 17.72 | 15.65 |
| NOT USED label border (`--c-warning`, non-text 3:1), new | 10.58 | 10.58 | 5.32 | 5.32 | 12.77 | 12.77 | 3.33 | 11.12 |
| Duplicate flag, head (fixture and demo) | 2.52 | 2.52 | 1.81 | 1.81 | 2.48 | 2.48 | 1.86 | 1.50 |
| Duplicate flag, **base** demo | 2.52 | 2.52 | 1.81 | 1.81 | 2.48 | 2.48 | 1.86 | 1.50 |
| From description (`--c-warning`), head | 10.58 | 10.58 | 5.32 | 5.32 | 12.77 | 12.77 | **3.33** | 11.12 |
| From description, **base** demo | 10.58 | 10.58 | 5.32 | 5.32 | 12.77 | 12.77 | **3.33** | 11.12 |
| Row description text, head (fixture and demo) | **1.09** | 12.73 | 18.22 | **1.31** | **1.11** | 15.38 | 17.72 | 15.65 |
| Row description text, **base** demo | **1.09** | 12.73 | 18.22 | **1.31** | **1.11** | 15.38 | 17.72 | 15.65 |

What the table shows:

- **The three new elements pass in every look.** Banner text and NOT USED label text are ≥ 12.33:1. The NOT USED border is ≥ 3.33:1 against its 3:1 non-text bar; its lowest value, classic-light at 3.33, still passes.
- **The duplicate flag is unchanged from base in every look** (1.50–2.52):
  - The flag sits inside a locked (disabled) row's label, at opacity 0.8 × 0.55 = 0.44.
  - At base, the 0.55 was on the row wrapper. This PR moved it to the label, which still contains the flag, so the effective opacity and ratio are identical.
  - WCAG exempts text of inactive controls, but it is hard to read.
- **From description is unchanged from base.** In classic-light it is 3.33:1: `--c-warning` #c47a10 on #fafcfe, as 9 px uppercase text. That is below 4.5 and pre-existing.
- **Row description text is unchanged from base, and unreadable in three looks:**
  - graphite-light 1.09, the default combination on a light OS;
  - light-dark 1.31;
  - hud-light 1.11.

  The span has no colour of its own, so it inherits the `<html data-theme>` chrome ink while the dialog takes the workspace surface's `--paper-bright`. Wherever the chrome theme and the surface disagree, the description goes dark on dark or light on light. This is the "dark-mode description contrast" follow-up, not something this PR changes. Lead the PR with the `light-light`, `graphite-dark` and `classic-light` images.

## docs/img/verify-import-schedule-dialog.png (alt text: demo, scrolled to the end)

Re-captured in the same state: classic layout, light chrome, 1600 × 1000, fresh profile, demo AF600, dialog scrolled to its end. The capture is `repro/docs-image.mjs`, with output in `shots-docs/`.

- Head and base dialog crops are **byte-identical**.
- Head shows the same rows, flags and footer as the committed image: CT-1 **in use**, Wall Protection and Transition **from description**, TS-1 `SCHLUTER · TO FIT …` truncated, Ceiling/Other unticked, **Create 18 conditions**.
- The pixel differences from the committed PNG are anti-aliasing from a different Chromium build, plus the sheet-tab label (AF101 vs sample-finish-plan) and the cursor read-out in the chrome, which also varies between two runs on the same commit.

**Not retaken.** The image is still accurate, and its alt text still matches.
