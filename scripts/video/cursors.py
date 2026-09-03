"""The three pointers the film uses, rasterised at any scale.

macOS swaps the pointer instantly as it crosses a button or a text field, so a
recording that keeps one arrow the whole way reads as a screen capture rather
than a person. The recorder logs which pointer the page asked for at every 60 Hz
move sample; this module turns that name into pixels for both compositors and
for the polish stage, so all three draw the same art.

  arrow  the default pointer            assets/cursor-arrow.svg
  hand   over a link or a button        assets/cursor-hand.svg
  text   over an input or selectable text, drawn here (cursor.in ships no I beam)

Hotspots are measured from the art, not guessed: the arrow's is its tip, the
hand's is the index fingertip, the I beam's is its centre. Sizes are given as
the ink height in pixels at 1x, so the two svg pointers carry the same visual
weight: 24 px for the arrow, 26 px for the hand.
"""
import io, os

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")

# kind: (file, hotspot in svg user units, ink height in units, ink px at 1x)
SPRITES = {
    "arrow": ("cursor-arrow.svg", (8.20, 4.90), 18.15, 24.0),
    "hand": ("cursor-hand.svg", (12.40, 8.00), 16.00, 26.0),
    "text": (None, None, None, 24.0),
}
KINDS = tuple(SPRITES)


def css_to_kind(css):
    """The CSS cursor keyword as one of the three we draw. Mirrors the JS in
    scripts/video/recorder.mjs; keep the two the same."""
    c = (css or "").split(",")[-1].strip().lower()
    if c in ("pointer", "grab", "grabbing"):
        return "hand"
    if c in ("text", "vertical-text"):
        return "text"
    return "arrow"


def _ibeam(px, scale):
    """The macOS I beam: a black bar with serifs, in a white keyline."""
    from PIL import Image, ImageDraw
    h = px
    w = max(7.0, 7.0 * scale)
    img = Image.new("RGBA", (int(round(w)) + 2, int(round(h)) + 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = img.size[0] / 2.0
    bar = max(1.0, 1.6 * scale)
    serif = max(2.0, 3.2 * scale)
    keyline = max(1.0, 1.1 * scale)

    def beam(colour, grow):
        d.rectangle([cx - bar / 2 - grow, 1 - grow, cx + bar / 2 + grow, h + 1 + grow], fill=colour)
        for y in (1, h + 1):
            d.rectangle([cx - serif - grow, y - bar / 2 - grow, cx + serif + grow, y + bar / 2 + grow], fill=colour)

    beam((255, 255, 255, 255), keyline)
    beam((0, 0, 0, 255), 0)
    return img, cx, img.size[1] / 2.0


def sprite(kind, u=1.0, shadow=True):
    """One pointer as an RGBA tile plus its hotspot, at `u` times its 1x size."""
    from PIL import Image, ImageDraw, ImageFilter
    kind = kind if kind in SPRITES else "arrow"
    file, hot, ink_units, ink_px = SPRITES[kind]
    px = ink_px * u

    if file is None:
        tile, hx, hy = _ibeam(px, u)
        pad = 0
    else:
        import cairosvg
        from xml.etree import ElementTree
        svg = ElementTree.parse(os.path.join(ASSETS, file)).getroot()
        vb = [float(v) for v in svg.get("viewBox").split()]
        scale = px / ink_units                       # pixels per svg user unit
        out_w = max(1, int(round(vb[2] * scale)))
        out_h = max(1, int(round(vb[3] * scale)))
        png = cairosvg.svg2png(url=os.path.join(ASSETS, file), output_width=out_w, output_height=out_h)
        art = Image.open(io.BytesIO(png)).convert("RGBA")
        pad = int(round(6 * u))
        tile = Image.new("RGBA", (art.size[0] + 2 * pad, art.size[1] + 2 * pad), (0, 0, 0, 0))
        tile.alpha_composite(art, (pad, pad))
        hx = pad + (hot[0] - vb[0]) * scale
        hy = pad + (hot[1] - vb[1]) * scale

    if shadow:
        # the same shadow the compositor's css asks for: 0 2px 4px rgba(0,0,0,.35)
        base = Image.new("RGBA", tile.size, (0, 0, 0, 0))
        mask = tile.getchannel("A").point(lambda v: 89 if v > 40 else 0)
        off = Image.new("L", tile.size, 0)
        off.paste(mask, (0, int(round(2 * u))))
        base.paste(Image.new("RGBA", tile.size, (0, 0, 0, 255)), (0, 0),
                   off.filter(ImageFilter.GaussianBlur(2.0 * u)))
        base.alpha_composite(tile)
        tile = base
    return tile, hx, hy


if __name__ == "__main__":
    from PIL import Image
    row = []
    for k in KINDS:
        t, hx, hy = sprite(k, 3.0)
        print(k, t.size, "hotspot", round(hx, 1), round(hy, 1))
        row.append((t, hx, hy))
    w = sum(t.size[0] for t, _, _ in row) + 60 * len(row)
    sheet = Image.new("RGBA", (w, 200), (250, 246, 235, 255))
    x = 30
    for t, hx, hy in row:
        sheet.alpha_composite(t, (int(x), 40))
        x += t.size[0] + 60
    sheet.save("/tmp/claude-1000/cursor-sheet.png")
