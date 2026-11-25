#!/usr/bin/env node
// FWU — surveillance extérieure des 5 bots principaux et d’Invest + (facultatif) (proposition n°3 de l'Éclaireur).
//
// Lancée chaque minute par une tâche cron du VPS, HORS des bots : si un bot plante,
// ou si FWU lui-même s'arrête, cette tâche le voit quand même. Elle prévient par un
// webhook Discord (salon staff), uniquement quand l'état change :
//   🔴 « GUARD arrêté depuis 2 min »  →  🟢 « GUARD revenu »
//   🟧 plus de 50 logs en attente      →  🟢 file revenue à la normale
//   🟧 disque du VPS rempli à plus de 90 %
//   🔴 dernière sauvegarde échouée ou plus vieille que 36 h (si les sauvegardes sont installées)
// Lecture seule : ne redémarre rien, ne touche à aucune donnée.
//
// Installation (une fois, sur le VPS) :
//   1. Créer un webhook dans un salon staff, puis :  install -m 600 /dev/stdin ~/fwu-data/.alerte-webhook  (coller l'URL, Entrée, Ctrl+D)
//   2. (crontab -l 2>/dev/null; echo "* * * * * $(command -v node) $HOME/fwu-surveillance.mjs") | crontab -
//   3. Essai :  node ~/fwu-surveillance.mjs --test   (envoie un message d'essai)
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PROCESSES = Object.freeze([
  { name: "her-v5-bot", label: "FWU" },
  { name: "fwu-guard", label: "GUARD" },
  { name: "fwu-fdpdlavoc", label: "FDPDLAVOC" },
  { name: "fwu-suckme", label: "SUCK ME" },
  { name: "fwu-fisc", label: "LE FISC" },
  { name: "fwu-investplus", label: "Invest +", optional: true },
]);
export const DOWN_GRACE_MS = 2 * 60_000;
export const OUTBOX_LIMIT = 50;
export const DISK_LIMIT_PERCENT = 90;
export const BACKUP_MAX_AGE_MS = 36 * 60 * 60_000;
export const FLAP_RESTARTS = 3;

const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

/**
 * Pur : compare l'état précédent aux observations et renvoie le nouvel état et les messages à envoyer.
 * `observed` = { processes: { name: { online, restarts } } | null, outbox: number | null, diskPercent: number | null, backup: { ok, at } | null }
 */
export function evaluate(previous = {}, observed, now = Date.now()) {
  const state = {
    processes: {},
    outboxAlert: Boolean(previous.outboxAlert),
    diskAlert: Boolean(previous.diskAlert),
    backupAlert: Boolean(previous.backupAlert),
    pm2Alert: Boolean(previous.pm2Alert),
  };
  const messages = [];

  if (!observed.processes) {
    if (!state.pm2Alert)
      messages.push(
        "🔴 PM2 ne répond pas sur le VPS : impossible de vérifier les bots.",
      );
    state.pm2Alert = true;
    state.processes = previous.processes ?? {};
  } else {
    if (state.pm2Alert) messages.push("🟢 PM2 répond de nouveau.");
    state.pm2Alert = false;
    for (const { name, label, optional = false } of PROCESSES) {
      const before = previous.processes?.[name] ?? {};
      const presentInPm2 = Object.hasOwn(observed.processes, name);
      const seen = observed.processes[name] ?? {
        online: false,
        restarts: before.restarts ?? 0,
      };

      // Invest + is optional. Do not alert while it has never appeared in PM2;
      // once installed/observed, a later stop must be monitored like every bot.
      const monitored = !optional || Boolean(before.monitored) || presentInPm2;
      if (!monitored) {
        state.processes[name] = {
          restarts: Number(before.restarts ?? seen.restarts ?? 0),
          monitored: false,
          downSince: null,
          alerted: false,
          restartWindow: Array.isArray(before.restartWindow)
            ? before.restartWindow
            : [],
        };
        continue;
      }

      const entry = {
        restarts: Number(seen.restarts ?? 0),
        monitored: true,
        downSince: null,
        alerted: false,
        restartWindow: Array.isArray(before.restartWindow)
          ? before.restartWindow
          : [],
      };
      if (!seen.online) {
        entry.downSince = before.downSince ?? now;
        entry.alerted = Boolean(before.alerted);
        if (!entry.alerted && now - entry.downSince >= DOWN_GRACE_MS) {
          messages.push(
            `🔴 **${label}** arrêté depuis ${minutes(now - entry.downSince)} min${name === "her-v5-bot" ? " : plus de Logs Hub ni de domaines repris" : " : FWU reprend ses événements, mais ses commandes ne marchent plus"}.`,
          );
          entry.alerted = true;
        }
      } else if (before.alerted) {
        messages.push(
          `🟢 **${label}** revenu (arrêté environ ${minutes(now - (before.downSince ?? now))} min).`,
        );
      }
      // Redémarrages en boucle : PM2 relance, le bot paraît « online » mais tombe sans cesse.
      const added = Math.max(
        0,
        entry.restarts - Number(before.restarts ?? entry.restarts),
      );
      entry.restartWindow = [
        ...entry.restartWindow,
        ...Array(added).fill(now),
      ].filter((at) => now - at < 10 * 60_000);
      entry.flapAlerted =
        Boolean(before.flapAlerted) && entry.restartWindow.length > 0;
      if (entry.restartWindow.length >= FLAP_RESTARTS && !entry.flapAlerted) {
        messages.push(
          `🟧 **${label}** a redémarré ${entry.restartWindow.length} fois en 10 min : regarde \`pm2 logs ${name} --err --lines 50\`.`,
        );
        entry.flapAlerted = true;
      }
      state.processes[name] = entry;
    }
  }

  if (observed.outbox != null) {
    if (observed.outbox > OUTBOX_LIMIT && !state.outboxAlert) {
      messages.push(
        `🟧 ${observed.outbox} logs des bots attendent d'être publiés par FWU.`,
      );
      state.outboxAlert = true;
    } else if (observed.outbox <= OUTBOX_LIMIT / 2 && state.outboxAlert) {
      messages.push("🟢 Les logs en attente ont été publiés.");
      state.outboxAlert = false;
    }
  }
  if (observed.diskPercent != null) {
    if (observed.diskPercent >= DISK_LIMIT_PERCENT && !state.diskAlert) {
      messages.push(
        `🟧 Disque du VPS rempli à ${observed.diskPercent} % : les sauvegardes et les mises à jour risquent d'échouer.`,
      );
      state.diskAlert = true;
    } else if (
      observed.diskPercent < DISK_LIMIT_PERCENT - 5 &&
      state.diskAlert
    ) {
      messages.push(`🟢 Disque du VPS revenu à ${observed.diskPercent} %.`);
      state.diskAlert = false;
    }
  }
  if (observed.backup) {
    const stale =
      !observed.backup.at ||
      now - observed.backup.at * 1000 > BACKUP_MAX_AGE_MS;
    const bad = !observed.backup.ok || stale;
    if (bad && !state.backupAlert) {
      messages.push(
        stale
          ? "🔴 Aucune sauvegarde réussie depuis plus de 36 h."
          : `🔴 Dernière sauvegarde échouée : ${observed.backup.step ?? "voir ~/fwu-data/sauvegarde.log"}.`,
      );
      state.backupAlert = true;
    } else if (!bad && state.backupAlert) {
      messages.push("🟢 Sauvegarde de nouveau réussie.");
      state.backupAlert = false;
    }
  }
  return { state, messages };
}

