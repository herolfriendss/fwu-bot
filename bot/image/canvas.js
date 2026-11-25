// A tiny RGBA drawing surface: rectangles, rounded corners, images and text.
// Text comes from the baked atlas (scripts/generate-font-atlas.py), so there
// is no font engine and no native module at runtime.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
let atlas = null;

/** Loaded once, on the first piece of text drawn. */
function font() {
  if (atlas) return atlas;
  const meta = JSON.parse(readFileSync(join(HERE, "atlas.json"), "utf8"));
  atlas = { ...meta, pixels: gunzipSync(readFileSync(join(HERE, "atlas.bin.gz"))) };
  return atlas;
}

export const rgb = (hex) => ({ r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff });

export function createCanvas(width, height, background = { r: 0, g: 0, b: 0, a: 255 }) {
  const data = Buffer.alloc(width * height * 4);
  const canvas = { width, height, data };
  fillRect(canvas, 0, 0, width, height, background);
  return canvas;
}

/** Source-over blending of one pixel; `a` is 0..255. */
export function blend(canvas, x, y, color, a = 255) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || a <= 0) return;
  const i = (y * canvas.width + x) * 4;
  const data = canvas.data;
  if (a >= 255) {
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
    data[i + 3] = 255;
    return;
  }
  const dstA = data[i + 3];
  const outA = a + (dstA * (255 - a)) / 255;
  if (outA <= 0) return;
  data[i] = Math.round((color.r * a + data[i] * dstA * (255 - a) / 255) / outA);
  data[i + 1] = Math.round((color.g * a + data[i + 1] * dstA * (255 - a) / 255) / outA);
  data[i + 2] = Math.round((color.b * a + data[i + 2] * dstA * (255 - a) / 255) / outA);
  data[i + 3] = Math.round(outA);
}

export function fillRect(canvas, x, y, w, h, color, alpha = color.a ?? 255) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(canvas.width, Math.round(x + w));
  const y1 = Math.min(canvas.height, Math.round(y + h));
  for (let py = y0; py < y1; py += 1) for (let px = x0; px < x1; px += 1) blend(canvas, px, py, color, alpha);
}

/** Rounded rectangle with a soft edge, so corners do not look chewed. */
export function roundedRect(canvas, x, y, w, h, radius, color, alpha = 255) {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const dx = px < r ? r - px - 0.5 : px > w - r - 1 ? px - (w - r) + 0.5 : 0;
      const dy = py < r ? r - py - 0.5 : py > h - r - 1 ? py - (h - r) + 0.5 : 0;
      if (!dx && !dy) {
        blend(canvas, x + px, y + py, color, alpha);
        continue;
      }
      const distance = Math.hypot(dx, dy);
      if (distance <= r - 0.5) blend(canvas, x + px, y + py, color, alpha);
      else if (distance < r + 0.5) blend(canvas, x + px, y + py, color, Math.round(alpha * (r + 0.5 - distance)));
    }
  }
}

/** Box-sampled resize, optionally masked to a circle (avatars). */
export function drawImage(canvas, image, x, y, { width, height, circle = false } = {}) {
  const dw = Math.round(width ?? image.width);
  const dh = Math.round(height ?? image.height);
  const cx = (dw - 1) / 2;
  const cy = (dh - 1) / 2;
  const radius = Math.min(dw, dh) / 2;
  for (let py = 0; py < dh; py += 1) {
    for (let px = 0; px < dw; px += 1) {
      let edge = 255;
      if (circle) {
        const distance = Math.hypot(px - cx, py - cy);
        if (distance > radius) continue;
        if (distance > radius - 1) edge = Math.round(255 * (radius - distance));
      }
      const sx0 = Math.floor((px * image.width) / dw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((px + 1) * image.width) / dw));
      const sy0 = Math.floor((py * image.height) / dh);
      const sy1 = Math.max(sy0 + 1, Math.floor(((py + 1) * image.height) / dh));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < image.height; sy += 1) {
        for (let sx = sx0; sx < sx1 && sx < image.width; sx += 1) {
          const i = (sy * image.width + sx) * 4;
          r += image.rgba[i];
          g += image.rgba[i + 1];
          b += image.rgba[i + 2];
          a += image.rgba[i + 3];
          n += 1;
        }
      }
      if (!n) continue;
      blend(canvas, x + px, y + py, { r: r / n, g: g / n, b: b / n }, Math.round((a / n) * (edge / 255)));
    }
  }
}

const nearestSize = (size) => {
  const sizes = font().sizes;
  return sizes.reduce((best, candidate) => (Math.abs(candidate - size) < Math.abs(best - size) ? candidate : best), sizes[0]);
};

/** Unusual spaces are drawn as ordinary ones rather than as a missing glyph. */
const normalize = (text) => String(text).replace(/[\u2000-\u200a\u205f\u3000]/g, " ");

export function measureText(text, size) {
  const f = font();
  const key = String(nearestSize(size));
  const table = f.glyphs[key];
  let width = 0;
  for (const char of normalize(text)) width += table[char]?.adv ?? table["?"]?.adv ?? 0;
  return { width: Math.ceil(width), height: f.lineHeight[key], ascent: f.ascent[key] };
}

/** Cuts a string to fit `maxWidth`, appending an ellipsis when it had to. */
export function fitText(text, size, maxWidth) {
  const value = normalize(text);
  if (measureText(value, size).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && measureText(`${cut}…`, size).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Draws with (x, y) at the top-left of the line box, like CSS, not at the baseline. */
export function drawText(canvas, text, x, y, size, color, { maxWidth = null, align = "left" } = {}) {
  const f = font();
  const key = String(nearestSize(size));
  const table = f.glyphs[key];
  const value = normalize(maxWidth ? fitText(text, size, maxWidth) : text);
  const total = measureText(value, size).width;
  let penX = align === "right" ? x - total : align === "center" ? x - total / 2 : x;
  // Atlas offsets are already measured from the top of the line box.
  const top = y;

  for (const char of value) {
    const glyph = table[char] ?? table["?"];
    if (!glyph) continue;
    for (let gy = 0; gy < glyph.h; gy += 1) {
      for (let gx = 0; gx < glyph.w; gx += 1) {
        const coverage = f.pixels[(glyph.y + gy) * f.width + glyph.x + gx];
        if (coverage) blend(canvas, Math.round(penX + glyph.ox + gx), Math.round(top + glyph.oy + gy), color, coverage);
      }
    }
    penX += glyph.adv;
  }
  return Math.ceil(penX - x);
}

/** Horizontal progress bar with rounded ends. */
export function progressBar(canvas, x, y, w, h, ratio, { track, fill }) {
  roundedRect(canvas, x, y, w, h, h / 2, track);
  const filled = Math.round(w * Math.max(0, Math.min(1, ratio)));
  if (filled > 1) roundedRect(canvas, x, y, Math.max(filled, h), h, h / 2, fill);
}
