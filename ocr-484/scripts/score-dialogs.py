# Compare Import-from-schedule dialog rows: codes found vs ground truth (large) and OCR vs the vector text layer (AF600).
import json, re, sys
E = sys.argv[1]
def rows(tag):
    d = json.load(open(f"{E}/data/import-{tag}.json"))
    if not d["dialog"]: return None
    ls = [l.strip() for l in d["dialog"].split("\n")]
    out = []
    for i, l in enumerate(ls):
        if re.fullmatch(r"[A-Z]{1,4}-?\d{1,3}[A-Z]?|[A-Z]", l) and i + 1 < len(ls): out.append((l, ls[i + 1]))
    return out
res = {}
gt = json.load(open(f"{E}/inputs/large.gt.json"))
for tag in ["after-large", "after-large-brand"]:
    r = rows(tag); codes = [c for c, _ in r]
    res[tag] = {"rows": len(r), "codesMatchGT": sorted(codes) == sorted(gt["codes"]), "missing": sorted(set(gt["codes"]) - set(codes)), "extra": sorted(set(codes) - set(gt["codes"]))}
vec = dict(rows("before-af600-vector"))
for tag in ["before-af600", "after-af600"]:
    r = dict(rows(tag))
    same = [c for c in r if c in vec and r[c] == vec[c]]
    res[tag] = {"rows": len(r), "codesInVector": sum(c in vec for c in r), "descSameAsVector": len(same), "differs": {c: [r[c], vec.get(c)] for c in r if r[c] != vec.get(c)}}
res["vectorRows"] = len(vec)
json.dump(res, open(f"{E}/data/dialogs-scored.json", "w"), indent=1)
print(json.dumps(res, indent=1))
