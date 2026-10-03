> Evidence for Kentucky-ai/opentakeoff#508. The fix was measured at `18343e98`. The PR head differs from it only in the CHANGELOG line, with the code commit `79adb60e` unchanged.
> Reproduce: run `npm ci` in `508/repro/`, start the app's dev server, then run `node measure-tile-leak.mjs --url http://localhost:PORT/ --worktree <checkout> --label <base|fix> --scenario all`.

# Tile-worker leak: base vs fix

- base: 788e39bf , run 12:34–12:42, results-base.json
- fix: fix/tile-worker-leak = 788e39bf + 79adb60e + 18343e98 , run 12:44–12:51 on Vite :5312, results-fix.json
- Same script, same default run counts (settled 3, rapid 2, rapidEarly 2, zoomed 2, phone 1, dark 2).
- Machine was shared and busy (load avg 13–21, many unrelated node processes), so timings were re-checked with an interleaved A/B (timing-ab/).

## Summary

| metric | base | fix | verdict |
|---|---|---|---|
| settled fonts/tile @ flips 0/10/30 | 5 / 55 / 155 | 5 / 5 / 5 (all 3 runs, all 5 workers) | fixed: flat at post-load value |
| settled tile heap after GC @ 0/10/30 (MB, 5 workers) | 101.5 / 104.5 / 105.5 | 101.5 / 105 / 106 | no improvement (+0.5 MB, noise) |
| settled tile ArrayBuffer backing (MB) | 42 | 42 | unchanged |
| settled browser RSS growth, flip 0→30 (process-wide, indicative) | +378 / +522 / +515 MB | +187 / +192 / +119 MB | lower, roughly half |
| settled flip→idle median/max (ms), first pass | 685/903, 684/924, 680/888 | 691/939, 715/1060, 776/1074 | looked slower, load drift (see A/B) |
| A/B flip→idle medians, rapid+zoomed+rapidEarly (ms), interleaved base,fix,base,fix | 849–911 | 767–902 | parity; no slowdown from destroy/clearGlobalCaches |
| phone: tile workers / fonts / respawn / watchdog msgs | 1 / 5→25→30 / no / 0 | 1 / 5→5→5 / no / 0 | fixed; waited 35.6 s after click, 31.9 s after last render |
| phone flip→idle median/max (ms) | 4970/7037 | 5499/7751 | +11% single run under load, not A/B-controlled |
| rapidEarly closeBeforeReady (run1/run2) | 14 / 11 | 30 / 21 | timing-dependent (A/B base 25/22/20/20 vs fix 15/20/15/31) |
| rapidEarly sheetReady posted for a closed generation | 14 / 11 (= every close-before-ready) | **0 / 0** (A/B: 0 in all 4 fix runs; base 25/22/20/20) | fixed |
| rapidEarly final sheet paints | yes (canvas identical to away-and-back) | yes, both runs, canvas identical (0 px) | ok |
| rapidEarly final chip | 1/2, 2/2 | 2/2, 2/2 | timing-dependent; base run2 also ended on 2/2 |
| sheetError replies / sheetErrorAfterClose / readyUnmatched | 0 / 0 / 0 | 0 / 0 / 0 | gate rejection never leaks as sheetError |
| "sheet closed" tileError replies | 0 | 0 | none needed in these scenarios |
| zoomed / rapid conclusive | INCONCLUSIVE (no render pending at close) | INCONCLUSIVE, same reason | still not exercised |
| dark | renders, renderTile dark:true | renders, all dark screenshots sha-identical to base | ok |
| real exceptions / console errors | 0 | 0 | ok (22 deliberate [probe] entries in each, error-capture probe live) |
| [tiles] warnings | 109, one text | 109, identical text: "detail crop failed — keeping the previous crop: Error: sheet not open" | no new warning text |
| log-entry errors (10 per run) | cloudflareinsights CORS + probe | same texts and counts | unchanged |
| per-worker opens/replies/closes/live at end | opens = replies, 1 live key | settled/rapid/zoomed/phone/dark identical to base; rapidEarly opens − replies = closeBeforeReady exactly | consistent |

closeNotOpen (a closeSheet the IO hook saw with no matching open) shows up in both builds during rapidEarly: base-ab1 run2 5, fix-ab1 5/5, fix-ab2 run1 10. It is a measurement-hook artifact present on base, not something the fix introduced.

## Screenshots

