// FWU — where the bot keeps its data (SQLite base, DOG and radio state files).
// Default: bot/data next to the code, as before. With several FWU bots on the
// same VPS, every bot sets PND_DATA_DIR to the same shared folder (for example
// /home/opc/fwu-data): they share one base, and updating one bot's folder never
// moves the data under the others.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = process.env["PND_DATA_DIR"]?.trim()
  ? resolve(process.env["PND_DATA_DIR"].trim())
  : fileURLToPath(new URL("./data/", import.meta.url));

mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export function dataPath(name) {
  return join(DATA_DIR, name);
}
