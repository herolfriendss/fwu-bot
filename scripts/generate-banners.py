#!/usr/bin/env python3
"""
Generates the red-and-black category banners shown in the bots' embeds.

Run from the repository root:  python3 -I scripts/generate-banners.py
Output: bot/assets/banners/<category>.gif (1024x192, looping)

Everything is drawn with primitives at 3x and downsampled, so there is no font
or asset dependency. The bots only ship the generated GIFs; Pillow is never
needed on the VPS.
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 1024, 192
SS = 3                      # supersampling factor
FRAMES = 16
PERIOD = 132                # stripe repeat distance, in final pixels
BG = (8, 8, 10)
DOT = (36, 36, 44)
RED = (226, 29, 47)
RED_DIM = (168, 22, 40)
BAR_H = 5
ICON_CX, ICON_SIZE = 110, 94

OUT = Path(__file__).resolve().parent.parent / "bot" / "assets" / "banners"


# ---------------------------------------------------------------- icons ----
# Each icon draws inside a square of side `s` centred on (cx, cy), in outline
# style with stroke width `w`. Coordinates are already supersampled.

def _shield_path(cx, cy, s):
    h = s / 2
    return [(cx, cy - h), (cx + h * 0.82, cy - h * 0.62), (cx + h * 0.82, cy + h * 0.1),
            (cx, cy + h), (cx - h * 0.82, cy + h * 0.1), (cx - h * 0.82, cy - h * 0.62)]


def icon_shield(d, cx, cy, s, c, w):
    d.polygon(_shield_path(cx, cy, s), outline=c, width=w)


def icon_shield_check(d, cx, cy, s, c, w):
    d.polygon(_shield_path(cx, cy, s), outline=c, width=w)
    d.line([(cx - s * 0.2, cy), (cx - s * 0.04, cy + s * 0.16), (cx + s * 0.23, cy - s * 0.17)],
           fill=c, width=w, joint="curve")


def icon_gavel(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h * 0.95, cy - h * 0.75, cx + h * 0.15, cy - h * 0.1],
                        radius=s * 0.1, outline=c, width=w)
    d.line([(cx - h * 0.4, cy - h * 0.1), (cx + h * 0.75, cy + h * 0.85)], fill=c, width=w)
    d.line([(cx - h * 0.55, cy + h * 0.9), (cx + h * 0.9, cy + h * 0.9)], fill=c, width=w)


def icon_star(d, cx, cy, s, c, w):
    pts = []
    for i in range(10):
        r = s * 0.5 if i % 2 == 0 else s * 0.25
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, outline=c, width=w)


def icon_dice(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h, cy - h, cx + h, cy + h], radius=s * 0.18, outline=c, width=w)
    r = s * 0.075
    for px, py in ((-0.26, -0.26), (0, 0), (0.26, 0.26)):
        d.ellipse([cx + px * s - r, cy + py * s - r, cx + px * s + r, cy + py * s + r], fill=c)


def icon_cards(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h * 0.95, cy - h * 0.7, cx + h * 0.05, cy + h], radius=s * 0.1, outline=c, width=w)
    d.rounded_rectangle([cx - h * 0.1, cy - h, cx + h * 0.9, cy + h * 0.7], radius=s * 0.1, outline=c, width=w)


def icon_ticket(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h, cy - h * 0.62, cx + h, cy + h * 0.62], radius=s * 0.12, outline=c, width=w)
    r = s * 0.13
    d.ellipse([cx - r, cy - h * 0.62 - r, cx + r, cy - h * 0.62 + r], fill=BG, outline=c, width=w)
    d.ellipse([cx - r, cy + h * 0.62 - r, cx + r, cy + h * 0.62 + r], fill=BG, outline=c, width=w)


def icon_chip(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h * 0.62, cy - h * 0.62, cx + h * 0.62, cy + h * 0.62], radius=s * 0.1, outline=c, width=w)
    d.rounded_rectangle([cx - h * 0.26, cy - h * 0.26, cx + h * 0.26, cy + h * 0.26], radius=s * 0.05, outline=c, width=w)
    for t in (-0.34, 0, 0.34):
        d.line([(cx + t * s, cy - h * 0.62), (cx + t * s, cy - h)], fill=c, width=w)
        d.line([(cx + t * s, cy + h * 0.62), (cx + t * s, cy + h)], fill=c, width=w)
        d.line([(cx - h * 0.62, cy + t * s), (cx - h, cy + t * s)], fill=c, width=w)
        d.line([(cx + h * 0.62, cy + t * s), (cx + h, cy + t * s)], fill=c, width=w)


def icon_calendar(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h, cy - h * 0.78, cx + h, cy + h], radius=s * 0.1, outline=c, width=w)
    d.line([(cx - h, cy - h * 0.3), (cx + h, cy - h * 0.3)], fill=c, width=w)
    d.line([(cx - h * 0.5, cy - h * 0.78), (cx - h * 0.5, cy - h * 1.08)], fill=c, width=w)
    d.line([(cx + h * 0.5, cy - h * 0.78), (cx + h * 0.5, cy - h * 1.08)], fill=c, width=w)
    r = s * 0.06
    d.ellipse([cx - r, cy + h * 0.28 - r, cx + r, cy + h * 0.28 + r], fill=c)


def icon_note(d, cx, cy, s, c, w):
    h = s / 2
    d.line([(cx - h * 0.3, cy + h * 0.6), (cx - h * 0.3, cy - h * 0.85)], fill=c, width=w)
    d.line([(cx + h * 0.72, cy + h * 0.32), (cx + h * 0.72, cy - h)], fill=c, width=w)
    d.line([(cx - h * 0.3, cy - h * 0.85), (cx + h * 0.72, cy - h)], fill=c, width=w)
    d.ellipse([cx - h * 0.82, cy + h * 0.28, cx - h * 0.26, cy + h * 0.76], outline=c, width=w)
    d.ellipse([cx + h * 0.2, cy, cx + h * 0.76, cy + h * 0.48], outline=c, width=w)


def icon_mic(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - s * 0.17, cy - h, cx + s * 0.17, cy + h * 0.18], radius=s * 0.17, outline=c, width=w)
    d.arc([cx - h * 0.62, cy - h * 0.3, cx + h * 0.62, cy + h * 0.62], 0, 180, fill=c, width=w)
    d.line([(cx, cy + h * 0.62), (cx, cy + h)], fill=c, width=w)


def icon_gear(d, cx, cy, s, c, w):
    outer, inner = s * 0.5, s * 0.33
    pts = []
    for i in range(24):
        a = i * math.pi / 12
        r = outer if (i // 2) % 2 == 0 else inner
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, outline=c, width=w)
    r = s * 0.16
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=c, width=w)


def icon_crown(d, cx, cy, s, c, w):
    h = s / 2
    d.polygon([(cx - h, cy + h * 0.45), (cx - h * 0.78, cy - h * 0.5), (cx - h * 0.34, cy + h * 0.02),
               (cx, cy - h * 0.72), (cx + h * 0.34, cy + h * 0.02), (cx + h * 0.78, cy - h * 0.5),
               (cx + h, cy + h * 0.45)], outline=c, width=w)
    d.line([(cx - h * 0.92, cy + h * 0.8), (cx + h * 0.92, cy + h * 0.8)], fill=c, width=w)


def icon_bolt(d, cx, cy, s, c, w):
    h = s / 2
    d.polygon([(cx + h * 0.28, cy - h), (cx - h * 0.62, cy + h * 0.12), (cx - h * 0.04, cy + h * 0.12),
               (cx - h * 0.28, cy + h), (cx + h * 0.62, cy - h * 0.12), (cx + h * 0.04, cy - h * 0.12)],
              outline=c, width=w)


def icon_coin(d, cx, cy, s, c, w):
    """Three stacked coins, read as money at a glance."""
    h = s / 2
    rx, ry = h * 0.92, h * 0.34
    for i, dy in enumerate((h * 0.52, h * 0.04, -h * 0.44)):
        d.ellipse([cx - rx, cy + dy - ry, cx + rx, cy + dy + ry], outline=c, width=w)
        if i < 2:
            d.line([(cx - rx, cy + dy), (cx - rx, cy + dy - h * 0.48)], fill=c, width=w)
            d.line([(cx + rx, cy + dy), (cx + rx, cy + dy - h * 0.48)], fill=c, width=w)


def icon_chips(d, cx, cy, s, c, w):
    h = s / 2
    d.ellipse([cx - h, cy - h, cx + h, cy + h], outline=c, width=w)
    d.ellipse([cx - h * 0.42, cy - h * 0.42, cx + h * 0.42, cy + h * 0.42], outline=c, width=w)
    for i in range(4):
        a = i * math.pi / 4 + math.pi / 8
        dx, dy = math.cos(a), math.sin(a)
        d.line([(cx + dx * h * 0.46, cy + dy * h * 0.46), (cx + dx * h, cy + dy * h)], fill=c, width=w)
        d.line([(cx - dx * h * 0.46, cy - dy * h * 0.46), (cx - dx * h, cy - dy * h)], fill=c, width=w)


def icon_bag(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h * 0.84, cy - h * 0.34, cx + h * 0.84, cy + h], radius=s * 0.12, outline=c, width=w)
    d.arc([cx - h * 0.46, cy - h * 0.92, cx + h * 0.46, cy + h * 0.04], 180, 360, fill=c, width=w)


def icon_hex(d, cx, cy, s, c, w):
    h = s / 2
    pts = [(cx + h * math.cos(math.pi / 6 + i * math.pi / 3), cy + h * math.sin(math.pi / 6 + i * math.pi / 3))
           for i in range(6)]
    d.polygon(pts, outline=c, width=w)
    d.line([(cx - h * 0.3, cy + h * 0.26), (cx - h * 0.3, cy - h * 0.26), (cx, cy + h * 0.1),
            (cx + h * 0.3, cy - h * 0.26), (cx + h * 0.3, cy + h * 0.26)], fill=c, width=w, joint="curve")


def icon_chat(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h, cy - h * 0.84, cx + h, cy + h * 0.34], radius=s * 0.16, outline=c, width=w)
    d.line([(cx - h * 0.34, cy + h * 0.34), (cx - h * 0.44, cy + h * 0.9), (cx + h * 0.04, cy + h * 0.34)],
           fill=c, width=w, joint="curve")


def icon_chart(d, cx, cy, s, c, w):
    h = s / 2
    d.line([(cx - h, cy + h), (cx + h, cy + h)], fill=c, width=w)
    for i, height in enumerate((0.42, 0.82, 0.6, 1.08)):
        x = cx - h * 0.72 + i * h * 0.48
        d.line([(x, cy + h * 0.88), (x, cy + h * 0.88 - h * height)], fill=c, width=int(w * 1.6))


def icon_lock(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h * 0.78, cy - h * 0.12, cx + h * 0.78, cy + h * 0.9], radius=s * 0.12, outline=c, width=w)
    d.arc([cx - h * 0.48, cy - h * 0.92, cx + h * 0.48, cy + h * 0.1], 180, 360, fill=c, width=w)
    r = s * 0.07
    d.ellipse([cx - r, cy + h * 0.32 - r, cx + r, cy + h * 0.32 + r], fill=c)


def icon_trophy(d, cx, cy, s, c, w):
    h = s / 2
    d.rounded_rectangle([cx - h * 0.52, cy - h * 0.9, cx + h * 0.52, cy + h * 0.1], radius=s * 0.1, outline=c, width=w)
    d.arc([cx - h * 0.96, cy - h * 0.82, cx - h * 0.36, cy - h * 0.22], 90, 270, fill=c, width=w)
    d.arc([cx + h * 0.36, cy - h * 0.82, cx + h * 0.96, cy - h * 0.22], 270, 90, fill=c, width=w)
    d.line([(cx, cy + h * 0.1), (cx, cy + h * 0.52)], fill=c, width=w)
    d.line([(cx - h * 0.56, cy + h * 0.86), (cx + h * 0.56, cy + h * 0.86)], fill=c, width=int(w * 1.4))


# Category -> icon. Keep the keys in sync with bot/assets/banners.js.
CATEGORIES = {
    "fwu": icon_hex,
    "communaute": icon_star,
    "social": icon_chat,
    "jeux": icon_dice,
    "cartes": icon_cards,
    "tickets": icon_ticket,
    "ia": icon_chip,
    "evenements": icon_calendar,
    "classement": icon_trophy,
    "statistiques": icon_chart,
    "moderation": icon_gavel,
    "securite": icon_shield,
    "verification": icon_shield_check,
    "verrou": icon_lock,
    "musique": icon_note,
    "vocal": icon_mic,
    "systeme": icon_gear,
    "roles": icon_crown,
    "automatisation": icon_bolt,
    "economie": icon_coin,
    "casino": icon_chips,
    "boutique": icon_bag,
}


# -------------------------------------------------------------- drawing ----

def dotted_background():
    """Black field with the faint dot grid, drawn once at final size."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    for y in range(8, H, 16):
        for x in range(8, W, 16):
            d.point((x, y), fill=DOT)
    return img


