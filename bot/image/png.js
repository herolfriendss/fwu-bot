// Minimal PNG reader and writer, built on node:zlib alone.
//
// The bots draw profile cards on a VPS where no image library is installed,
// and adding a native dependency to the installer is not worth it. Only what
// the cards need is supported: 8-bit, non-interlaced, greyscale/RGB/RGBA.
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA pixels (4 bytes each, row-major) to a PNG file. */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error("Taille de l'image incohérente.");
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none — zlib compresses flat art well enough
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** PNG file to RGBA pixels. Throws on the formats the cards never need. */
export function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("Ce fichier n'est pas un PNG.");
  let offset = 8;
  let header = null;
  const parts = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        depth: data[8], colorType: data[9], interlace: data[12],
      };
    } else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header) throw new Error("PNG sans en-tête.");
  if (header.depth !== 8) throw new Error("PNG non géré : seuls les PNG 8 bits sont lus.");
  if (header.interlace) throw new Error("PNG non géré : image entrelacée.");
  const channels = CHANNELS[header.colorType];
  if (!channels) throw new Error("PNG non géré : image à palette.");

  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("PNG tronqué.");

  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const value = line[x];
      out[y * stride + x] = (filter === 0 ? value
        : filter === 1 ? value + a
        : filter === 2 ? value + b
        : filter === 3 ? value + ((a + b) >> 1)
        : value + paeth(a, b, c)) & 0xff;
    }
  }

  if (channels === 4) return { width, height, rgba: out };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i += 1, p += channels) {
    const [r, g, b, a] = channels === 1 ? [out[p], out[p], out[p], 255]
      : channels === 2 ? [out[p], out[p], out[p], out[p + 1]]
      : [out[p], out[p + 1], out[p + 2], 255];
    rgba.writeUInt8(r, i * 4);
    rgba.writeUInt8(g, i * 4 + 1);
    rgba.writeUInt8(b, i * 4 + 2);
    rgba.writeUInt8(a, i * 4 + 3);
  }
  return { width, height, rgba };
}
