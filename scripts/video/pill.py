"""One caption pill as a png, drawn by the same code the studio compositor uses.

    python3 scripts/video/pill.py "the caption" <scale> <maxWidth> <out.png>

scale is studio-ffmpeg's capU: 2 for a 3840x2160 frame. Printed on stdout: the
pill's own left margin and bottom edge inside the canvas, so a caller can put it
where the compositor would.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("studio_assets", os.path.join(HERE, "studio-assets.py"))
studio_assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio_assets)

text, scale, max_w, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
img, marg, pill_bottom = studio_assets.caption_pill(text, scale, max_w)
img.save(out)
print(json.dumps({"path": out, "w": img.width, "h": img.height, "margin": marg, "pillBottom": pill_bottom}))
