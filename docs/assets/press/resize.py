#!/usr/bin/env python3
"""Write the 720 px variants the Devpost story embeds.

    python3 docs/assets/press/resize.py

Reads every apps/site/public/press/card-*.png that is not already a variant and
writes card-<name>-sm.png beside it, resized to 720 px wide with LANCZOS.
"""
import glob
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', '..', 'apps', 'site', 'public', 'press')
OUT = os.path.normpath(OUT)

for src in sorted(glob.glob(os.path.join(OUT, 'card-*.png'))):
    if src.endswith('-sm.png'):
        continue
    im = Image.open(src).convert('RGB')
    width, height = im.size
    small = im.resize((720, round(height * 720 / width)), Image.LANCZOS)
    dst = src[:-4] + '-sm.png'
    small.save(dst, optimize=True)
    print(os.path.basename(dst), small.size)