def stripe_strip():
    """One tileable strip of diagonal stripes, (W + PERIOD) wide. Full opacity: the fade is applied after cropping."""
    sw, sh = (W + PERIOD) * SS, H * SS
    layer = Image.new("L", (sw, sh), 0)
    d = ImageDraw.Draw(layer)
    widths = (36, 14, 24, 10)
    x = -sh
    i = 0
    while x < sw + sh:
        d.line([(x, sh), (x + sh, 0)], fill=255, width=widths[i % len(widths)] * SS)
        x += PERIOD * SS
        i += 1
    return layer.resize((W + PERIOD, H), Image.LANCZOS)


def fade_mask():
    """Stays put while the stripes scroll: nothing on the left, strongest on the right."""
    fade = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(fade)
    for x in range(W):
        t = max(0.0, min(1.0, (x / W - 0.36) / 0.64))
        d.line([(x, 0), (x, H)], fill=int(118 * (t ** 1.5)))
    return fade


def render(category, icon, out_path):
    base = dotted_background()
    strip = stripe_strip()
    stripe_color = Image.new("RGB", (W, H), RED_DIM)

    icon_layer = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    icon(ImageDraw.Draw(icon_layer), ICON_CX * SS, (H // 2) * SS, ICON_SIZE * SS, RED + (255,), 5 * SS)
    icon_layer = icon_layer.resize((W, H), Image.LANCZOS)

    fade = fade_mask()
    frames = []
    for n in range(FRAMES):
        offset = round(n * PERIOD / FRAMES)
        mask = Image.composite(fade, Image.new("L", (W, H), 0), strip.crop((offset, 0, offset + W, H)))
        frame = Image.composite(stripe_color, base, mask)
        frame.paste(icon_layer, (0, 0), icon_layer)
        ImageDraw.Draw(frame).rectangle([0, H - BAR_H, W, H], fill=RED)
        frames.append(frame)

    palette = frames[0].quantize(colors=48, method=Image.MEDIANCUT)
    frames = [f.quantize(palette=palette, dither=Image.NONE) for f in frames]
    frames[0].save(out_path, save_all=True, append_images=frames[1:], duration=90,
                   loop=0, optimize=True, disposal=2)
    return out_path.stat().st_size


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or list(CATEGORIES)
    total = 0
    for name in wanted:
        if name not in CATEGORIES:
            raise SystemExit(f"Catégorie inconnue : {name}")
        size = render(name, CATEGORIES[name], OUT / f"{name}.gif")
        total += size
        print(f"{name:16s} {size / 1024:7.1f} Ko")
    print(f"{'total':16s} {total / 1024:7.1f} Ko  ({len(wanted)} bannières)")


if __name__ == "__main__":
    main()
