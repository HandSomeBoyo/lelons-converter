"""Draws the installer's pictures (installer/welcome.bmp and installer/header.bmp) in the app's look.
Run once when the look changes: python make_installer_art.py <folder with spacegrotesk.ttf>
(the .ttf is the app's ui/fonts/spacegrotesk.woff2, unpacked with fontTools)."""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "installer")
BG, PANEL, TEXT, MUTED, ACCENT, INK = "#141414", "#1d1d1d", "#f1efe9", "#8d8a83", "#ffcf3f", "#141414"


def font(size, weight):
    f = ImageFont.truetype(os.path.join(sys.argv[1], "spacegrotesk.ttf"), size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def mark(draw, x, y, size):
    draw.rounded_rectangle((x, y, x + size, y + size), radius=size * 0.22, fill=ACCENT)
    s = size
    draw.polygon([(x + s * 0.36, y + s * 0.27), (x + s * 0.36, y + s * 0.73), (x + s * 0.76, y + s * 0.5)], fill=INK)


def welcome():
    # 164x314 at normal size; drawn twice as big so it stays sharp on bigger screens.
    w, h = 328, 628
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    # a soft yellow glow behind the mark
    glow = Image.new("RGB", (w, h), BG)
    gd = ImageDraw.Draw(glow)
    for r in range(220, 0, -4):
        t = r / 220
        c = tuple(int(int(BG[i:i + 2], 16) * t + int(ACCENT[i:i + 2], 16) * (1 - t) * 0.18 + int(BG[i:i + 2], 16) * (1 - t) * 0.82)
                  for i in (1, 3, 5))
        gd.ellipse((w / 2 - r, 200 - r, w / 2 + r, 200 + r), fill=c)
    img.paste(glow)
    d = ImageDraw.Draw(img)
    mark(d, w / 2 - 56, 144, 112)
    d.text((w / 2, 330), "Lelons", font=font(52, 700), fill=TEXT, anchor="mm")
    d.text((w / 2, 384), "Converter", font=font(40, 400), fill=MUTED, anchor="mm")
    d.rounded_rectangle((w / 2 - 22, 430, w / 2 + 22, 436), radius=3, fill=ACCENT)
    img.save(os.path.join(OUT, "welcome.bmp"))


def header():
    # 150x57 at normal size (drawn twice as big).
    w, h = 300, 114
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    mark(d, w - 92, (h - 64) / 2, 64)
    img.save(os.path.join(OUT, "header.bmp"))


welcome()
header()
print("ok")
