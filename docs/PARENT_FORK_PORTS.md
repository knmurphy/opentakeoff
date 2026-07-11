# Parent-fork ports — handoff

Tracks the cherry-pick effort from `Kentucky-ai/opentakeoff` (upstream remote `upstream`) into this fork. Six ports are live in production; four remain.

## Shipped (production, `takeoff.345flooring.com`)

| # | Feature | Upstream commit | PR |
|---|---|---|---|
| 1 | MCP server | `fb540ef` + `5cce895` | #82 |
| 2 | Coverage presets + grout calculator | `537a305` | #86 |
| 3 | Check-a-dimension (K) + rescale-reprice | `6bfa9f0` | #88 |
| 4 | Zone check + sheet levels | `502978f` (plays deliberately skipped — redundant with our template library) | #96 |
| 5 | Raster One-Click fallback (scanned plans) | `d2c3bf7` | #99 |

MCP note: raster's `ensureMask` seam is still unwired server-side (no node canvas backend) — flagged in `mcp/README.md`'s Limits section for a future pass.

## Remaining, in recommended order

**1. Metric display + ratio scale presets** (`ee3c2ad`, metric parts only)
- Highest integration surface: readouts, `TakeoffsPanel`, Report, CSV (SY column retires in metric), Marked Set legend — all rewritten in our fork.
- `units.ts` is already in place (ported alongside check-a-dimension) with a module-scoped `const UNITS = "imperial"` pin and metric ternaries kept greppable. Two deferred test cases in `units.test.ts` are waiting on this port — search the file header for the note.
- Do **not** port this commit's hatch swap (`dots`→`fleur`) — we deliberately kept `dots`; it's in the MCP hatch mirror too.
- Review lens to add: old saved imperial projects must round-trip untouched; the unit toggle must never rewrite stored feet.

**2. Highlighter markup + hatch retune + Eraser rename** (`d02032a`, stroke-picking half of `ee3c2ad`)
- Medium risk, lowest urgency — product overlap with our existing stamps/annotations layer. Confirm scope is wanted before spending a cycle.
- Pure stroke geometry (`thinStroke`/`chiselRibbon`) is a clean port into `geometry.js`; Marked Set export integration is the risky half.
- Hatch retune must again preserve `dots`.

**3. BYO-key AI vision seam + read-scale-with-AI** (`c304cb7`)
- Mostly standalone (`ai.js`, `AiSettings.jsx`); `scaleFromLabel` joins `sheets.ts`.
- Pairs well with raster (scans are exactly where text-regex scale detection fails).
- Security-sensitive review lens: key storage, un-invert-before-JPEG dark-mode handling, zero network calls when unconfigured.

**4. Live-measure cursor readout** (`cc3e9af`) — micro-port
- Our canvas already has partial readout machinery. First step: diff to find what's actually missing (likely just the amber 12-ft carpet-roll warning). May collapse to a half-day port or turn out to be a no-op.

## Explicitly parked

**Capture layer** (`e874003` + `6373c1f`) — Python server banking contributed takeoffs as training rows. Only valuable if training-data collection is wanted. Isolated; slots in independently whenever decided.

## Process (what worked — repeat it)

Each port: fresh branch off `main` → worktree agent hand-ports with upstream authorship preserved (`--author`), gates on `web`+`mcp` check/test, Playwright drive of the new feature → adversarial review workflow (3–5 lenses → 3 refuters/finding) → fix round → **hostile ship-gate** on the fix diff specifically (this caught real regressions twice — a stale-ref proposal race reintroduced while fixing a React-purity finding, and a coordinate-swap typo in a review-fix commit) → push, PR, CI via `workflow_dispatch` (app-token PRs don't fire `pull_request`) → Copilot + independent subagent PR review in parallel → fix findings → merge → verify deploy.

Standing gotchas:
- `main` moves fast — expect at least one rebase-and-regate cycle per PR; check `mergeable_state` before merging, not just CI.
- Rate-limit or infra hiccups mid-review can silently under-vote a finding (it shows "dismissed" from too few refuters, not real refutation) — check `of < 3` in the vote tally before trusting a dismissal.
- Copilot reviews once per PR open in this repo, not on every push — don't wait indefinitely for a second pass; verify its original findings were fixed and move on.
- Architecture can shift under a long-running port (`SheetGallery.jsx`→`PlanNavigator.jsx` happened mid-flight) — a stale branch's conflict may need real re-porting, not text resolution.
