# Tile-leak measurement: base

- url: http://localhost:5311/
- worktree: <base checkout>
- head: 788e39bfe9c42b3260ea75e84a655e4574f9bc8c
- date: 2026-10-03T18:34:57.381Z

| scenario | run | checkpoint | chip | tile workers (live/ever) | fonts per tile | fonts settle ms (max) | tile heap MB | tile backing MB | live keys per tile | opens / closes per tile |
|---|---|---|---|---|---|---|---|---|---|---|
| settled | 1 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 208 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| settled | 1 | flips=10 | 1/2 | 5/5 | 55,55,55,55,55 | 205 | 104.5 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| settled | 1 | flips=30 | 1/2 | 5/5 | 155,155,155,155,155 | 207 | 105.5 | 42 | 1,1,1,1,1 | 31,31,31,31,31 / 30,30,30,30,30 |
| settled | 2 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 206 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| settled | 2 | flips=10 | 1/2 | 5/5 | 55,55,55,55,55 | 207 | 104.5 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| settled | 2 | flips=30 | 1/2 | 5/5 | 155,155,155,155,155 | 207 | 105.5 | 42 | 1,1,1,1,1 | 31,31,31,31,31 / 30,30,30,30,30 |
| settled | 3 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 207 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| settled | 3 | flips=10 | 1/2 | 5/5 | 55,55,55,55,55 | 207 | 104.5 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| settled | 3 | flips=30 | 1/2 | 5/5 | 155,155,155,155,155 | 207 | 105.5 | 42 | 1,1,1,1,1 | 31,31,31,31,31 / 30,30,30,30,30 |
| rapid | 1 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 207 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| rapid | 1 | after-rapid | 1/2 | 5/5 | 15,10,10,10,15 | 206 | 103 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| rapid | 1 | after-away-and-back | 1/2 | 5/5 | 25,20,20,20,25 | 206 | 103.7 | 42 | 1,1,1,1,1 | 13,13,13,13,13 / 12,12,12,12,12 |
| rapid | 2 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 206 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| rapid | 2 | after-rapid | 1/2 | 5/5 | 15,10,10,10,15 | 207 | 103 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| rapid | 2 | after-away-and-back | 1/2 | 5/5 | 25,20,20,20,25 | 206 | 103.7 | 42 | 1,1,1,1,1 | 13,13,13,13,13 / 12,12,12,12,12 |
| rapidEarly | 1 | after-rapid | 1/2 | 5/5 | 10,10,5,5,5 | 207 | 102.7 | 42 | 1,1,1,1,1 | 9,9,9,9,9 / 8,8,8,8,8 |
| rapidEarly | 1 | after-away-and-back | 1/2 | 5/5 | 20,20,15,15,15 | 207 | 103.5 | 42 | 1,1,1,1,1 | 11,11,11,11,11 / 10,10,10,10,10 |
| rapidEarly | 2 | after-rapid | 2/2 | 5/5 | 10,5,5,5,5 | 207 | 55.6 | 42 | 1,1,1,1,1 | 8,8,8,8,8 / 7,7,7,7,7 |
| rapidEarly | 2 | after-away-and-back | 2/2 | 5/5 | 20,15,15,15,15 | 207 | 57 | 42 | 1,1,1,1,1 | 10,10,10,10,10 / 9,9,9,9,9 |
| zoomed | 1 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 206 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| zoomed | 1 | after-5-zoom-flips | 1/2 | 5/5 | 35,35,35,35,35 | 206 | 103.5 | 42 | 1,1,1,1,1 | 7,7,7,7,7 / 6,6,6,6,6 |
| zoomed | 2 | flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 207 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| zoomed | 2 | after-5-zoom-flips | 1/2 | 5/5 | 35,35,35,35,35 | 206 | 103.5 | 42 | 1,1,1,1,1 | 7,7,7,7,7 / 6,6,6,6,6 |
| phone | 1 | flips=0 | 1/2 | 1/1 | 5 | 205 | 20.4 | 8.4 | 1 | 1 / 0 |
| phone | 1 | flips=4 | 1/2 | 1/1 | 25 | 206 | 20.7 | 8.4 | 1 | 5 / 4 |
| phone | 1 | flips=5+watchdog-wait | 2/2 | 1/1 | 30 | 208 | 11.4 | 8.4 | 1 | 6 / 5 |
| dark | 1 | dark flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 208 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| dark | 1 | dark flips=2 | 1/2 | 5/5 | 15,15,15,15,15 | 206 | 103 | 42 | 1,1,1,1,1 | 3,3,3,3,3 / 2,2,2,2,2 |
| dark | 2 | dark flips=0 | 1/2 | 5/5 | 5,5,5,5,5 | 220 | 101.5 | 42 | 1,1,1,1,1 | 1,1,1,1,1 / 0,0,0,0,0 |
| dark | 2 | dark flips=2 | 1/2 | 5/5 | 15,15,15,15,15 | 210 | 103 | 42 | 1,1,1,1,1 | 3,3,3,3,3 / 2,2,2,2,2 |

