#!/usr/bin/env python3
"""Camera anchors from the polish stage's own zoom_regions.

  python3 polish-anchors.py <events.jsonl> <videoW> <videoH> [level] [cap]

Prints one JSON object: {"regions": [{t0, t1, z, cx, cy}], "display": [w, h]}.
Coordinates come back in display points, the units the event log uses, so the
compositor can put them through its own layout.

Why go through polish rather than anchor on the click point, which is what the
studio camera did before: zoom_regions clusters clicks that belong together and,
when the log carries the clicked element's box, frames that box exactly instead
of guessing a scale around a point. A wide status line and a small button want
different pushes, and only the box knows which is which.
"""
import importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("polish", os.path.join(HERE, "polish", "polish.py"))
polish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(polish)

path, vw, vh = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
level = float(sys.argv[4]) if len(sys.argv) > 4 else 1.55
cap = float(sys.argv[5]) if len(sys.argv) > 5 else 1.8

with open(path) as f:
    header = json.loads(next(l for l in f if l.strip()))
disp = header.get("display", {"w": vw, "h": vh})
vid = {"w": vw, "h": vh, "fps": 30.0, "dur": 1e9, "has_audio": False}
ev = polish.load_events(path, vid)
dur = max([t for t, _, _ in ev["moves"]] + [t for t, _, _ in ev["clicks"]] + [0]) + 5.0
regions = polish.zoom_regions(ev["clicks"], vid, level, dur, level_cap=cap,
                              keys=ev["keys"], moves=ev["moves"],
                              click_bbox=ev.get("click_bbox"), key_bbox=ev.get("key_bbox"))
sx, sy = vid["w"] / disp["w"], vid["h"] / disp["h"]
out = [{"t0": r["t0"], "t1": r["t1"], "z": r["z"],
        "cx": round(r["cx"] / sx, 2), "cy": round(r["cy"] / sy, 2)} for r in regions]
json.dump({"regions": out, "display": [disp["w"], disp["h"]]}, sys.stdout)
