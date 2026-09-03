#!/usr/bin/env python3
"""Write the 720 px variants the Devpost story embeds.

    python3 docs/assets/press/resize.py [name ...]

Reads every apps/site/public/press/card-*.png that is not already a variant and
writes card-<name>-sm.png beside it, resized to 720 px wide with LANCZOS. Pass
one or more names to do only the cards whose filename contains them.
"""
import glob
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', '..', 'apps', 'site', 'public', 'press')
OUT = os.path.normpath(OUT)

WANTED = sys.argv[1:]

for src in sorted(glob.glob(os.path.join(OUT, 'card-*.png'))):
    if src.endswith('-sm.png'):
        continue
    if WANTED and not any(name in os.path.basename(src) for name in WANTED):
        continue
    im = Image.open(src).convert('RGB')
    width, height = im.size
    small = im.resize((720, round(height * 720 / width)), Image.LANCZOS)
    dst = src[:-4] + '-sm.png'
    small.save(dst, optimize=True)
    print(os.path.basename(dst), small.size)
