#!/usr/bin/env python3
"""A2 addendum — do the bench gates added AFTER the evidence pack was written
actually catch anything the pack-era bench let through?

Each perturbation is applied to a pristine worktree, `npm run bench` is run, the
exit code is recorded, and the worktree is restored with `git checkout -- .`
(asserted clean before and after every case). Run it against BOTH

    94a5d46  the state the pack's A2 table was measured on   (label PACK)
    7650f68  the post-fix head                                (label POST)

and the interesting cell is PACK exit 0 / POST exit 1: a real defect the pack-era
bench called green.

Three gates were added by audit F6 / the fix wave. For each, an ISOLATING
perturbation (moves only the quantity that gate reads) and, where the obvious
blunt perturbation is NOT isolating, that one too — because a perturbation that
fails on both states proves nothing and saying so is part of the method.

    P1   absolute per-room SF (THRESHOLDS.maxRoomSfAbs = 1.0)
    P2   raw ("mask fidelity") IoU floor (rawFloorIoU = 0.80), un-gated pre-F6
    P3   xfailAtLeast — a confidence COLLAPSE inside a one-sided exemption

Usage:  python3 docs/evidence/probes/gates.py <worktree-web-dir> <LABEL>
"""
import json, math, os, subprocess, sys, tempfile

WEB = os.path.abspath(sys.argv[1])
LABEL = sys.argv[2]
LOGDIR = os.environ.get("GATES_LOGDIR", tempfile.gettempdir())


def git(*a):
    return subprocess.run(["git", "-C", WEB, *a], capture_output=True, text=True).stdout


def clean():
    """No MODIFIED tracked file may be left behind. Untracked files (this pack's
    own probe sources, the evprobe/ copies) are ignored — they are not what a
    perturbation touches."""
    dirty = [l for l in git("status", "--porcelain").splitlines() if not l.startswith("??")]
    assert not dirty, "tracked files modified: " + "; ".join(dirty)


def restore():
    subprocess.run(["git", "-C", WEB, "checkout", "--", "."], check=False)


def bench(tag):
    log = os.path.join(LOGDIR, "gates-%s-%s.log" % (LABEL, tag))
    with open(log, "w") as fh:
        rc = subprocess.run(["npm", "run", "bench"], cwd=WEB, stdout=fh, stderr=subprocess.STDOUT).returncode
    return rc, log


def grep(log, pats, n=4):
    out = []
    for line in open(log, errors="replace"):
        if any(p in line for p in pats):
            out.append(line.rstrip()[:400])
            if len(out) >= n:
                break
    return out


def sub(relpath, anchor, replacement):
    p = os.path.join(WEB, relpath)
    s = open(p).read()
    assert anchor in s, "anchor moved in %s: %r" % (relpath, anchor[:60])
    open(p, "w").write(s.replace(anchor, replacement, 1))


# ── the perturbations ───────────────────────────────────────────────────────
def p1():
    """ABSOLUTE PER-ROOM SF. Grow cloud-corridor's golden ring so the engine
    diverges from its answer key by ~24 SF — INSIDE the 2.5% relative band the
    pack-era bench gated on (2.5% of 1743 SF is 43.6 SF) and far outside the
    1.0 SF absolute trigger F6 added."""
    p = os.path.join(WEB, "bench/corpus/va-finish-plan.json")
    d = json.load(open(p))
    for pr in d["probes"]:
        if pr.get("name") == "cloud-corridor":
            g = pr["golden"]
            cx = sum(v[0] for v in g) / len(g)
            cy = sum(v[1] for v in g) / len(g)
            k = math.sqrt(1.014)                            # +1.4% area
            pr["golden"] = [[cx + (x - cx) * k, cy + (y - cy) * k] for x, y in g]
    json.dump(d, open(p, "w"), indent=1)


def p2():
    """RAW MASK FIDELITY, isolated. A rasterisation regression injected
    surgically: the UN-SNAPPED ring the fidelity pass measures is shrunk 8%
    toward its own centroid. The SNAPPED ring the product ships is untouched, so
    every gate the pack-era bench already had stays satisfied and only the raw
    floor can fire."""
    a = '        rawRing: f.status === "ok" ? traceRegion(f) : null,'
    r = ('        rawRing: f.status === "ok" ? (() => { const r = traceRegion(f); '
         'const cx = r.reduce((t, v) => t + v[0], 0) / r.length, cy = r.reduce((t, v) => t + v[1], 0) / r.length; '
         'return r.map(([x, y]) => [cx + (x - cx) * 0.92, cy + (y - cy) * 0.92]); })() : null,')
    sub("bench/run.mts", a, r)


def p2x():
    """The BLUNT version, kept because it isolates nothing: coarsening the
    working raster degrades the snapped ring too, so it trips gates both states
    already had. Reported so the reader can see the difference."""
    sub("bench/run.mts", "Math.min(MASK_MAX_DIM,", "Math.min(900,")


def p3():
    """xfailAtLeast, isolated. The exemption on two-doorways/center excuses
    exactly ONE deduction (CONF_MINPASS_SOLE = 0.85). Deepen only that one to
    0.75: no other probe moves, so CONF_GATE.floorAbs is not involved. 0.75 is
    still 'at most 0.87', so the pack-era one-sided exemption passes it."""
    sub("src/lib/confidence.ts", "export const CONF_MINPASS_SOLE = 0.85;",
        "export const CONF_MINPASS_SOLE = 0.75;")


def p3x():
    """The BLUNT version, kept for the same reason: an extra x0.90 on EVERY
    trace collapses the non-exempt probes too, so CONF_GATE.floorAbs — which
    both states have — fires first and the run says nothing about xfailAtLeast."""
    sub("src/lib/confidence.ts", "  if (s.raster) { score *= CONF_RASTER;",
        "  if (true) { score *= CONF_RASTER;")


CASES = [
    ("p0",  None, "baseline, unperturbed", []),
    ("p1",  p1,   "golden +1.4% on cloud-corridor (~24 SF divergence)", ["BENCH FAILED", "absolute per-room"]),
    ("p2",  p2,   "un-snapped ring shrunk 8% (raster regression) [ISOLATING]", ["BENCH FAILED", "raw (rasteri", "raw cross"]),
    ("p2x", p2x,  "working raster coarsened to 900 [NOT isolating]", ["BENCH FAILED", "raw (rasteri"]),
    ("p3",  p3,   "CONF_MINPASS_SOLE 0.85 -> 0.75 [ISOLATING]", ["BENCH FAILED", "XFAIL", "two-doorways"]),
    ("p3x", p3x,  "extra x0.90 on every trace [NOT isolating]", ["BENCH FAILED", "absolute floor", "floorAbs"]),
]

head = git("rev-parse", "--short", "HEAD").strip()
print("== %s (%s) ==" % (LABEL, head))
results = {}
for tag, fn, desc, pats in CASES:
    clean()
    if fn:
        fn()
    rc, log = bench(tag)
    restore()
    clean()
    results[tag] = rc
    print("%-4s exit=%d  %s" % (tag, rc, desc))
    for line in grep(log, pats):
        print("       " + line.strip())
print(json.dumps({"label": LABEL, "head": head, "exit": results}))
