// Her? V4 — read-only PND economy export.
//
// SQLite remains the source of truth. This script only opens the database in
// read-only mode and writes a portable JSON file for backup or migration. It
// never modifies, deletes or vacuums the economy data.
//
// Usage:
//   node scripts/export-economy.js [output.json] [--force]
//   ECONOMY_DB=/path/to/economy.sqlite node scripts/export-economy.js
import { existsSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const force = args.includes("--force");
const output = resolve(args.find((arg) => !arg.startsWith("--")) ?? `economy-export-${new Date().toISOString().slice(0, 10)}.json`);
const databasePath = process.env.ECONOMY_DB
  ? resolve(process.env.ECONOMY_DB)
  : fileURLToPath(new URL("../data/economy.sqlite", import.meta.url));

if (!existsSync(databasePath)) {
  console.error(`❌ Base introuvable : ${databasePath}`);
  console.error("   Démarre le bot une première fois ou indique ECONOMY_DB=/chemin/vers/economy.sqlite.");
  process.exit(1);
}
if (existsSync(output) && !force) {
  console.error(`❌ Le fichier ${output} existe déjà. Utilise --force pour le remplacer.`);
  process.exit(1);
}

const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const read = (sql) => db.prepare(sql).all();
  const payload = {
    format: "her-pnd-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    source: basename(databasePath),
    tables: {
      wallets: read("SELECT guild_id, user_id, balance FROM wallets ORDER BY guild_id, user_id"),
      ledger: read("SELECT id, guild_id, user_id, delta, reason, created_at FROM economy_ledger ORDER BY id"),
      dailyClaims: read("SELECT guild_id, user_id, claimed_at FROM daily_claims ORDER BY guild_id, user_id"),
      shopItems: read("SELECT guild_id, role_id, price FROM shop_items ORDER BY guild_id, role_id"),
      activeBlackjack: read("SELECT game_id, guild_id, user_id, bet, player_cards, dealer_cards, created_at FROM active_blackjack ORDER BY created_at"),
    },
  };

  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  const counts = Object.fromEntries(Object.entries(payload.tables).map(([name, rows]) => [name, rows.length]));
  console.log(`✅ Export PND écrit dans ${output}`);
  console.log(`   ${Object.entries(counts).map(([name, count]) => `${name}: ${count}`).join(" · ")}`);
  console.log("   Aucune donnée n’a été modifiée dans la base SQLite.");
} finally {
  db.close();
}
