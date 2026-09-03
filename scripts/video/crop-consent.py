"""Crop a vault popup screenshot down to the consent card itself.

    python3 scripts/video/crop-consent.py <in.png> <out.png>

The card is the one thing on that page drawn with a cyan border, and a border is
a long run of cyan along a row or a column. Rows and columns where cyan covers a
good part of the frame are the four edges; everything outside them is page
chrome that says nothing a viewer needs, and dropping it lets the film show the
words at half again the size for the same room on screen.

Prints the crop it made. If no border is found the shot is passed through
unchanged, so a take with an unexpected popup still cuts.
"""
import sys

import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(int)
r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
cyan = (r < 120) & (g > 140) & (b > 190) & (b >= g - 20)

rows = np.nonzero(cyan.sum(axis=1) > im.width * 0.2)[0]
cols = np.nonzero(cyan.sum(axis=0) > im.height * 0.2)[0]
if len(rows) < 2 or len(cols) < 2:
    im.save(dst)
    print("no cyan border found, kept the whole shot")
    sys.exit(0)

pad = 2
box = (max(0, cols[0] - pad), max(0, rows[0] - pad),
       min(im.width, cols[-1] + 1 + pad), min(im.height, rows[-1] + 1 + pad))
im.crop(box).save(dst)
print("cropped %s to %dx%d at (%d, %d)" % (src, box[2] - box[0], box[3] - box[1], box[0], box[1]))
