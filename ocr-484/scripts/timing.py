# Per-sheet page-read time from the app's own "Read in X s" (the cache entry's ms), with the top CPU processes at each run.
import json, glob, os, re, statistics as st, sys
E = sys.argv[1]; out = {"runs": [], "summary": {}}
for f in sorted(glob.glob(f"{E}/data/pageread-*-read*.json")):
    d = json.load(open(f)); tag = d["tag"]; ver = tag.split("-")[0]
    for k, e in d["cache"].items():
        s = int(k.split(":")[-1])
        out["runs"].append({"tag": tag, "ver": ver, "sheet": s, "ms": round(e["ms"]), "rasters": e["rasters"], "loadBefore": d["loadBefore"].split("\n")[1:3], "loadAfterSheet": d["sheets"][str(s)]["loadAfter"].split("\n")[1:3]})
for ver in ["before", "after"]:
    for s in [1, 2]:
        ms = [r["ms"] for r in out["runs"] if r["ver"] == ver and r["sheet"] == s]
        out["summary"][f"{ver} sheet{s}"] = {"n": len(ms), "ms": ms, "median": st.median(ms), "min": min(ms), "max": max(ms)}
json.dump(out, open(f"{E}/data/timing.json", "w"), indent=1)
for k, v in out["summary"].items(): print(k, v)
for r in out["runs"]: print(r["tag"], r["sheet"], r["ms"], r["rasters"], "|", r["loadBefore"][0].strip())