29 of 30 fix screenshots are sha256-identical to base. The exception is zoomed run2 after-5-zoom-flips: a different sha but `compare -metric AE` = 0 px against base, so only the PNG encoding differs. Both fix rapidEarly runs match base run2 (2/2, AF600) byte-for-byte. Base run1 ended on 1/2, a legitimate timing difference. I viewed fix settled after-30-flips (full AF101 plan), dark after-2-flips (inverted AF101, fully rendered), phone after-watchdog-wait (AF600 schedules, fully rendered), and rapidEarly after-away-and-back (AF600, fully rendered). None had blank or partial tiles.

Representative: fix-settled-run1-after-30-flips.png, fix-dark-run1-after-2-flips-dark.png, fix-phone-run1-after-5-flips-watchdog-wait.png, fix-rapidEarly-run1-after-away-and-back.png.

## Timing A/B (timing-ab/run-ab.log, results-{base,fix}-ab{1,2}.json)

| run | load avg at start | rapid med/max | zoomed med/max | rapidEarly med/max |
|---|---|---|---|---|
| base-ab1 | 18.5 | 911/1085, 894/1058 | 868/1106, 850/1069 | 867/1049, 875/1131 |
| fix-ab1 | 12.8 | 874/1081, 895/1063 | 785/1076, 767/989 | 898/1147, 881/1148 |
| base-ab2 | 14.9 | 875/1053, 880/1085 | 860/1082, 859/1086 | 901/1196, 897/1173 |
| fix-ab2 | 19.4 | 901/1097, 900/1130 | 869/1077, 852/1074 | 881/1153, 902/1194 |

---

# Tile-leak: base vs fix

- base: 788e39bfe9c42b3260ea75e84a655e4574f9bc8c (upstream/main) 2026-10-03T18:34:57.381Z
- fix: 18343e98c74bf1df592b7c86f097fa3418eb836a (fix/tile-worker-leak) 2026-10-03T18:43:37.049Z

## Checkpoints (per run)

