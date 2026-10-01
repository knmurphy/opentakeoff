# Synthetic image-only test page for upstream issue 481 (OCR ink colours).
# 11 inks x 30 distinct finish-style codes (10 each at 20, 28 and 40 px, 300 DPI,
# i.e. ~0.07, ~0.09 and ~0.13 in text), drawn with PIL, written as PNG plus an
# answer key. Wrap as PDF with:  magick ink481.png -density 300 -units PixelsPerInch ink481.pdf
import json, random
from PIL import Image, ImageDraw, ImageFont

DPI = 300
W, H = 17 * DPI, 11 * DPI
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
INKS = {
    "black": ((0, 0, 0), None),
    "red-220": ((220, 30, 30), None),
    "red-255": ((255, 0, 0), None),
    "magenta": ((255, 0, 255), None),
    "gray": ((150, 150, 150), None),
    "tinted-gray": ((150, 140, 140), None),
    "warm-gray": ((160, 150, 135), None),
    "light-gray": ((190, 190, 190), None),
    "blue": ((30, 60, 200), None),
    "green": ((0, 128, 0), None),
    "black-on-yellow": ((0, 0, 0), (255, 255, 0)),
}
PREFIXES = ["CPT", "VCT", "LVT", "RB", "PT", "CT", "WB", "ST", "RF", "SV", "TS", "EP", "QT", "WD", "AC", "FT", "BS", "MT", "GL", "SC", "CB", "HR", "TR", "MB", "EF", "DT", "KP", "NS", "ZR", "UF"]

rng = random.Random(481)
used = set()
def code():
    while True:
        c = f"{rng.choice(PREFIXES)}-{rng.randint(1, 99)}"
        if c not in used:
            used.add(c)
            return c

img = Image.new("RGB", (W, H), (255, 255, 255))
d = ImageDraw.Draw(img)
key = {}
col_w = W // len(INKS)
for ci, (name, (ink, bg)) in enumerate(INKS.items()):
    x = ci * col_w + 60
    y = 120
    d.text((x, 40), name.upper(), fill=(0, 0, 0), font=ImageFont.truetype(FONT, 30))
    key[name] = []
    for i in range(30):
        size = (20, 28, 40)[i // 10]
        f = ImageFont.truetype(FONT, size)
        c = code()
        if bg:
            l, t, r, b = d.textbbox((x, y), c, font=f)
            d.rectangle((l - 8, t - 6, r + 8, b + 6), fill=bg)
        d.text((x, y), c, fill=ink, font=f)
        key[name].append(c)
        y += 98
img.save("ink481.png")
json.dump(key, open("ink481-key.json", "w"), indent=1)
print("codes:", sum(len(v) for v in key.values()))
