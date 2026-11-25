#!/usr/bin/env python3
"""
Bakes a glyph atlas the bot draws text with, so generating a profile card on
the VPS needs no image library at all.

Run from the repository root:  python3 -I scripts/generate-font-atlas.py
Output: bot/image/atlas.bin (raw 8-bit alpha) and bot/image/atlas.json

The atlas is greyscale coverage, used as an alpha mask: the bot multiplies it
by whatever colour the text should be.
"""
import gzip
import json
from pathlib import Path

from PIL import Image, ImageFont

OUT = Path(__file__).resolve().parent.parent / "bot" / "image"
SIZES = [16, 20, 26, 38]
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
CHARS = (
    "".join(chr(c) for c in range(32, 127))
    + "àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ"
    + "€·×÷±°«»—–…‰№"
    # Narrow and non-breaking spaces: toLocaleString("fr-FR") emits these.
    + "\u00a0\u202f\u2009"
    + "ᵉʳᵈ"
)


def pick_font(size):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    raise SystemExit("Aucune police utilisable trouvée.")


def bake():
    glyphs = {}
    rows = []          # (size, char, mask image)
    for size in SIZES:
        font = pick_font(size)
        ascent, _ = font.getmetrics()
        for char in CHARS:
            mask = font.getmask(char, mode="L")
            w, h = mask.size
            bbox = font.getbbox(char)
            image = Image.frombytes("L", (w, h), bytes(mask)) if w and h else Image.new("L", (1, 1), 0)
            rows.append((size, char, image, bbox, ascent, round(font.getlength(char), 2)))

    # Simple shelf packing, wide enough that a line never holds a single glyph.
    width = 1024
    x = y = shelf = 0
    placements = []
    for size, char, image, bbox, ascent, advance in rows:
        w, h = image.size
        if x + w + 1 > width:
            x = 0
            y += shelf + 1
            shelf = 0
        placements.append((x, y, size, char, image, bbox, ascent, advance))
        x += w + 1
        shelf = max(shelf, h)
    height = y + shelf + 1

    atlas = Image.new("L", (width, height), 0)
    for px, py, size, char, image, bbox, ascent, advance in placements:
        atlas.paste(image, (px, py))
        glyphs.setdefault(str(size), {})[char] = {
            "x": px, "y": py, "w": image.size[0], "h": image.size[1],
            # bbox is relative to the text origin; the bot offsets by these.
            "ox": bbox[0] if bbox else 0, "oy": bbox[1] if bbox else 0,
            "adv": advance,
        }

    OUT.mkdir(parents=True, exist_ok=True)
    # Gzipped: node:zlib is built in, so the bot pays no dependency to unpack it.
    (OUT / "atlas.bin.gz").write_bytes(gzip.compress(atlas.tobytes(), 9))
    meta = {
        "width": width, "height": height, "sizes": SIZES,
        "lineHeight": {str(size): pick_font(size).getmetrics()[0] + pick_font(size).getmetrics()[1] for size in SIZES},
        "ascent": {str(size): pick_font(size).getmetrics()[0] for size in SIZES},
        "glyphs": glyphs,
    }
    (OUT / "atlas.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(f"atlas {width}x{height} · {len(CHARS)} caractères × {len(SIZES)} tailles")
    print(f"atlas.bin.gz {(OUT / 'atlas.bin.gz').stat().st_size / 1024:7.1f} Ko")
    print(f"atlas.json {(OUT / 'atlas.json').stat().st_size / 1024:7.1f} Ko")


if __name__ == "__main__":
    bake()