| scenario | run | checkpoint | base fonts/tile | fix fonts/tile | base heap MB | fix heap MB | base backing MB | fix backing MB | base opens/closes | fix opens/closes | fix live keys | base chip | fix chip | fix tile workers live/ever |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| settled | 1 | flips=0 | 5,5,5,5,5 | 5,5,5,5,5 | 101.5 | 101.5 | 42 | 42 | 1/0 | 1,1,1,1,1/0,0,0,0,0 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| settled | 1 | flips=10 | 55,55,55,55,55 | 5,5,5,5,5 | 104.5 | 105 | 42 | 42 | 11/10 | 11,11,11,11,11/10,10,10,10,10 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| settled | 1 | flips=30 | 155,155,155,155,155 | 5,5,5,5,5 | 105.5 | 106 | 42 | 42 | 31/30 | 31,31,31,31,31/30,30,30,30,30 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| settled | 2 | flips=0 | 5,5,5,5,5 | 5,5,5,5,5 | 101.5 | 101.5 | 42 | 42 | 1/0 | 1,1,1,1,1/0,0,0,0,0 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| settled | 2 | flips=10 | 55,55,55,55,55 | 5,5,5,5,5 | 104.5 | 105 | 42 | 42 | 11/10 | 11,11,11,11,11/10,10,10,10,10 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| settled | 2 | flips=30 | 155,155,155,155,155 | 5,5,5,5,5 | 105.5 | 106 | 42 | 42 | 31/30 | 31,31,31,31,31/30,30,30,30,30 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| settled | 3 | flips=0 | 5,5,5,5,5 | 5,5,5,5,5 | 101.5 | 101.5 | 42 | 42 | 1/0 | 1,1,1,1,1/0,0,0,0,0 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| settled | 3 | flips=10 | 55,55,55,55,55 | 5,5,5,5,5 | 104.5 | 105 | 42 | 42 | 11/10 | 11,11,11,11,11/10,10,10,10,10 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| settled | 3 | flips=30 | 155,155,155,155,155 | 5,5,5,5,5 | 105.5 | 106 | 42 | 42 | 31/30 | 31,31,31,31,31/30,30,30,30,30 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| rapid | 1 | flips=0 | 5,5,5,5,5 | 5,5,5,5,5 | 101.5 | 101.5 | 42 | 42 | 1/0 | 1,1,1,1,1/0,0,0,0,0 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| rapid | 1 | after-rapid | 15,10,10,10,15 | 5,5,5,5,5 | 103 | 103.5 | 42 | 42 | 11/10 | 11,11,11,11,11/10,10,10,10,10 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| rapid | 1 | after-away-and-back | 25,20,20,20,25 | 5,5,5,5,5 | 103.7 | 104 | 42 | 42 | 13/12 | 13,13,13,13,13/12,12,12,12,12 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| rapid | 2 | flips=0 | 5,5,5,5,5 | 5,5,5,5,5 | 101.5 | 101.5 | 42 | 42 | 1/0 | 1,1,1,1,1/0,0,0,0,0 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| rapid | 2 | after-rapid | 15,10,10,10,15 | 5,5,5,5,5 | 103 | 103.5 | 42 | 42 | 11/10 | 11,11,11,11,11/10,10,10,10,10 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| rapid | 2 | after-away-and-back | 25,20,20,20,25 | 5,5,5,5,5 | 103.7 | 104 | 42 | 42 | 13/12 | 13,13,13,13,13/12,12,12,12,12 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| rapidEarly | 1 | after-rapid | 10,10,5,5,5 | 5,5,5,5,5 | 102.7 | 55.1 | 42 | 42 | 9/8 | 8,8,8,8,8/7,7,7,7,7 | 1,1,1,1,1 | 1/2 | 2/2 | 5/5 |
| rapidEarly | 1 | after-away-and-back | 20,20,15,15,15 | 5,5,5,5,5 | 103.5 | 56.9 | 42 | 42 | 11/10 | 10,10,10,10,10/9,9,9,9,9 | 1,1,1,1,1 | 1/2 | 2/2 | 5/5 |
| rapidEarly | 2 | after-rapid | 10,5,5,5,5 | 5,5,5,5,5 | 55.6 | 55.6 | 42 | 42 | 8/7 | 8,8,8,8,8/7,7,7,7,7 | 1,1,1,1,1 | 2/2 | 2/2 | 5/5 |
| rapidEarly | 2 | after-away-and-back | 20,15,15,15,15 | 5,5,5,5,5 | 57 | 56.9 | 42 | 42 | 10/9 | 10,10,10,10,10/9,9,9,9,9 | 1,1,1,1,1 | 2/2 | 2/2 | 5/5 |
| zoomed | 1 | flips=0 | 5,5,5,5,5 | 5,5,5,5,5 | 101.5 | 101.5 | 42 | 42 | 1/0 | 1,1,1,1,1/0,0,0,0,0 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| zoomed | 1 | after-5-zoom-flips | 35,35,35,35,35 | 5,5,5,5,5 | 103.5 | 103.5 | 42 | 42 | 7/6 | 7,7,7,7,7/6,6,6,6,6 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| zoomed | 2 | flips=0 | 5,5,5,5,5 | 5,5,5,5,5 | 101.5 | 101.5 | 42 | 42 | 1/0 | 1,1,1,1,1/0,0,0,0,0 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| zoomed | 2 | after-5-zoom-flips | 35,35,35,35,35 | 5,5,5,5,5 | 103.5 | 103.5 | 42 | 42 | 7/6 | 7,7,7,7,7/6,6,6,6,6 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| phone | 1 | flips=0 | 5 | 5 | 20.4 | 20.4 | 8.4 | 8.4 | 1/0 | 1/0 | 1 | 1/2 | 1/2 | 1/1 |
| phone | 1 | flips=4 | 25 | 5 | 20.7 | 20.7 | 8.4 | 8.4 | 5/4 | 5/4 | 1 | 1/2 | 1/2 | 1/1 |
| phone | 1 | flips=5+watchdog-wait | 30 | 5 | 11.4 | 11.5 | 8.4 | 8.4 | 6/5 | 6/5 | 1 | 2/2 | 2/2 | 1/1 |
| dark | 1 | dark flips=0 | 5,5,5,5,5 | 5,5,5,5,5 | 101.5 | 101.5 | 42 | 42 | 1/0 | 1,1,1,1,1/0,0,0,0,0 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| dark | 1 | dark flips=2 | 15,15,15,15,15 | 5,5,5,5,5 | 103 | 103 | 42 | 42 | 3/2 | 3,3,3,3,3/2,2,2,2,2 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| dark | 2 | dark flips=0 | 5,5,5,5,5 | 5,5,5,5,5 | 101.5 | 101.5 | 42 | 42 | 1/0 | 1,1,1,1,1/0,0,0,0,0 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |
| dark | 2 | dark flips=2 | 15,15,15,15,15 | 5,5,5,5,5 | 103 | 103 | 42 | 42 | 3/2 | 3,3,3,3,3/2,2,2,2,2 | 1,1,1,1,1 | 1/2 | 1/2 | 5/5 |

