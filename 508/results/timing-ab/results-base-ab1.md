# Tile-leak measurement: base-ab1

- url: http://localhost:5313/
- worktree: <base checkout>
- head: 788e39bfe9c42b3260ea75e84a655e4574f9bc8c
- date: 2026-10-03T18:52:40.115Z

| scenario | run | checkpoint | chip | tile workers (live/ever) | fonts per tile | fonts settle ms (max) | tile heap MB | tile backing MB | live keys per tile | opens / closes per tile |
|---|---|---|---|---|---|---|---|---|---|---|
| rapid | 1 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 215 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| rapid | 1 | after-rapid | 1/2 | 5/5 | 15,10,10,10,15 | 212 | 103.1 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| rapid | 1 | after-away-and-back | 1/2 | 5/5 | 25,20,20,20,25 | 207 | 103.7 | 42 | 1,1,1,1,1 | 13,13,13,13,13 / 12,12,12,12,12 |
| rapid | 2 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 211 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| rapid | 2 | after-rapid | 1/2 | 5/5 | 15,10,10,10,15 | 215 | 103 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| rapid | 2 | after-away-and-back | 1/2 | 5/5 | 25,20,20,20,25 | 220 | 103.7 | 42 | 1,1,1,1,1 | 13,13,13,13,13 / 12,12,12,12,12 |
| zoomed | 1 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 225 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| zoomed | 1 | after-5-zoom-flips | 1/2 | 5/5 | 35,35,35,35,35 | 234 | 103.5 | 42 | 1,1,1,1,1 | 7,7,7,7,7 / 6,6,6,6,6 |
| zoomed | 2 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 207 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| zoomed | 2 | after-5-zoom-flips | 1/2 | 5/5 | 35,35,35,35,35 | 213 | 103.5 | 42 | 1,1,1,1,1 | 7,7,7,7,7 / 6,6,6,6,6 |
| rapidEarly | 1 | after-rapid | 1/2 | 5/5 | 5,5,5,5,5 | 211 | 102 | 42 | 1,1,1,1,1 | 7,7,7,7,7 / 6,6,6,6,6 |
| rapidEarly | 1 | after-away-and-back | 1/2 | 5/5 | 15,15,15,15,15 | 218 | 103.4 | 42 | 1,1,1,1,1 | 9,9,9,9,9 / 8,8,8,8,8 |
| rapidEarly | 2 | after-rapid | 2/2 | 5/5 | 10,5,5,5,5 | 218 | 55.6 | 42 | 1,1,1,1,1 | 7,7,7,7,7 / 7,7,7,7,7 |
| rapidEarly | 2 | after-away-and-back | 2/2 | 5/5 | 20,15,15,15,15 | 217 | 57 | 42 | 1,1,1,1,1 | 9,9,9,9,9 / 9,9,9,9,9 |

| scenario | run | conclusive | flip→idle median / max ms | exceptions | console errors | [tiles] msgs | log errors | closeBeforeReady | closeWithUnanswered (renders) | "sheet closed" replies | readyAfterClose | msgs dispatched while render / open pending | opens / sheet replies | error capture probe | renderTile for unopened key | idle timeouts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rapid | 1 | INCONCLUSIVE | 910.5 / 1085 | 0 | 0 | 2 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 65 / 65 | live | 2 | 0 |
| rapid | 2 | INCONCLUSIVE | 894 / 1058 | 0 | 0 | 2 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 65 / 65 | live | 2 | 0 |
| zoomed | 1 | INCONCLUSIVE | 868 / 1106 | 0 | 0 | 1 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 35 / 35 | live | 1 | 0 |
| zoomed | 2 | INCONCLUSIVE | 849.5 / 1069 | 0 | 0 | 1 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 35 / 35 | live | 1 | 0 |
| rapidEarly | 1 | yes | 866.5 / 1049 | 0 | 0 | 2 | 10 | 25 | 0 (0) | 0 | 25 | 0 / 25 | 45 / 45 | live | 2 | 0 |
| rapidEarly | 2 | yes | 874.5 / 1131 | 0 | 0 | 2 | 10 | 22 | 0 (0) | 0 | 22 | 0 / 27 | 45 / 45 | live | 2 | 0 |

