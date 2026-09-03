"""The counted label that opens a chapter: One, Two, Three.

    python3 scripts/video/label.py "One" <scale> <out.png>

scale is 2 for a 3840x2160 frame. The label sits on a navy plate with a cyan
edge, because the wallpaper behind the window is not a flat colour and plain
type on it would read differently in every shot. No shadow on the type.
Prints the size, so the caller can place it.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

# The same faces studio-assets.py draws the caption pills with, so a label and
# a caption are set in one typeface.
FONTS = [
    "/usr/share/fonts/opentype/inter/Inter-%s.otf",
    "/usr/share/fonts/truetype/inter/Inter-%s.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf",
]


def font(size, weight="SemiBold"):
    for pattern in FONTS:
        for name in (weight, "Bold", "Regular", ""):
            try:
                return ImageFont.truetype(pattern % name, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


text, scale, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
size = 48 * scale
pad_x, pad_y = 28 * scale, 16 * scale
edge = 5 * scale
f = font(size)
probe = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
box = probe.textbbox((0, 0), text, font=f)
tw, th = box[2] - box[0], box[3] - box[1]
w, h = int(tw + 2 * pad_x + edge), int(size * 1.16 + 2 * pad_y)
img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
r = 8 * scale
d.rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=(11, 19, 32, 232))
d.rounded_rectangle([0, 0, edge + r, h - 1], radius=r, fill=(0, 229, 255, 255))
d.rectangle([edge, 0, edge + r, h - 1], fill=(11, 19, 32, 232))
d.text((edge + pad_x - box[0], pad_y - box[1] + (size * 1.16 - th) / 2), text, font=f, fill=(242, 246, 255, 255))
img.save(out)
print(json.dumps({"path": out, "w": w, "h": h}))
