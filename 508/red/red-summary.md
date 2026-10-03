# RED summary: predicted vs observed

Run: `cd web && node --import tsx --test test/tileSheetRegistry.test.ts` on the
straight extraction (worktree fix-tile-leak, base 788e39bf, uncommitted).
Log: red-run.log. Result: 24 tests, 7 pass, 17 fail, 0 TypeErrors.

| Test | Predicted | Observed (first failing assertion) | Match |
|---|---|---|---|
| T1 open/close/second close | RED, destroy 0 | RED "destroy called once" | yes |
| T1 closed mid-load | RED, "zero posts" | RED "zero posts" | yes |
| T2 | RED, destroy 0 | RED "destroy called" | yes |
| T3a same turn | RED, early sheetReady | RED "no sheetReady from the old load" | yes |
| T3a flushed | RED, early sheetReady | RED "no sheetReady from the old load" | yes |
| T3b | RED, early sheetReady | RED "no sheetReady before the new load resolves" | yes |
| T3c | RED, two sheetReady | RED "the late old load adds nothing" | yes |
| T4 old rejects first | RED, sheetError | RED "no sheetError from the old load" | yes |
| T4 new resolves first | RED, sheetError | RED "no sheetError from the old load" | yes |
| T5 | RED, sentinel wins | RED "the queued render settles" | yes |
| T6 (RenderingCancelledException) | RED, cancel 0 | RED "its handle cancelled once" | yes |
| T6 (plain Error) | RED, cancel 0 | RED "its handle cancelled once" | yes |
| T6b | GREEN | pass | yes |
| T7 | RED, no bitmap.close | RED "bitmap closed" | yes |
| T8 | GREEN | pass | yes |
| T9 | GREEN | pass | yes |
| T10 | RED, no bitmap.close | RED "bitmap closed" | yes |
| T11 | GREEN | pass | yes |
| T12 | GREEN | pass | yes |
| T13 destroy rejects | GREEN (vacuous) | pass | yes |
| T13 destroy throws sync | GREEN (vacuous) | pass | yes |
| T14 | RED, destroy 0 | RED "destroy still called" | yes |
| T15 | RED, destroy 0 (differs from A3's "hangs", see predictions.md) | RED "destroy was called, and is still pending" | yes |
| T16 | RED, silent | RED "exactly one tileError" | yes |

No mismatches. Unhandled-rejection counter stayed 0 in every test (no afterEach failure).
