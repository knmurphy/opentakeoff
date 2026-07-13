# Estimating Roadmap — Pricing, Assemblies, Estimate Worksheet & Proposals

> **Status: PLANNED, not yet built.** This documents the follow-up phases to the
> optional team cloud mode (PR #58: Google sign-in + Drive-backed storage).
> Pricing is intentionally deferred until the owner is ready to build it. The app
> stays fully functional (anonymous local mode and cloud project storage) without
> any of this.

## Goal

Give OpenTakeoff the flexibility of a **StackCT-style estimate worksheet**: a
simple **unit-cost estimate** driven by **items** and **assemblies** of
materials, with **material and labor costs as separate columns**, fed by takeoff
quantities. The first proposal deliverable is exactly this unit-cost estimate,
rendered to a PDF and saved to the project's Drive folder.

## Core model (maps onto existing code)

- **Item** = a priced material/labor line: `{ id, name, unit, material_cost, labor_cost, category }` where `category ∈ material | labor | sub | equipment`. Items are the existing browser-global **material library** (`web/src/lib/materials.js`, sanitized by `sanitizeMaterialLibrary`) enriched with `material_cost` + `labor_cost` fed from the pricing table.
- **Assembly** = a reusable, named bundle of item-lines, each carrying a coverage/basis: `{ id, name, lines: [{ item_id|name, unit, per, basis }] }`. This is the SAME shape `conditionTotals` already computes per condition — `materials: [{ name, unit, per, basis, qty }]` with `qty = basisVal ÷ per`, rounded up (`web/src/lib/totals.js:62-68`). An assembly makes that list reusable and attachable to a condition in one action — a new library asset following the exact pattern of templates/materials/stamps (browser-global meta record + `sanitize*` load gate + Drive-backed later).
- **Unit-cost estimate** = attach an item or assembly to each takeoff condition → its measured quantity (floor/wall/border SF, LF, EA from `conditionTotals`) explodes into item quantities → `qty × material_cost` and `qty × labor_cost` = extended costs → roll up to condition subtotals and grand totals, with waste (already in `conditionTotals`) and markup.

## Phase 3a — Pricing ingest + unit-cost join (the simple estimate)

**Pricing source.** A shared `pricing.json` in the team Drive, synced from
Neon/Glide Big Tables by a background job (the only place DB/Glide creds live).
Shape: `[{ item, unit, material_cost, labor_cost, category? }]`.

**Ingest seam.** Read by known file id `VITE_PRICING_FILE_ID` via
`createDrive(...).getJson(fileId)` (`web/src/lib/google/drive.js`). Env read
follows the `import.meta.env.VITE_*` guard in `auth.js`/`contribute.js`. Add
`loadPricing()` to the cloud store (`web/src/lib/cloudStore.js`); local mode
returns `null` (pricing is cloud-only). Load once in `TakeoffCanvas` after
sign-in — same shape as the existing `loadTemplates`/`loadMaterialLibrary` mount
effects (`TakeoffCanvas.jsx:627-632`) — hold in state, pass to `ReportPanel`.

**Join.** By item **name** (normalized) → `{ material_cost, labor_cost }`. Reuse
the material identity already on condition `materials[].name`.

**Cost math.** Extend `conditionTotals` (`totals.js`) so each material line also
carries `material_ext = qty × material_cost` and `labor_ext = qty × labor_cost`
(pricing passed in, or joined in a thin wrapper to keep `totals.js` pure). Add
`grandTotals`-style roll-ups for material, labor, and combined (`round2` from
`num.js`).

**Columns.** Add opt-in report/CSV columns via `web/src/lib/reportColumns.js`:
new `GETTERS` (`unit_cost_material`, `unit_cost_labor`, `material_ext`,
`labor_ext`, `line_total`) appended to `TABLE_PROFILE`/`CSV_PROFILE` with
`defaultVisible: false` (shown only when pricing is loaded), `foot` delegating to
the new grand totals — the additive, golden-safe pattern the file documents. No
existing currency util exists; add a small `money(n)` to `num.js`
(`toLocaleString(undefined, { style: 'currency', currency: 'USD' })`).

## Phase 3b — Assemblies library

A new browser-global asset mirroring templates/materials/stamps:
- `web/src/lib/assemblies.js` — `sanitizeAssemblyLibrary` load gate (the
  `sanitizeMaterialLibrary`/`sanitizeTemplates` precedent).
- `store.js` — `loadAssemblyLibrary`/`saveAssemblyLibrary` (own `ASSEMBLY_KEY`
  in the keyPath-less meta store, no DB version bump — the stamp-library
  precedent at `store.js`), delegated in `cloudStore` like the other libraries.
- UI — an **Assemblies** tab beside Materials in the left dock; "Apply assembly"
  on a condition seeds/overwrites its `materials` array from the assembly's
  lines (so the existing `conditionTotals` math produces item quantities and
  costs with no new engine).

## Phase 4 — Estimate worksheet + proposal PDF

**Worksheet (StackCT-style, editable).** Extend `ReportPanel.jsx` (or a new
`EstimatePanel.jsx`) into a worksheet: each condition row expands to its item
lines with **Qty | Unit | Material Unit $ | Material Ext $ | Labor Unit $ | Labor
Ext $ | Line Total**, editable qty/unit-cost/waste/markup, live condition
subtotals (material/labor/total) and a grand total split the same way. Reuses
`conditionTotals` for quantities and the Phase-3a cost math for money.

**Proposal = the unit-cost estimate rendered.** New `web/src/lib/proposal.js`:
`buildProposalPdf({ company, client, projectName, rows, totals })` → `Uint8Array`,
built with **`pdf-lib`** mirroring `buildMarkedSetPdf` in
`web/src/lib/markedset.js` (document/page/font/text). Header from
`loadCompany()` (`identity.js`) + `client_info` + `project_name` (already in
`TakeoffCanvas` state and the `ReportPanel` masthead). Body = the estimate table
with material/labor columns and totals.

**Save.** Local: `downloadBytes('proposal.pdf', bytes)` (`markedset.js`). Cloud:
a `saveProposal(bytes)` on `cloudStore` mirroring `saveAnnotations`'
locate-or-update (via `drive.uploadFile`/`putJson`) so re-generating replaces
`proposal.pdf` in the project folder instead of duplicating it. Reuse the
`addPdf` File-like `{ name, arrayBuffer() }` contract if convenient.

## Operator / sync (outside the app)

- Pricing sync job (`tools/sync-pricing/`): Neon / Glide Big Tables →
  `pricing.json` in Drive on a schedule. **Only place DB/Glide creds live.** Can
  start as a manual export or a Glide automation. Document in
  `docs/GLIDE_INTEGRATION.md`.
- Set `VITE_PRICING_FILE_ID` to the `pricing.json` Drive file id (non-secret; see
  `web/.env.example`).

## Security (unchanged posture)

No secrets in the bundle. Pricing is a Drive file read with the signed-in user's
own token; the proposal is written to the team's own Drive. Everything is gated
behind the Internal-OAuth sign-in. Credentials for Neon/Glide live only in the
sync job.

## Sequencing & tests

1. **3a** pricing ingest + unit-cost/labor columns (pure cost-math unit tests in
   the `totals.test.ts` style: `qty × cost`, missing price → blank/0, grand
   totals split material/labor).
2. **3b** assemblies library (sanitizer + store round-trip tests, the
   `materials.test.ts`/`templates.test.ts` precedent).
3. **4** estimate worksheet UI + `buildProposalPdf` (smoke test: non-empty PDF
   bytes; cost table totals match `grandTotals`).

Each phase is independently shippable and additive; anonymous local mode and the
shipped cloud storage stay unchanged throughout.
