import test from "node:test";
import assert from "node:assert/strict";
import { encodePng, decodePng } from "./png.js";
import { createCanvas, drawText, drawImage, fillRect, measureText, fitText, roundedRect, progressBar, rgb } from "./canvas.js";

const pixel = (canvas, x, y) => {
  const i = (y * canvas.width + x) * 4;
  return [canvas.data[i], canvas.data[i + 1], canvas.data[i + 2], canvas.data[i + 3]];
};

test("a PNG survives a round trip unchanged", () => {
  const w = 9;
  const h = 6;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    rgba[i * 4] = (i * 13) % 256;
    rgba[i * 4 + 1] = (i * 29) % 256;
    rgba[i * 4 + 2] = (i * 7) % 256;
    rgba[i * 4 + 3] = 255;
  }
  const back = decodePng(encodePng(w, h, rgba));
  assert.equal(back.width, w);
  assert.equal(back.height, h);
  assert.ok(back.rgba.equals(rgba));
});

test("encoding refuses a buffer of the wrong size", () => {
  assert.throws(() => encodePng(4, 4, Buffer.alloc(10)), /incohérente/);
});

test("decoding rejects what is not a PNG, and says why", () => {
  assert.throws(() => decodePng(Buffer.from("pas une image")), /n'est pas un PNG/);
});

test("an opaque RGB round trip keeps every channel", () => {
  const rgba = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]);
  assert.deepEqual([...decodePng(encodePng(2, 1, rgba)).rgba], [...rgba]);
});

test("a canvas starts filled with its background", () => {
  const canvas = createCanvas(4, 3, { r: 10, g: 20, b: 30, a: 255 });
  assert.deepEqual(pixel(canvas, 0, 0), [10, 20, 30, 255]);
  assert.deepEqual(pixel(canvas, 3, 2), [10, 20, 30, 255]);
});

test("filling stays inside the canvas", () => {
  const canvas = createCanvas(4, 4, { r: 0, g: 0, b: 0, a: 255 });
  fillRect(canvas, -5, -5, 100, 100, rgb(0xff0000));
  assert.deepEqual(pixel(canvas, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(canvas, 3, 3), [255, 0, 0, 255]);
  assert.equal(canvas.data.length, 4 * 4 * 4);
});

test("a half-transparent fill blends instead of replacing", () => {
  const canvas = createCanvas(2, 2, { r: 0, g: 0, b: 0, a: 255 });
  fillRect(canvas, 0, 0, 2, 2, rgb(0xffffff), 128);
  const [r] = pixel(canvas, 0, 0);
  assert.ok(r > 100 && r < 160, `mélange attendu, obtenu ${r}`);
});

test("a rounded rectangle leaves its corners alone", () => {
  const canvas = createCanvas(40, 40, { r: 0, g: 0, b: 0, a: 255 });
  roundedRect(canvas, 0, 0, 40, 40, 12, rgb(0xffffff));
  assert.deepEqual(pixel(canvas, 20, 20), [255, 255, 255, 255], "le centre est plein");
  assert.ok(pixel(canvas, 0, 0)[0] < 128, "le coin reste sombre");
});

test("text has a width, and a longer string is wider", () => {
  const short = measureText("ab", 20).width;
  const long = measureText("abcdefgh", 20).width;
  assert.ok(short > 0);
  assert.ok(long > short);
});

test("text too wide is cut with an ellipsis that fits", () => {
  const full = "un pseudo vraiment très long qui ne tient pas";
  const cut = fitText(full, 20, 80);
  assert.ok(cut.endsWith("…"));
  assert.ok(measureText(cut, 20).width <= 80);
  assert.equal(fitText("court", 20, 400), "court", "ce qui tient n'est pas touché");
});

test("French number spacing renders instead of becoming a missing glyph", () => {
  const spaced = (12_345).toLocaleString("fr-FR");
  const canvas = createCanvas(200, 40, { r: 0, g: 0, b: 0, a: 255 });
  const width = drawText(canvas, spaced, 4, 4, 20, rgb(0xffffff));
  assert.ok(width > 0);
  assert.ok(measureText(spaced, 20).width > 0);
  assert.ok(!spaced.split("").some((c) => c === "?"), "le test doit porter sur une vraie espace insécable");
});

test("drawing text puts ink on the canvas", () => {
  const canvas = createCanvas(120, 40, { r: 0, g: 0, b: 0, a: 255 });
  drawText(canvas, "FWU", 4, 4, 26, rgb(0xffffff));
  const lit = [...canvas.data.filter((_, i) => i % 4 === 0)].filter((v) => v > 40).length;
  assert.ok(lit > 20, `du texte devrait être visible, ${lit} pixels allumés`);
});

test("right and centre alignment move the text", () => {
  const canvasRight = createCanvas(120, 30, { r: 0, g: 0, b: 0, a: 255 });
  drawText(canvasRight, "X", 118, 4, 20, rgb(0xffffff), { align: "right" });
  const canvasLeft = createCanvas(120, 30, { r: 0, g: 0, b: 0, a: 255 });
  drawText(canvasLeft, "X", 2, 4, 20, rgb(0xffffff));
  const inkX = (canvas) => {
    for (let x = canvas.width - 1; x >= 0; x -= 1) {
      for (let y = 0; y < canvas.height; y += 1) if (pixel(canvas, x, y)[0] > 40) return x;
    }
    return -1;
  };
  assert.ok(inkX(canvasRight) > inkX(canvasLeft));
});

test("an image is scaled into place and a circle mask clips the corners", () => {
  const source = { width: 2, height: 2, rgba: Buffer.alloc(16, 255) };
  const canvas = createCanvas(20, 20, { r: 0, g: 0, b: 0, a: 255 });
  drawImage(canvas, source, 0, 0, { width: 20, height: 20, circle: true });
  assert.deepEqual(pixel(canvas, 10, 10), [255, 255, 255, 255], "le centre est rempli");
  assert.deepEqual(pixel(canvas, 0, 0), [0, 0, 0, 255], "le coin reste hors du cercle");
});

test("a progress bar grows with its ratio and never overflows", () => {
  const measure = (ratio) => {
    const canvas = createCanvas(100, 12, { r: 0, g: 0, b: 0, a: 255 });
    progressBar(canvas, 0, 0, 100, 10, ratio, { track: rgb(0x222222), fill: rgb(0xff0000) });
    let count = 0;
    for (let x = 0; x < 100; x += 1) if (pixel(canvas, x, 5)[0] > 150) count += 1;
    return count;
  };
  assert.ok(measure(0.5) > measure(0.1));
  assert.ok(measure(1) <= 100);
  assert.ok(measure(5) <= 100, "un ratio aberrant est borné");
});