| scenario | run | conclusive | flip→idle median / max ms | exceptions | console errors | [tiles] msgs | log errors | closeBeforeReady | closeWithUnanswered (renders) | "sheet closed" replies | readyAfterClose | msgs dispatched while render / open pending | opens / sheet replies | error capture probe | renderTile for unopened key | idle timeouts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| settled | 1 | yes | 685 / 903 | 0 | 0 | 30 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 155 / 155 | live | 30 | 0 |
| settled | 2 | yes | 683.5 / 924 | 0 | 0 | 30 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 155 / 155 | live | 30 | 0 |
| settled | 3 | yes | 679.5 / 888 | 0 | 0 | 30 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 155 / 155 | live | 30 | 0 |
| rapid | 1 | INCONCLUSIVE | 721.5 / 898 | 0 | 0 | 2 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 65 / 65 | live | 2 | 0 |
| rapid | 2 | INCONCLUSIVE | 717 / 874 | 0 | 0 | 2 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 65 / 65 | live | 2 | 0 |
| rapidEarly | 1 | yes | 723.5 / 883 | 0 | 0 | 2 | 10 | 14 | 0 (0) | 0 | 14 | 0 / 14 | 55 / 55 | live | 2 | 0 |
| rapidEarly | 2 | yes | 728.5 / 941 | 0 | 0 | 2 | 10 | 11 | 0 (0) | 0 | 11 | 0 / 11 | 50 / 50 | live | 2 | 0 |
| zoomed | 1 | INCONCLUSIVE | 704.5 / 890 | 0 | 0 | 1 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 35 / 35 | live | 1 | 0 |
| zoomed | 2 | INCONCLUSIVE | 702 / 889 | 0 | 0 | 1 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 35 / 35 | live | 1 | 0 |
| phone | 1 | yes | 4970 / 7037 | 0 | 0 | 5 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 6 / 6 | n/a | 5 | 0 |
| dark | 1 | yes | 826 / 932 | 0 | 0 | 2 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 15 / 15 | live | 2 | 0 |
| dark | 2 | yes | 876.5 / 1061 | 0 | 0 | 2 | 10 | 0 | 0 (0) | 0 | 0 | 0 / 0 | 15 / 15 | live | 2 | 0 |

## Screenshots

