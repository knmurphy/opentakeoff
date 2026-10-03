# Tile-leak measurement: fix-ab2

- url: http://localhost:5312/
- worktree: <fix checkout>
- head: 18343e98c74bf1df592b7c86f097fa3418eb836a
- date: 2026-10-03T18:59:29.207Z

| scenario | run | checkpoint | chip | tile workers (live/ever) | fonts per tile | fonts settle ms (max) | tile heap MB | tile backing MB | live keys per tile | opens / closes per tile |
|---|---|---|---|---|---|---|---|---|---|---|
| rapid | 1 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 220 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| rapid | 1 | after-rapid | 1/2 | 5/5 | 5,5,5,5,5 | 225 | 103.5 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| rapid | 1 | after-away-and-back | 1/2 | 5/5 | 5,5,5,5,5 | 211 | 104 | 42 | 1,1,1,1,1 | 13,13,13,13,13 / 12,12,12,12,12 |
| rapid | 2 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 223 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| rapid | 2 | after-rapid | 1/2 | 5/5 | 5,5,5,5,5 | 211 | 103.5 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| rapid | 2 | after-away-and-back | 1/2 | 5/5 | 5,5,5,5,5 | 213 | 104 | 42 | 1,1,1,1,1 | 13,13,13,13,13 / 12,12,12,12,12 |
| zoomed | 1 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 210 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| zoomed | 1 | after-5-zoom-flips | 1/2 | 5/5 | 5,5,5,5,5 | 209 | 103.5 | 42 | 1,1,1,1,1 | 7,7,7,7,7 / 6,6,6,6,6 |
| zoomed | 2 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 218 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| zoomed | 2 | after-5-zoom-flips | 1/2 | 5/5 | 5,5,5,5,5 | 209 | 103.5 | 42 | 1,1,1,1,1 | 7,7,7,7,7 / 6,6,6,6,6 |
| rapidEarly | 1 | after-rapid | 2/2 | 5/5 | 5,5,5,5,5 | 222 | 55.6 | 42 | 1,1,1,1,1 | 6,6,6,6,6 / 7,7,7,7,7 |
| rapidEarly | 1 | after-away-and-back | 2/2 | 5/5 | 5,5,5,5,5 | 233 | 56.9 | 42 | 1,1,1,1,1 | 8,8,8,8,8 / 9,9,9,9,9 |
| rapidEarly | 2 | after-rapid | 2/2 | 5/5 | 5,5,5,5,5 | 210 | 55.1 | 42 | 1,1,1,1,1 | 8,8,8,8,8 / 7,7,7,7,7 |
| rapidEarly | 2 | after-away-and-back | 2/2 | 5/5 | 5,5,5,5,5 | 215 | 56.9 | 42 | 1,1,1,1,1 | 10,10,10,10,10 / 9,9,9,9,9 |

| scenario | run | conclusive | flip→idle median / max ms | exceptions | console errors | [tiles] msgs | log errors | closeBeforeReady | closeWithUnanswered (renders) | "sheet closed" replies | readyAfterClose | msgs dispatched while render / open pending | opens / sheet replies | error capture probe | renderTile for unopened key | idle timeouts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rapid | 1 | INCONCLUSIVE | 901 / 1097 | 0 | 0 | 2 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 65 / 65 | live | 2 | 0 |
| rapid | 2 | INCONCLUSIVE | 900 / 1130 | 0 | 0 | 2 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 65 / 65 | live | 2 | 0 |
| zoomed | 1 | INCONCLUSIVE | 869 / 1077 | 0 | 0 | 1 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 35 / 35 | live | 1 | 0 |
| zoomed | 2 | INCONCLUSIVE | 852 / 1074 | 0 | 0 | 1 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 35 / 35 | live | 1 | 0 |
| rapidEarly | 1 | yes | 881 / 1153 | 0 | 0 | 2 | 10 | 15 | 0 (0) | 0 | 0 | 0 / 20 | 40 / 25 | live | 2 | 0 |
| rapidEarly | 2 | yes | 902 / 1194 | 0 | 0 | 2 | 10 | 31 | 0 (0) | 0 | 0 | 0 / 31 | 50 / 19 | live | 2 | 0 |

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
| zoomed | 1 | after-5-zoom-flips | 1/2 | `49ab2e5d1614aa05` |
| zoomed | 2 | after-load | 1/2 | `97069df37144398d` |
| zoomed | 2 | zoomed-in-settled | 1/2 | `bd7b8cc0fe19f53d` |
| zoomed | 2 | after-5-zoom-flips | 1/2 | `999a84e0d7d9ef89` |
| rapidEarly | 1 | after-rapid | 2/2 | `45f4701cb324280e` |
| rapidEarly | 1 | after-away-and-back | 2/2 | `7c22126b30b251c2` |
| rapidEarly | 2 | after-rapid | 2/2 | `45f4701cb324280e` |
| rapidEarly | 2 | after-away-and-back | 2/2 | `7c22126b30b251c2` |

| scenario | step | identical across runs |
|---|---|---|
| rapid | after-load | yes |
| rapid | after-rapid | yes |
| rapid | after-away-and-back | yes |
| zoomed | after-load | yes |
| zoomed | zoomed-in-settled | yes |
| zoomed | after-5-zoom-flips | no (2 distinct of 2; differing px vs run1 whole/canvas: 0/0, 5/0) |
| rapidEarly | after-rapid | yes |
| rapidEarly | after-away-and-back | yes |

## Scenario details

- rapid run1: before clicks {"opens":5,"sheetReady":5,"renderTile":14,"tilesOut":14}; 10 clicks over 457 ms, final chip 1/2, tile after last click: true, last click → last tile 1150 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 5/0, bbox 61x31+282+17)
- rapid run2: before clicks {"opens":5,"sheetReady":5,"renderTile":14,"tilesOut":14}; 10 clicks over 458 ms, final chip 1/2, tile after last click: true, last click → last tile 1165 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 5/0, bbox 61x31+282+17)
- rapidEarly run1: before clicks {"opens":0,"sheetReady":0,"renderTile":0,"tilesOut":0}; 10 clicks over 474 ms, final chip 2/2, tile after last click: true, last click → last tile 1013 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 393/0, bbox 382x875+283+17)
- rapidEarly run2: before clicks {"opens":0,"sheetReady":0,"renderTile":0,"tilesOut":0}; 10 clicks over 464 ms, final chip 2/2, tile after last click: true, last click → last tile 769 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 393/0, bbox 382x875+283+17)
- zoomed run1: flip 0 ms after the first post-zoom renderTile; per cycle closeWithUnanswered(renders)/renderToClickMs: 0(0)/1, 0(0)/0, 0(0)/0, 0(0)/4, 0(0)/0
- zoomed run2: flip 0 ms after the first post-zoom renderTile; per cycle closeWithUnanswered(renders)/renderToClickMs: 0(0)/0, 0(0)/3, 0(0)/0, 0(0)/0, 0(0)/1