## Screenshots

| scenario | run | step | chip | sha256 |
|---|---|---|---|---|
| rapid | 1 | after-load | 1/2 | `97069df37144398d` |
| rapid | 1 | after-rapid | 1/2 | `666955b9f88968f2` |
| rapid | 1 | after-away-and-back | 1/2 | `3bb1c504a87e9bc3` |
| rapid | 2 | after-load | 1/2 | `97069df37144398d` |
| rapid | 2 | after-rapid | 1/2 | `666955b9f88968f2` |
| rapid | 2 | after-away-and-back | 1/2 | `3bb1c504a87e9bc3` |
| zoomed | 1 | after-load | 1/2 | `97069df37144398d` |
| zoomed | 1 | zoomed-in-settled | 1/2 | `bd7b8cc0fe19f53d` |
| zoomed | 1 | after-5-zoom-flips | 1/2 | `999a84e0d7d9ef89` |
| zoomed | 2 | after-load | 1/2 | `97069df37144398d` |
| zoomed | 2 | zoomed-in-settled | 1/2 | `bd7b8cc0fe19f53d` |
| zoomed | 2 | after-5-zoom-flips | 1/2 | `999a84e0d7d9ef89` |
| rapidEarly | 1 | after-rapid | 1/2 | `97069df37144398d` |
| rapidEarly | 1 | after-away-and-back | 1/2 | `3bb1c504a87e9bc3` |
| rapidEarly | 2 | after-rapid | 2/2 | `45f4701cb324280e` |
| rapidEarly | 2 | after-away-and-back | 2/2 | `7c22126b30b251c2` |

| scenario | step | identical across runs |
|---|---|---|
| rapid | after-load | yes |
| rapid | after-rapid | yes |
| rapid | after-away-and-back | yes |
| zoomed | after-load | yes |
| zoomed | zoomed-in-settled | yes |
| zoomed | after-5-zoom-flips | yes |
| rapidEarly | after-rapid | no (2 distinct of 2; differing px vs run1 whole/canvas: 0/0, 162576/155170) |
| rapidEarly | after-away-and-back | no (2 distinct of 2; differing px vs run1 whole/canvas: 0/0, 162581/155170) |

## Scenario details

- rapid run1: before clicks {"opens":5,"sheetReady":5,"renderTile":14,"tilesOut":14}; 10 clicks over 459 ms, final chip 1/2, tile after last click: true, last click → last tile 1211 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 5/0, bbox 61x31+282+17)
- rapid run2: before clicks {"opens":5,"sheetReady":5,"renderTile":14,"tilesOut":14}; 10 clicks over 459 ms, final chip 1/2, tile after last click: true, last click → last tile 1148 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 5/0, bbox 61x31+282+17)
- rapidEarly run1: before clicks {"opens":0,"sheetReady":0,"renderTile":0,"tilesOut":0}; 10 clicks over 466 ms, final chip 1/2, tile after last click: true, last click → last tile 1219 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 391/0, bbox 383x875+282+17)
- rapidEarly run2: before clicks {"opens":0,"sheetReady":0,"renderTile":0,"tilesOut":0}; 10 clicks over 462 ms, final chip 2/2, tile after last click: true, last click → last tile 1010 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 393/0, bbox 382x875+283+17)
- zoomed run1: flip 0 ms after the first post-zoom renderTile; per cycle closeWithUnanswered(renders)/renderToClickMs: 0(0)/4, 0(0)/6, 0(0)/0, 0(0)/3, 0(0)/0
- zoomed run2: flip 0 ms after the first post-zoom renderTile; per cycle closeWithUnanswered(renders)/renderToClickMs: 0(0)/4, 0(0)/3, 0(0)/3, 0(0)/3, 0(0)/3