| scenario | run | step | chip | sha256 |
|---|---|---|---|---|
| settled | 1 | after-load | 1/2 | `97069df37144398d` |
| settled | 1 | after-30-flips | 1/2 | `3bb1c504a87e9bc3` |
| settled | 2 | after-load | 1/2 | `97069df37144398d` |
| settled | 2 | after-30-flips | 1/2 | `3bb1c504a87e9bc3` |
| settled | 3 | after-load | 1/2 | `97069df37144398d` |
| settled | 3 | after-30-flips | 1/2 | `3bb1c504a87e9bc3` |
| rapid | 1 | after-load | 1/2 | `97069df37144398d` |
| rapid | 1 | after-rapid | 1/2 | `666955b9f88968f2` |
| rapid | 1 | after-away-and-back | 1/2 | `3bb1c504a87e9bc3` |
| rapid | 2 | after-load | 1/2 | `97069df37144398d` |
| rapid | 2 | after-rapid | 1/2 | `666955b9f88968f2` |
| rapid | 2 | after-away-and-back | 1/2 | `3bb1c504a87e9bc3` |
| rapidEarly | 1 | after-rapid | 1/2 | `97069df37144398d` |
| rapidEarly | 1 | after-away-and-back | 1/2 | `3bb1c504a87e9bc3` |
| rapidEarly | 2 | after-rapid | 2/2 | `45f4701cb324280e` |
| rapidEarly | 2 | after-away-and-back | 2/2 | `7c22126b30b251c2` |
| zoomed | 1 | after-load | 1/2 | `97069df37144398d` |
| zoomed | 1 | zoomed-in-settled | 1/2 | `bd7b8cc0fe19f53d` |
| zoomed | 1 | after-5-zoom-flips | 1/2 | `999a84e0d7d9ef89` |
| zoomed | 2 | after-load | 1/2 | `97069df37144398d` |
| zoomed | 2 | zoomed-in-settled | 1/2 | `bd7b8cc0fe19f53d` |
| zoomed | 2 | after-5-zoom-flips | 1/2 | `999a84e0d7d9ef89` |
| phone | 1 | after-load | 1/2 | `aa4248a5eda0be60` |
| phone | 1 | after-5-flips-watchdog-wait | 2/2 | `844b6e4cfde8e38d` |
| dark | 1 | after-load | 1/2 | `97069df37144398d` |
| dark | 1 | after-dark-toggle | 1/2 | `0cd1d9024e44794d` |
| dark | 1 | after-2-flips-dark | 1/2 | `4a84692f71b6f77e` |
| dark | 2 | after-load | 1/2 | `97069df37144398d` |
| dark | 2 | after-dark-toggle | 1/2 | `0cd1d9024e44794d` |
| dark | 2 | after-2-flips-dark | 1/2 | `4a84692f71b6f77e` |

| scenario | step | identical across runs |
|---|---|---|
| settled | after-load | yes |
| settled | after-30-flips | yes |
| rapid | after-load | yes |
| rapid | after-rapid | yes |
| rapid | after-away-and-back | yes |
| rapidEarly | after-rapid | no (2 distinct of 2; differing px vs run1 whole/canvas: 0/0, 162576/155170) |
| rapidEarly | after-away-and-back | no (2 distinct of 2; differing px vs run1 whole/canvas: 0/0, 162581/155170) |
| zoomed | after-load | yes |
| zoomed | zoomed-in-settled | yes |
| zoomed | after-5-zoom-flips | yes |
| phone | after-load | n/a (1 run) |
| phone | after-5-flips-watchdog-wait | n/a (1 run) |
| dark | after-load | yes |
| dark | after-dark-toggle | yes |
| dark | after-2-flips-dark | yes |

## Scenario details

- rapid run1: before clicks {"opens":5,"sheetReady":5,"renderTile":14,"tilesOut":14}; 10 clicks over 462 ms, final chip 1/2, tile after last click: true, last click → last tile 918 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 5/0, bbox 61x31+282+17)
- rapid run2: before clicks {"opens":5,"sheetReady":5,"renderTile":14,"tilesOut":14}; 10 clicks over 461 ms, final chip 1/2, tile after last click: true, last click → last tile 928 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 5/0, bbox 61x31+282+17)
- rapidEarly run1: before clicks {"opens":0,"sheetReady":0,"renderTile":0,"tilesOut":0}; 10 clicks over 462 ms, final chip 1/2, tile after last click: true, last click → last tile 1085 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 391/0, bbox 383x875+282+17)
- rapidEarly run2: before clicks {"opens":0,"sheetReady":0,"renderTile":0,"tilesOut":0}; 10 clicks over 458 ms, final chip 2/2, tile after last click: true, last click → last tile 571 ms, final sheet canvas identical to away-and-back: true (whole-frame sha equal: false; differing px whole/canvas: 393/0, bbox 382x875+283+17)
- zoomed run1: flip 0 ms after the first post-zoom renderTile; per cycle closeWithUnanswered(renders)/renderToClickMs: 0(0)/6, 0(0)/7, 0(0)/6, 0(0)/8, 0(0)/4
- zoomed run2: flip 0 ms after the first post-zoom renderTile; per cycle closeWithUnanswered(renders)/renderToClickMs: 0(0)/8, 0(0)/6, 0(0)/6, 0(0)/7, 0(0)/4
- phone run1: UA Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1; 1 tile worker: true; respawned: false; watchdog warnings: 0; pending right after last flip: 0; flip→idle 4583 ms; waited 35707 ms after the click, 32406 ms after the last renderTile
- dark run1: opentakeoff_dark=1, renderTile with dark:true = 44
- dark run2: opentakeoff_dark=1, renderTile with dark:true = 44
