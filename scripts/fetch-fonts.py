#!/usr/bin/env python3
"""Regenerate the self-hosted webfonts under web/public/fonts/.

The app used to `@import` these from fonts.googleapis.com, which made a
third-party request on every page load and broke with no network. This script
fetches the same family/weight spec once, at author time, so the bytes can be
served from our own origin.

    python3 scripts/fetch-fonts.py           # fetch + write css + manifest
    python3 scripts/fetch-fonts.py --verify  # check committed files against MANIFEST

Dedup matters: Inter, Bricolage Grotesque and JetBrains Mono are VARIABLE
fonts, so Google serves ONE woff2 per subset covering every weight. Saving that
response once per requested weight (which an earlier pass did) tripled the
payload and gave the browser three cache entries for identical bytes. Blocks
are therefore grouped by source URL, and a variable face gets a single
`font-weight: <min> <max>` range descriptor read from the font's own fvar table.

Requires fonttools + brotli for the version/axis metadata (`pip install
fonttools brotli`). Needs a browser User-Agent or Google serves ttf, not woff2.
"""
import argparse
import hashlib
import pathlib
import re
import subprocess
import sys

CSS_URL = (
    "https://fonts.googleapis.com/css2?"
    "family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800"
    "&family=Inter:wght@300;400;500;600;700"
    "&family=JetBrains+Mono:wght@400;500;600;700"
    "&family=Space+Mono:wght@400;700"
    "&family=IBM+Plex+Mono:wght@400;500;600"
    "&display=swap"
)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
KEEP_SUBSETS = {"latin", "latin-ext"}

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "web/public/fonts"
CSS_OUT = ROOT / "web/src/styles/fonts.css"
MANIFEST = FONT_DIR / "MANIFEST.txt"

slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower().strip("'\" ")).strip("-")
sha256 = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()


def curl(url: str, dest: pathlib.Path | None = None) -> str:
    cmd = ["curl", "-sS", "--fail", "--max-time", "60", "-A", UA, url]
    if dest:
        cmd += ["-o", str(dest)]
        subprocess.run(cmd, check=True)
        return ""
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def font_meta(path: pathlib.Path):
    """(version, (wght_min, wght_max) | None) from the font's own tables."""
    from fontTools.ttLib import TTFont
    f = TTFont(path)
    names = {r.nameID: str(r) for r in f["name"].names if r.platformID == 3}
    rng = None
    if "fvar" in f:
        for a in f["fvar"].axes:
            if a.axisTag == "wght":
                rng = (int(a.minValue), int(a.maxValue))
    return names.get(5, "?").replace("Version ", "").strip(), rng


def verify() -> int:
    if not MANIFEST.exists():
        print("no MANIFEST.txt — run without --verify first", file=sys.stderr)
        return 1
    expected = {}
    for line in MANIFEST.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        h, name = line.split()[:2]
        expected[name] = h
    on_disk = {p.name: sha256(p) for p in sorted(FONT_DIR.glob("*.woff2"))}
    bad = [n for n, h in expected.items() if on_disk.get(n) != h]
    extra = sorted(set(on_disk) - set(expected))
    for n in bad:
        print(f"MISMATCH/MISSING {n}", file=sys.stderr)
    for n in extra:
        print(f"UNTRACKED {n}", file=sys.stderr)
    if bad or extra:
        return 1
    print(f"ok — {len(expected)} fonts match MANIFEST.txt")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    if ap.parse_args().verify:
        return verify()

    css = curl(CSS_URL)
    parts = re.split(r"/\*\s*([a-z0-9\-\[\]]+)\s*\*/", css)
    field = lambda b, k: (m.group(1).strip() if (m := re.search(rf"{k}:\s*([^;]+);", b)) else None)

    # group @font-face blocks by their source URL — a variable font's weights all share one
    groups: dict[str, dict] = {}
    for i in range(1, len(parts), 2):
        subset, body = parts[i], parts[i + 1]
        if subset not in KEEP_SUBSETS:
            continue
        for m in re.finditer(r"@font-face\s*\{(.*?)\}", body, re.S):
            b = m.group(1)
            url = re.search(r"url\((https://[^)]+)\)", b).group(1)
            g = groups.setdefault(url, {
                "family": field(b, "font-family"),
                "style": field(b, "font-style") or "normal",
                "range": field(b, "unicode-range"),
                "subset": subset,
                "weights": [],
            })
            g["weights"].append(int(field(b, "font-weight")))

    FONT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in FONT_DIR.glob("*.woff2"):
        stale.unlink()

    faces, manifest = [], []
    for url, g in groups.items():
        name = f"{slug(g['family'])}-{g['subset']}.woff2"
        dest = FONT_DIR / name
        curl(url, dest)
        version, wght = font_meta(dest)
        # variable → one face spanning the font's real axis; static → its single weight
        weight_css = f"{wght[0]} {wght[1]}" if wght else str(min(g["weights"]))
        if not wght and len(set(g["weights"])) > 1:
            raise SystemExit(f"{name}: static font shares a URL across weights {g['weights']}")
        if not wght:
            name = f"{slug(g['family'])}-{g['weights'][0]}-{g['subset']}.woff2"
            dest.rename(FONT_DIR / name)
            dest = FONT_DIR / name
        faces.append(f"""@font-face {{
  font-family: {g['family']};
  font-style: {g['style']};
  font-weight: {weight_css};
  font-display: swap;
  src: url('/fonts/{name}') format('woff2');
  unicode-range: {g['range']};
}}""")
        manifest.append((sha256(dest), name, g["family"].strip("'"), version, url))

    header = f"""/* Self-hosted webfonts — generated by scripts/fetch-fonts.py. Do not hand-edit.
 *
 * These used to come from a `@import url('https://fonts.googleapis.com/...')`
 * at the top of tokens.css, which made a third-party request on every page load
 * (an IP + User-Agent leak before the user opens a plan) and failed with no
 * network. Everything here is served from our own origin.
 *
 * Source request (latin + latin-ext subsets only):
 *   {CSS_URL}
 *
 * Inter, Bricolage Grotesque and JetBrains Mono are VARIABLE fonts: one file
 * per subset covers every weight, declared with a `font-weight` range read
 * from the font's own fvar table. IBM Plex Mono and Space Mono are static, so
 * they keep one file per weight.
 *
 * All five families are SIL OFL 1.1 — see web/public/fonts/OFL.txt for the
 * licence and the per-family copyright notices, THIRD-PARTY-NOTICES.md for the
 * artifact table, and web/public/fonts/MANIFEST.txt for hashes and versions
 * (`python3 scripts/fetch-fonts.py --verify`).
 */

"""
    CSS_OUT.write_text(header + "\n\n".join(faces) + "\n", encoding="utf-8")

    total = sum((FONT_DIR / m[1]).stat().st_size for m in manifest)
    lines = ["# sha256  filename  family  version  source",
             "# verify: python3 scripts/fetch-fonts.py --verify", ""]
    lines += [f"{h}  {n}  {fam}  {v}  {u}" for h, n, fam, v, u in sorted(manifest, key=lambda r: r[1])]
    MANIFEST.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"{len(manifest)} files, {total/1024:.0f} KB → {FONT_DIR}")
    print(f"wrote {CSS_OUT.relative_to(ROOT)} and {MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
