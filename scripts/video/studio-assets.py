#!/usr/bin/env python3
"""Pre-rendered pieces for the ffmpeg compositor.

scripts/video/studio-ffmpeg.mjs hands this a spec on stdin and gets a manifest
back on stdout. Everything an ffmpeg filtergraph cannot draw itself lives here:
the window chrome, the rounded corner mask, the shadow, the macOS pointer, the
click ripple and the caption pills. Each one is drawn once, then the graph only
has to move it around, which is the whole reason the render is fast.

  echo '<spec json>' | python3 studio-assets.py

Needs Pillow and numpy, the same two the polish stage already needs.
"""
import json, math, os, sys, importlib.util

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

# The pointers are shared with the polish stage; one definition, imported.
_spec = importlib.util.spec_from_file_location("cursors", os.path.join(HERE, "cursors.py"))
cursors = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cursors)

FONTS = [
    "/usr/share/fonts/opentype/inter/Inter-%s.otf",
    "/usr/share/fonts/truetype/inter/Inter-%s.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf",
]


def font(size, weight="Medium"):
    for pattern in FONTS:
        for name in (weight, "Regular", ""):
            try:
                return ImageFont.truetype(pattern % name, size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def rounded_mask(w, h, r):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return m


def title_bar(w, h, title, u):
    """The macOS title bar: a dark gradient, three lights, the page title."""
    bar = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    grad = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    top = np.array([42, 47, 55], dtype=np.float32)
    bottom = np.array([34, 38, 45], dtype=np.float32)
    px = (top[None, None, :] * (1 - grad[:, :, None]) + bottom[None, None, :] * grad[:, :, None])
    px = np.repeat(px, w, axis=1).astype(np.uint8)
    bar.paste(Image.fromarray(px, "RGB"), (0, 0))
    d = ImageDraw.Draw(bar)
    d.line([(0, h - 1), (w, h - 1)], fill=(0, 0, 0, 128), width=max(1, u))
    r = 6 * u
    for i, colour in enumerate(((255, 95, 87), (254, 188, 46), (40, 200, 64))):
        cx = 14 * u + r + i * (20 * u)
        cy = h // 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour + (255,))
    f = font(13 * u, "Medium")
    box = d.textbbox((0, 0), title, font=f)
    d.text(((w - (box[2] - box[0])) / 2, (h - (box[3] - box[1])) / 2 - box[1]),
           title, font=f, fill=(201, 207, 216, 255))
    return bar


def shadow(w, h, r, spread, blur, dy, alpha):
    """A blurred black rounded rectangle, the window's drop shadow."""
    img = Image.new("RGBA", (w + 2 * spread, h + 2 * spread), (0, 0, 0, 0))
    sh = Image.new("L", img.size, 0)
    ImageDraw.Draw(sh).rounded_rectangle(
        [spread, spread + dy, spread + w - 1, spread + dy + h - 1], radius=r, fill=int(255 * alpha))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    img.paste(Image.new("RGBA", img.size, (0, 0, 0, 255)), (0, 0), sh)
    return img


def ripple_frames(u, n, out_dir):
    """The click ripple, one png per frame: a white core inside a dark ring."""
    base = 20.0 * u                       # 40 px across at 1x, as in the compositor
    top = base * 2.25 + 6 * u
    size = int(math.ceil(top * 2))
    cx = cy = size / 2.0
    yy, xx = np.mgrid[0:size, 0:size]
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    names = []
    for i in range(n):
        p = i / float(n)
        e = p * p * (3 - 2 * p)                       # smoothstep, the ripple's ease
        radius = base * (0.75 + e * 1.5)
        a = (1 - e) * 0.95
        # core: 0.8 alpha at the middle, gone at 0.68 of the radius
        core = np.clip(1.0 - dist / (radius * 0.68), 0, 1) ** 1.6 * 0.8
        rgb = np.ones((size, size, 3), dtype=np.float32) * 255.0
        alpha = core.copy()
        ring_w = 2.5 * u
        ring = np.clip(1.0 - np.abs(dist - radius) / ring_w, 0, 1) * 0.42
        rgb = rgb * (1 - ring[:, :, None]) + np.array([11, 19, 32], dtype=np.float32)[None, None, :] * ring[:, :, None]
        alpha = np.clip(alpha + ring, 0, 1) * a
        out = np.dstack([rgb, alpha * 255.0]).astype(np.uint8)
        name = os.path.join(out_dir, "ripple-%02d.png" % i)
        Image.fromarray(out, "RGBA").save(name)
        names.append(name)
    return names, size


def caption_pill(text, u, max_w):
    """One caption, pill and text together, so the graph only has to fade it.

    The type shrinks rather than the pill clipping: a caption that does not fit
    the frame is a caption with a word cut off, which is worse than one set a
    point smaller."""
    size = 34 * u
    probe = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    for _ in range(12):
        f = font(int(size), "Medium")
        box = probe.textbbox((0, 0), text, font=f)
        if box[2] - box[0] + 2 * (30 * u) <= max_w or size <= 14 * u:
            break
        size *= 0.94
    pad_x, pad_top, pad_bottom = 30 * u, 11 * u, 13 * u
    tw, th = box[2] - box[0], box[3] - box[1]
    line = size * 1.12
    w = min(max_w, int(tw + 2 * pad_x))
    h = int(line + pad_top + pad_bottom)
    blur = 40 * u / 3.0
    marg = int(blur * 3)
    img = Image.new("RGBA", (w + 2 * marg, h + 2 * marg + 12 * u), (0, 0, 0, 0))
    sh = Image.new("L", img.size, 0)
    ImageDraw.Draw(sh).rounded_rectangle(
        [marg, marg + 12 * u, marg + w - 1, marg + 12 * u + h - 1], radius=h // 2, fill=115)
    img.paste(Image.new("RGBA", img.size, (0, 0, 0, 255)), (0, 0), sh.filter(ImageFilter.GaussianBlur(blur)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([marg, marg, marg + w - 1, marg + h - 1], radius=h // 2,
                        fill=(11, 19, 32, 235), outline=(0, 229, 255, 71), width=max(1, u))
    d.text((marg + (w - tw) / 2 - box[0], marg + pad_top - box[1] + (line - th) / 2),
           text, font=f, fill=(242, 246, 255, 255))
    return img, marg, marg + h        # the pill's own bottom edge inside the canvas


def main():
    spec = json.load(sys.stdin)
    out = spec["dir"]
    os.makedirs(out, exist_ok=True)
    u = spec["u"]
    cap_u = spec.get("capU", u)      # captions live on the output frame, not the scene
    win = spec["win"]
    man = {}

    bar = title_bar(win["w"], win["bar"], spec.get("title", ""), u)
    bar.save(os.path.join(out, "titlebar.png"))
    man["titlebar"] = os.path.join(out, "titlebar.png")

    rounded_mask(win["w"], win["h"], win["radius"]).save(os.path.join(out, "mask.png"))
    man["mask"] = os.path.join(out, "mask.png")

    sp = 60 * u
    sh = shadow(win["w"], win["h"], win["radius"], sp, 80 * u / 3.0, 30 * u, 0.55)
    sh.save(os.path.join(out, "shadow.png"))
    man["shadow"] = {"path": os.path.join(out, "shadow.png"), "x": win["x"] - sp, "y": win["y"] - sp}

    man["cursor"] = {}
    for kind in cursors.KINDS:
        tile, hx, hy = cursors.sprite(kind, u)
        path = os.path.join(out, "cursor-%s.png" % kind)
        tile.save(path)
        man["cursor"][kind] = {"path": path, "hx": round(hx, 2), "hy": round(hy, 2),
                               "w": tile.size[0], "h": tile.size[1]}

    names, size = ripple_frames(u, spec.get("rippleFrames", 12), out)
    man["ripple"] = {"pattern": os.path.join(out, "ripple-%02d.png"), "n": len(names), "size": size}

    caps = []
    for i, text in enumerate(spec.get("captions", [])):
        img, marg, pill_bottom = caption_pill(text, cap_u, spec["out"][0] - 200 * cap_u)
        path = os.path.join(out, "caption-%02d.png" % i)
        img.save(path)
        caps.append({"path": path, "w": img.size[0], "h": img.size[1],
                     "margin": marg, "pillBottom": pill_bottom})
    man["captions"] = caps

    json.dump(man, sys.stdout)


if __name__ == "__main__":
    main()