## Per-run IO / errors / timing

| scenario | run | flip→idle med/max base | fix | exceptions b/f | console err b/f | [tiles] b/f | log err b/f | closeBeforeReady b/f | readyAfterClose b/f | readyUnmatched b/f | sheetClosedReplies b/f | closeWithUnanswered b/f | conclusive b/f |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| settled | 1 | 685/903 | 690.5/939 | 0/0 | 0/0 | 30/30 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | true/true |
| settled | 2 | 683.5/924 | 714.5/1060 | 0/0 | 0/0 | 30/30 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | true/true |
| settled | 3 | 679.5/888 | 775.5/1074 | 0/0 | 0/0 | 30/30 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | true/true |
| rapid | 1 | 721.5/898 | 878.5/1061 | 0/0 | 0/0 | 2/2 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | false/false |
| rapid | 2 | 717/874 | 892.5/1082 | 0/0 | 0/0 | 2/2 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | false/false |
| rapidEarly | 1 | 723.5/883 | 888/1164 | 0/0 | 0/0 | 2/2 | 10/10 | 14/30 | 14/0 | 0/0 | 0/0 | 0/0 | true/true |
| rapidEarly | 2 | 728.5/941 | 888/1154 | 0/0 | 0/0 | 2/2 | 10/10 | 11/21 | 11/0 | 0/0 | 0/0 | 0/0 | true/true |
| zoomed | 1 | 704.5/890 | 865.5/1070 | 0/0 | 0/0 | 1/1 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | false/false |
| zoomed | 2 | 702/889 | 849.5/1054 | 0/0 | 0/0 | 1/1 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | false/false |
| phone | 1 | 4970/7037 | 5498.5/7751 | 0/0 | 0/0 | 5/5 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | true/true |
| dark | 1 | 826/932 | 872/1062 | 0/0 | 0/0 | 2/2 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | true/true |
| dark | 2 | 876.5/1061 | 928/1126 | 0/0 | 0/0 | 2/2 | 10/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | true/true |

## [tiles] message texts (all scenarios)

| text | base | fix |
|---|---|---|
| warning: [tiles] detail crop failed — keeping the previous crop: Error: sheet not open | 109 | 109 |

## Log-entry errors (all scenarios)

| text | base | fix |
|---|---|---|
| Access to XMLHttpRequest at 'https://cloudflareinsights.com/cdn-cgi/rum' from origin 'http://localhost:PORT' h | 36 | 36 |
| Failed to load resource: net::ERR_FAILED | 60 | 60 |
| Access to resource at 'https://cloudflareinsights.com/cdn-cgi/rum' from origin 'http://localhost:PORT' has bee | 24 | 24 |
| [probe] tile console.error | 11 | 11 |
| Uncaught Error: [probe] tile throw | 11 | 11 |

Exception/console-error entries: fix 0 real + 22 deliberate error-capture probe entries; base 0 real + 22 probe.

## Per-worker opens / sheet replies / closes / live keys (end of run)

| scenario | run | base | fix |
|---|---|---|---|
| settled | 1 | 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 | 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 |
| settled | 2 | 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 | 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 |
| settled | 3 | 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 | 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 31/31/30/1 |
| rapid | 1 | 13/13/12/1 13/13/12/1 13/13/12/1 13/13/12/1 13/13/12/1 | 13/13/12/1 13/13/12/1 13/13/12/1 13/13/12/1 13/13/12/1 |
| rapid | 2 | 13/13/12/1 13/13/12/1 13/13/12/1 13/13/12/1 13/13/12/1 | 13/13/12/1 13/13/12/1 13/13/12/1 13/13/12/1 13/13/12/1 |
| rapidEarly | 1 | 11/11/10/1 11/11/10/1 11/11/10/1 11/11/10/1 11/11/10/1 | 10/4/9/1 10/4/9/1 10/4/9/1 10/4/9/1 10/4/9/1 |
| rapidEarly | 2 | 10/10/9/1 10/10/9/1 10/10/9/1 10/10/9/1 10/10/9/1 | 10/6/9/1 10/5/9/1 10/6/9/1 10/6/9/1 10/6/9/1 |
| zoomed | 1 | 7/7/6/1 7/7/6/1 7/7/6/1 7/7/6/1 7/7/6/1 | 7/7/6/1 7/7/6/1 7/7/6/1 7/7/6/1 7/7/6/1 |
| zoomed | 2 | 7/7/6/1 7/7/6/1 7/7/6/1 7/7/6/1 7/7/6/1 | 7/7/6/1 7/7/6/1 7/7/6/1 7/7/6/1 7/7/6/1 |
| phone | 1 | 6/6/5/1 | 6/6/5/1 |
| dark | 1 | 3/3/2/1 3/3/2/1 3/3/2/1 3/3/2/1 3/3/2/1 | 3/3/2/1 3/3/2/1 3/3/2/1 3/3/2/1 3/3/2/1 |
| dark | 2 | 3/3/2/1 3/3/2/1 3/3/2/1 3/3/2/1 3/3/2/1 | 3/3/2/1 3/3/2/1 3/3/2/1 3/3/2/1 3/3/2/1 |

