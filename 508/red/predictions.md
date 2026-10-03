# RED predictions (written before the first run)

Subject: web/src/lib/tileSheetRegistry.ts as a straight extraction of today's
pdfTile.worker.ts handler (no destroy, no identity guard, no close gate,
reqId-only cancel; openDocument called inside an async wrapper; renderTile
returns its chain step). Test file: web/test/tileSheetRegistry.test.ts.
Every test calls only handle() and inflightSize(), which the extraction has, so
no failure should be a TypeError.

| Test | Prediction on the extraction | Expected failing assertion |
|---|---|---|
| T1 (open, close, second close) | RED | destroy count is 0 ("destroy called once") |
| T1 (closed mid-load) | RED | "zero posts": the abandoned load posts sheetReady (destroy count 0 would fail next) |
| T2 (load rejects) | RED | destroy count is 0 |
| T3a same turn | RED | early sheetReady from the old load ("no sheetReady from the old load") |
| T3a flushed | RED | same as above |
| T3b | RED | early sheetReady ("no sheetReady before the new load resolves") |
| T3c | RED | two sheetReady ("the late old load adds nothing") |
| T4 old rejects first | RED | sheetError posted (old err handler deletes the new entry); a render would then get "sheet not open" |
| T4 new resolves first | RED | sheetError posted |
| T5 | RED | sentinel wins: the queued render hangs on the old ready ("the queued render settles" is false) |
| T6 (RenderingCancelledException) | RED | cancel count 0 (close doesn't cancel); the render would go on to post a tile |
| T6 (plain Error variant) | RED | cancel count 0 |
| T6b | GREEN | cancel by reqId cancels once, close does nothing, render silent |
| T7 | RED | no bitmap.close (A3; the extraction drops the bitmap on a late cancel) |
| T8 | GREEN | |
| T9 | GREEN | the async wrapper turns the sync throw into sheetError; the err handler deletes, so a reopen loads again |
| T10 | RED | no bitmap.close; the extraction's try does catch the post throw and posts a tileError |
| T11 | GREEN | |
| T12 | GREEN | today's render call sits inside the try, so the sync throw becomes tileError and the chain continues |
| T13 (destroy rejects) | GREEN (vacuous: the extraction never calls destroy) | |
| T13 (destroy throws sync) | GREEN (vacuous, same reason) | |
| T14 | RED | destroy count is 0 |
| T15 | RED | destroy count is 0 |
| T16 | RED | silent on RenderingCancelledException: tileError count 0 |

## Differences from plan v3 A3, decided before running

- **T15.** A3 predicts "hangs, then the sentinel wins". On a straight extraction
  closeSheet has nothing to wait on, so its handle() settles immediately and the
  sentinel can't win. To keep T15 non-vacuous it also asserts destroy was called
  exactly once (and is still pending, destroy: "never"). Predicted RED on the
  destroy count, not on a hang. The extraction is not bent to make it hang.
- **T14.** The plan says "the gate still rejects". The gate's rejection is only
  observable while the page load is pending, and then no render has a task whose
  cancel could throw. So T14 pins that the teardown runs past the throwing
  cancel: destroy is called, the in-progress render (late cancel) closes its
  bitmap and gets one "sheet closed" reply, and a render queued behind it gets
  one too. Predicted RED on destroy count 0.
- **T3c, T6 variant, T12, T16** have no explicit A3/§3 prediction; listed above.
