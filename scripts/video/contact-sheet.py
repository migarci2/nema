"""One frame per chapter, on a navy sheet, labelled.

    python3 scripts/video/contact-sheet.py <spec.json>

The spec is written by scripts/video/build-film.mjs: an output path, a column
count, a cell width and a list of { label, at, file }.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

NAVY = (11, 19, 32)
LINE = (30, 44, 66)
INK = (242, 246, 255)
INK2 = (169, 188, 216)
CYAN = (0, 229, 255)


def font(size, path=None):
    for candidate in (
        path,
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if candidate and os.path.exists(candidate) and candidate.endswith(".ttf"):
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size)


def main():
    spec = json.load(open(sys.argv[1]))
    shots = spec["shots"]
    cols = int(spec.get("cols", 4))
    cell_w = int(spec.get("cell", 640))
    cell_h = round(cell_w * 9 / 16)
    pad = 24
    label_h = 52
    rows = (len(shots) + cols - 1) // cols
    head = 96
    W = pad + cols * (cell_w + pad)
    H = head + pad + rows * (cell_h + label_h + pad)
    sheet = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(sheet)
    f_title = font(34)
    f_lab = font(26)
    f_meta = font(20)
    d.text((pad, 32), "nema demo, the screen part: one frame per chapter", font=f_title, fill=INK)
    d.text((W - pad - 300, 40), "3840x2160 master, 30 fps", font=f_meta, fill=INK2)

    for i, shot in enumerate(shots):
        cx = pad + (i % cols) * (cell_w + pad)
        cy = head + pad + (i // cols) * (cell_h + label_h + pad)
        try:
            im = Image.open(shot["file"]).convert("RGB").resize((cell_w, cell_h), Image.LANCZOS)
        except Exception:
            im = Image.new("RGB", (cell_w, cell_h), LINE)
        sheet.paste(im, (cx, cy))
        d.rectangle([cx, cy, cx + cell_w - 1, cy + cell_h - 1], outline=LINE, width=2)
        d.text((cx, cy + cell_h + 12), shot["label"], font=f_lab, fill=INK)
        stamp = "%02d:%05.2f" % (int(shot["at"]) // 60, shot["at"] % 60)
        w = d.textlength(stamp, font=f_meta)
        d.text((cx + cell_w - w, cy + cell_h + 18), stamp, font=f_meta, fill=CYAN)

    sheet.save(spec["out"])
    print("contact sheet %s  %dx%d, %d frames" % (spec["out"], W, H, len(shots)))


if __name__ == "__main__":
    main()
