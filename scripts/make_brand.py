# -*- coding: utf-8 -*-
"""Favicon PNGs and the link-preview image (public/og.png).

    python scripts/make_brand.py

og-source.webp is a screenshot of the map with node labels on; replace it and
rerun to refresh the preview. Uses Segoe UI, so it runs on Windows as-is.
"""
import os
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(os.path.dirname(HERE), "public")
FONTS = r"C:\Windows\Fonts"

BG = (20, 22, 26)
CAR, BUS, TRAM, BIKE = (228, 87, 46), (46, 134, 171), (76, 201, 240), (63, 163, 77)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def pie_icon(size):
    """The node pie from favicon.svg, drawn at 4x and scaled down for
    clean edges at 32 px."""
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG)
    m = s * 0.14
    box = [m, m, s - m, s - m]
    d.pieslice(box, -90, 90, fill=TRAM)      # half the people
    d.pieslice(box, 90, 198, fill=BUS)
    d.pieslice(box, 198, 270, fill=CAR)      # the cars' smaller share
    return im.resize((size, size), Image.LANCZOS)


def spaced(draw, xy, text, fnt, fill, spacing):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + spacing


def wrap(draw, text, fnt, max_w):
    lines, line = [], ""
    for word in text.split():
        test = f"{line} {word}".strip()
        if draw.textlength(test, font=fnt) > max_w and line:
            lines.append(line)
            line = word
        else:
            line = test
    return lines + [line]


def og_image():
    W, H = 1200, 630
    src = Image.open(os.path.join(HERE, "og-source.webp")).convert("RGB")
    # Fit the screenshot to the frame height and pin it right; whatever it
    # leaves uncovered on the left disappears under the title's fade anyway.
    k = max(H / src.height, (W - 380) / src.width)
    src = src.resize((round(src.width * k), round(src.height * k)), Image.LANCZOS)
    im = Image.new("RGB", (W, H), (14, 16, 20))
    top = (src.height - H) // 2
    im.paste(src.crop((0, top, src.width, top + H)), (W - src.width, 0))
    im = ImageEnhance.Brightness(im).enhance(0.92)

    # Fade the map out towards the left, where the title sits.
    fade = Image.new("L", (W, H))
    px = fade.load()
    for x in range(W):
        t = min(1.0, max(0.0, (x - 400) / 420))     # 0 = fully covered
        a = int(255 * (1 - t * t * (3 - 2 * t)))     # smoothstep
        for y in range(H):
            px[x, y] = a
    im.paste(Image.new("RGB", (W, H), (14, 16, 20)), (0, 0), fade)

    d = ImageDraw.Draw(im)
    x = 72
    logo = pie_icon(56)
    im.paste(logo, (x, 70), logo)
    spaced(d, (x + 74, 86), "KOMPLEKSOWE BADANIA RUCHU", font("seguisb.ttf", 21),
           (138, 147, 166), 2.2)

    title = font("segoeuib.ttf", 104)
    d.text((x - 4, 150), "Wrocław", font=title, fill=(240, 242, 246))
    d.text((x - 4, 262), "KBR 2024", font=title, fill=CAR)

    sub = font("segoeuil.ttf", 31)
    y = 404
    for line in wrap(d, "Kto naprawdę przejeżdża przez węzły — liczone "
                        "w osobach, nie w pojazdach.", sub, 600):
        d.text((x, y), line, font=sub, fill=(201, 207, 218))
        y += 42

    lab = font("segoeui.ttf", 22)
    lx, ly = x, y + 20
    for color, name in ((CAR, "samochody"), (TRAM, "tramwaje"),
                        (BUS, "autobusy"), (BIKE, "rowery")):
        d.ellipse([lx, ly + 7, lx + 16, ly + 23], fill=color)
        d.text((lx + 24, ly), name, font=lab, fill=(201, 207, 218))
        lx += 24 + d.textlength(name, font=lab) + 26

    d.text((x, 568), "bartor.github.io/wroc-transport-map", font=font("segoeui.ttf", 20),
           fill=(120, 129, 146))
    im.save(os.path.join(PUBLIC, "og.png"), optimize=True)


if __name__ == "__main__":
    pie_icon(32).save(os.path.join(PUBLIC, "favicon-32.png"))
    pie_icon(180).save(os.path.join(PUBLIC, "apple-touch-icon.png"))
    og_image()
    for f in ("favicon-32.png", "apple-touch-icon.png", "og.png"):
        print(f, os.path.getsize(os.path.join(PUBLIC, f)), "bytes")