## Scenario details (fix)

- settled run1: {"idleTimeouts":0}
- settled run2: {"idleTimeouts":0}
- settled run3: {"idleTimeouts":0}
- rapid run1: {"finalChip":"1/2","clicks":10,"clickSpanMs":464,"tileAfterLastClick":true,"settleOk":true,"lastClickToLastTileMs":1339,"finalSheetPaints":{"matchesAwayAndBack":false,"chipEqual":true,"diffVsAwayAndBack":{"whole":{"pixels":5,"bbox":"61x31+282+17"},"canvas":{"pixels":0,"bbox":null}},"canvasIdentical":true},"ioBeforeClicks":{"opens":5,"sheetReady":5,"renderTile":14,"tilesOut":14},"idleTimeouts":0}
- rapid run2: {"finalChip":"1/2","clicks":10,"clickSpanMs":460,"tileAfterLastClick":true,"settleOk":true,"lastClickToLastTileMs":1149,"finalSheetPaints":{"matchesAwayAndBack":false,"chipEqual":true,"diffVsAwayAndBack":{"whole":{"pixels":5,"bbox":"61x31+282+17"},"canvas":{"pixels":0,"bbox":null}},"canvasIdentical":true},"ioBeforeClicks":{"opens":5,"sheetReady":5,"renderTile":14,"tilesOut":14},"idleTimeouts":0}
- rapidEarly run1: {"finalChip":"2/2","clicks":10,"clickSpanMs":463,"tileAfterLastClick":true,"settleOk":true,"lastClickToLastTileMs":727,"finalSheetPaints":{"matchesAwayAndBack":false,"chipEqual":true,"diffVsAwayAndBack":{"whole":{"pixels":393,"bbox":"382x875+283+17"},"canvas":{"pixels":0,"bbox":null}},"canvasIdentical":true},"ioBeforeClicks":{"opens":0,"sheetReady":0,"renderTile":0,"tilesOut":0},"idleTimeouts":0}
- rapidEarly run2: {"finalChip":"2/2","clicks":10,"clickSpanMs":469,"tileAfterLastClick":true,"settleOk":true,"lastClickToLastTileMs":885,"finalSheetPaints":{"matchesAwayAndBack":false,"chipEqual":true,"diffVsAwayAndBack":{"whole":{"pixels":393,"bbox":"382x875+283+17"},"canvas":{"pixels":0,"bbox":null}},"canvasIdentical":true},"ioBeforeClicks":{"opens":0,"sheetReady":0,"renderTile":0,"tilesOut":0},"idleTimeouts":0}
- zoomed run1: {"zoomFlipDelayMs":0,"cycles":[{"zoomToRenderMs":308,"renderToClickMs":3,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":2},{"zoomToRenderMs":316,"renderToClickMs":3,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":1},{"zoomToRenderMs":310,"renderToClickMs":3,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":1},{"zoomToRenderMs":318,"renderToClickMs":3,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":1},{"zoomToRenderMs":325,"renderToClickMs":4,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":1}],"idleTimeouts":0}
- zoomed run2: {"zoomFlipDelayMs":0,"cycles":[{"zoomToRenderMs":313,"renderToClickMs":4,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":2},{"zoomToRenderMs":320,"renderToClickMs":4,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":1},{"zoomToRenderMs":322,"renderToClickMs":3,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":1},{"zoomToRenderMs":319,"renderToClickMs":0,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":1},{"zoomToRenderMs":317,"renderToClickMs":0,"closeWithUnanswered":0,"closeUnansweredRenders":0,"closeBeforeReady":0,"cancels":1}],"idleTimeouts":0}
- phone run1: {"tileWorkersAfterLoad":1,"assertOneTileWorker":true,"respawned":false,"watchdogWarnings":[],"pendingRightAfterFlip":0,"waitedMs":35555,"idleAfterFlipMs":4939,"gapAfterLastRenderMs":31916,"idleTimeouts":0}
- dark run1: {"darkLocalStorage":"1","darkButtonTitle":1,"idleTimeouts":0}
- dark run2: {"darkLocalStorage":"1","darkButtonTitle":1,"idleTimeouts":0}

## Screenshots: fix vs base (sha256; AE pixel count vs each distinct base variant when sha differs)

| scenario | run | step | fix chip | fix sha | same sha as base run | AE vs base variants |
|---|---|---|---|---|---|---|
| settled | 1 | after-load | 1/2 | `97069df37144398d` | run1,run2,run3 |  |
| settled | 1 | after-30-flips | 1/2 | `3bb1c504a87e9bc3` | run1,run2,run3 |  |
| settled | 2 | after-load | 1/2 | `97069df37144398d` | run1,run2,run3 |  |
| settled | 2 | after-30-flips | 1/2 | `3bb1c504a87e9bc3` | run1,run2,run3 |  |
| settled | 3 | after-load | 1/2 | `97069df37144398d` | run1,run2,run3 |  |
| settled | 3 | after-30-flips | 1/2 | `3bb1c504a87e9bc3` | run1,run2,run3 |  |
| rapid | 1 | after-load | 1/2 | `97069df37144398d` | run1,run2 |  |
| rapid | 1 | after-rapid | 1/2 | `666955b9f88968f2` | run1,run2 |  |
| rapid | 1 | after-away-and-back | 1/2 | `3bb1c504a87e9bc3` | run1,run2 |  |
| rapid | 2 | after-load | 1/2 | `97069df37144398d` | run1,run2 |  |
| rapid | 2 | after-rapid | 1/2 | `666955b9f88968f2` | run1,run2 |  |
| rapid | 2 | after-away-and-back | 1/2 | `3bb1c504a87e9bc3` | run1,run2 |  |
| rapidEarly | 1 | after-rapid | 2/2 | `45f4701cb324280e` | run2 |  |
| rapidEarly | 1 | after-away-and-back | 2/2 | `7c22126b30b251c2` | run2 |  |
| rapidEarly | 2 | after-rapid | 2/2 | `45f4701cb324280e` | run2 |  |
| rapidEarly | 2 | after-away-and-back | 2/2 | `7c22126b30b251c2` | run2 |  |
| zoomed | 1 | after-load | 1/2 | `97069df37144398d` | run1,run2 |  |
| zoomed | 1 | zoomed-in-settled | 1/2 | `bd7b8cc0fe19f53d` | run1,run2 |  |
| zoomed | 1 | after-5-zoom-flips | 1/2 | `999a84e0d7d9ef89` | run1,run2 |  |
| zoomed | 2 | after-load | 1/2 | `97069df37144398d` | run1,run2 |  |
| zoomed | 2 | zoomed-in-settled | 1/2 | `bd7b8cc0fe19f53d` | run1,run2 |  |
| zoomed | 2 | after-5-zoom-flips | 1/2 | `49ab2e5d1614aa05` | none | base-zoomed-run2-after-5-zoom-flips.png (1/2): 0 |
| phone | 1 | after-load | 1/2 | `aa4248a5eda0be60` | run1 |  |
| phone | 1 | after-5-flips-watchdog-wait | 2/2 | `844b6e4cfde8e38d` | run1 |  |
| dark | 1 | after-load | 1/2 | `97069df37144398d` | run1,run2 |  |
| dark | 1 | after-dark-toggle | 1/2 | `0cd1d9024e44794d` | run1,run2 |  |
| dark | 1 | after-2-flips-dark | 1/2 | `4a84692f71b6f77e` | run1,run2 |  |
| dark | 2 | after-load | 1/2 | `97069df37144398d` | run1,run2 |  |
| dark | 2 | after-dark-toggle | 1/2 | `0cd1d9024e44794d` | run1,run2 |  |
| dark | 2 | after-2-flips-dark | 1/2 | `4a84692f71b6f77e` | run1,run2 |  |