/** Lit `pm2 jlist` : { name: { online, restarts } }, ou null si PM2 ne répond pas. */
export function parsePm2List(text) {
  try {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) return null;
    return Object.fromEntries(
      list.map((p) => [
        p.name,
        {
          online: p.pm2_env?.status === "online",
          restarts: Number(p.pm2_env?.restart_time ?? 0),
        },
      ]),
    );
  } catch {
    return null;
  }
}

function readEnvValue(file, key) {
  try {
    const line = readFileSync(file, "utf8")
      .split("\n")
      .reverse()
      .find((l) => l.startsWith(`${key}=`));
    return line
      ? line
          .slice(key.length + 1)
          .trim()
          .replace(/^["']|["']$/g, "")
      : null;
  } catch {
    return null;
  }
}

async function countOutbox(home) {
  const envFile = join(home, "her-v5-production/bot/.env");
  const dataDir =
    readEnvValue(envFile, "PND_DATA_DIR") ||
    join(home, "her-v5-production/bot/data");
  const path =
    readEnvValue(envFile, "HER_DB_PATH") || join(dataDir, "economy.sqlite");
  if (!existsSync(path)) return null;
  try {
    const sqliteModule = "node:sqlite";
    const { DatabaseSync } = await import(/* @vite-ignore */ sqliteModule);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return Number(
        db.prepare("SELECT COUNT(*) AS n FROM bot_log_outbox").get()?.n ?? 0,
      );
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function diskPercent(path) {
  try {
    const s = statfsSync(path);
    return Math.round(100 * (1 - s.bavail / s.blocks));
  } catch {
    return null;
  }
}

async function send(webhook, content) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: content.slice(0, 1900),
      username: "Surveillance FWU",
      allowed_mentions: { parse: [] },
    }),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

async function main() {
  const home = process.env.FWU_HOME || "/home/opc";
  const data = join(home, "fwu-data");
  const webhookFile = join(data, ".alerte-webhook");
  const webhook = existsSync(webhookFile)
    ? readFileSync(webhookFile, "utf8").trim()
    : "";
  if (
    !/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(
      webhook,
    )
  ) {
    console.error(`Webhook absent ou invalide dans ${webhookFile}.`);
    process.exit(2);
  }
  if (process.argv.includes("--test")) {
    await send(
      webhook,
      "✅ Surveillance FWU : message d'essai, le webhook marche.",
    );
    return;
  }

  let pm2Text = "";
  try {
    pm2Text = execFileSync("pm2", ["jlist"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:${home}/.npm-global/bin`,
      },
    });
  } catch {
    /* PM2 ne répond pas */
  }
  let backup = null;
  try {
    backup = JSON.parse(
      readFileSync(join(data, "sauvegarde-status.json"), "utf8"),
    );
  } catch {
    /* pas encore installée */
  }
  const observed = {
    processes: parsePm2List(pm2Text),
    outbox: await countOutbox(home),
    diskPercent: diskPercent(home),
    backup,
  };

  const statePath = join(data, "surveillance-state.json");
  let previous = {};
  try {
    previous = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    /* premier passage */
  }
  const { state, messages } = evaluate(previous, observed);
  if (messages.length) {
    try {
      await send(webhook, messages.join("\n"));
    } catch (error) {
      console.error(`Envoi impossible : ${error.message}`);
      return;
    } // état non enregistré : nouvel essai à la prochaine minute
  }
  writeFileSync(`${statePath}.tmp`, JSON.stringify(state));
  renameSync(`${statePath}.tmp`, statePath);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
