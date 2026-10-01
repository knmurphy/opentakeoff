# Evaluation sets

Drawing sets for the region-annotation evaluation
(`docs/design/REGION_ANNOTATION_PLAN.md`, "Evaluation data"). All are
attachments to U.S. Department of Veterans Affairs construction solicitations
posted publicly on SAM.gov (`accessLevel: public`), the same source class as
`evals/four-asks-2026-09-02/sheets/`. All sets are from one owner (VA).

**The PDFs are not committed.** `node evals/regions/fetch.mjs [dir] [--role tune|in-sample|held-out]`
downloads them by SAM.gov resource id into `evals/regions/pdfs/` (gitignored)
and checks each sha256; a mismatch fails loudly. **CI never runs it**: results
on these sets are reproducible by hand with the script, not CI-verified.

## Solicitations

- **36C25625R0108**, "667-23-113 CON Fisher House Site Prep Construction",
  Overton Brooks VA Medical Center, Shreveport LA. SAM.gov notice
  `7a75c7c60b0d49638a80b7f9ea67d06e`, attachment "Combined Drawings".
- **36C77626R0031**, "Renovate Building 9A for EHRM Administrative Space",
  Carl Vinson VA Medical Center, Dublin GA. SAM.gov notice
  `85e50629af6f4e62885e766bc9e6f009`, RFP Attachments 10–23
  ("Drawings Part 1" … "Drawings Part 14").

## Files

| File | Solicitation, attachment | Role | Pages | Resource id | sha256 |
|---|---|---|---|---|---|
| `shreveport-combined.pdf` | 36C25625R0108, Combined Drawings | tune | 24 | `02bfbae88d3644e185c670eb74d3479f` | `4594fe00e04c5dedf9e1bc468336d2967405e605158874c56dc08335c6823dfd` |
| `dublin-part1.pdf` | 36C77626R0031, Drawings Part 1 | in-sample | 11 | `d116af76e9fc489baba6c9f9c4ca5734` | `b53cdfa35f55fd2e00451922612d38ec694b4674f5f40c39656a185991aa59e2` |
| `dublin-part4.pdf` | 36C77626R0031, Drawings Part 4 | in-sample | 13 | `636c1e4c1e674f5d9d0195168aa555ad` | `4b58cff60984c662d60891c1e447bbd203794f89df954899918f09679be37b1f` |
| `dublin-part2.pdf` | 36C77626R0031, Drawings Part 2 | held-out | 7 | `ebec0f42a8b142cb9c85a2f4dfcb0e2d` | `c7f8ad67ea321c98d40fde333f66aeed11f1ea6cb79e56479de768511aa3f989` |
| `dublin-part5.pdf` | 36C77626R0031, Drawings Part 5 | held-out | 10 | `b6817f965d1e492e8fc1c5d74589bd29` | `e2397b40bfa20841609888959e5c841aba4583628e04dfb6bd21c8bf7497612d` |
| `dublin-part7.pdf` | 36C77626R0031, Drawings Part 7 | held-out | 7 | `c253e6e493f0489e9d0afafda37a1c34` | `53344408d992e8352ecedb58646ec04a50c0470f943b48e46335c935ba05e308` |
| `dublin-part10.pdf` | 36C77626R0031, Drawings Part 10 | held-out | 4 | `3f4cc58d6aa2487b981faa2a2aff35f7` | `278f734f81b0fb1b7fcae22da73d3e84e881d6dbfdfc7a2911eef7e8fd0b9a7d` |
| `dublin-part11.pdf` | 36C77626R0031, Drawings Part 11 | held-out | 5 | `c7b35aee39cd4d28af5a1798f5bc49bc` | `67dde74f704a38904ebcbe7638205948ebd35d498129ac1fb5b7b2554f1041d2` |
| `dublin-part13.pdf` | 36C77626R0031, Drawings Part 13 | held-out | 1 | `a7567eb6fb154afead3dc374fa1ccdec` | `e66e4a65ee974b6b166511046a3ff5b279f4d24c9ec9d9767ab65888954430dc` |

Held out: 34 pages (7+10+7+4+5+1). Nobody opens held-out pages before the
constants are frozen, except the labelers, who see renders only; every such
opening is logged below.

## Held-out runs

`npm run bench:regions -- --held-out --reason "<why>"` (from `web/`) is the
one held-out evaluation. It is refused unless the tree is clean, HEAD descends
from the freeze commit in `freeze.json`, `freeze.json` was written by a
freeze-only commit on top of that commit, the frozen files (detector, adapter,
scorer, bench, guard, answer keys) hash to the frozen value both at the freeze
commit and at HEAD, the log has only ever grown, and no run has started at
that hash. Every
refusal, start (before any held-out page is opened) and finish is appended to
`heldout-runs.jsonl` (committed, append-only); results go only to
`web/bench/regions-heldout-results.json`.

## Access log

- 2026-09-30 — in-sample sets (Shreveport combined; Dublin parts 1 and 4)
  rendered and measured by plan reviewers.
- 2026-09-30T22:08Z — held-out parts 7, 10, 13 downloaded and hashed, not opened.
- 2026-09-30 — held-out parts 2, 5, 11 added (downloaded and hashed, not
  opened) because 7, 10, 13 hold only 12 pages.
