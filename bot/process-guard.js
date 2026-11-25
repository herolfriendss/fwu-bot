// Filet pour les promesses rejetées sans `catch` (proposition n°5 de l'Éclaireur).
//
// Avec Node 22+, une seule promesse oubliée arrête le processus : la musique se coupe,
// les vocaux se vident et le domaine passe chez FWU. Ici :
//   • chaque rejet est COMPTÉ et ÉCRIT en entier sur la sortie d'erreur (pm2 logs --err),
//     plus un code fixe dans les événements du bot (jamais de contenu brut dans les rapports) ;
//   • au-delà d'un seuil (par défaut 10 rejets en 10 min), le bot s'arrête volontairement
//     et PM2 le relance : un bug en boucle ne reste pas caché derrière le filet ;
//   • les vraies exceptions (`uncaughtException`) gardent le comportement de Node : arrêt, puis relance par PM2.
// Réglages : PND_REJECTION_LIMIT (nombre) et PND_REJECTION_WINDOW_MIN (minutes).

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_MS = 10 * 60_000;

/** Origine courte d'une erreur : code Discord/Node s'il existe, et premier fichier du bot dans la pile. */
export function describeRejection(reason) {
  const code = reason && typeof reason === "object" && reason.code != null ? String(reason.code).slice(0, 40) : null;
  const name = reason instanceof Error ? reason.name : typeof reason;
  const stack = reason instanceof Error ? String(reason.stack ?? "") : "";
  const frame = stack.split("\n").map((line) => /([\w./-]+\.(?:m?js|ts)):\d+/.exec(line)?.[1]).find((file) => file && !file.includes("node_modules") && !file.startsWith("node:"));
  const module = frame ? frame.split("/").slice(-2).join("/") : null;
  return { code, name, module };
}

export function rejectionLimits(env = process.env) {
  const limit = Number.parseInt(env.PND_REJECTION_LIMIT ?? "", 10);
  const minutes = Number.parseInt(env.PND_REJECTION_WINDOW_MIN ?? "", 10);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
    windowMs: Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : DEFAULT_WINDOW_MS,
  };
}

/** Compteur pur : renvoie { total, recent, overLimit } après avoir noté un rejet à `now`. */
export function createRejectionCounter({ limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS } = {}) {
  const times = [];
  let total = 0;
  let last = null;
  return {
    note(info, now = Date.now()) {
      total += 1;
      last = { ...info, at: now };
      times.push(now);
      while (times.length && now - times[0] > windowMs) times.shift();
      return { total, recent: times.length, overLimit: times.length > limit };
    },
    stats(now = Date.now()) {
      while (times.length && now - times[0] > windowMs) times.shift();
      return { total, recent: times.length, limit, windowMs, last };
    },
  };
}

let counter = null;

export function processGuardStats() {
  return counter?.stats() ?? null;
}

/**
 * À appeler une fois au démarrage. `record(code)` = journal d'événements du bot,
 * `exit(code)` = sortie (process.exit par défaut), `stderr` = écriture brute.
 */
export function installProcessGuard({ record = () => {}, exit = (code) => process.exit(code), stderr = (text) => process.stderr.write(text), env = process.env, target = process } = {}) {
  const limits = rejectionLimits(env);
  counter = createRejectionCounter(limits);
  let stopping = false;
  const handler = (reason) => {
    const info = describeRejection(reason);
    const { total, recent, overLimit } = counter.note(info);
    // L'erreur complète reste visible dans les logs d'erreur PM2 : le filet ne masque rien.
    stderr(`[process-guard] promesse rejetée sans catch n°${total} (${recent} en ${Math.round(limits.windowMs / 60_000)} min)${info.code ? ` code=${info.code}` : ""}${info.module ? ` module=${info.module}` : ""}\n${reason instanceof Error ? reason.stack : String(reason)}\n`);
    record(`unhandled_rejection${info.code ? `:${info.code}` : ""}`);
    if (overLimit && !stopping) {
      stopping = true;
      stderr(`[process-guard] plus de ${limits.limit} rejets en ${Math.round(limits.windowMs / 60_000)} min : arrêt volontaire, PM2 relance le bot.\n`);
      record("unhandled_rejection_restart");
      setTimeout(() => exit(1), 500).unref?.();
    }
  };
  target.on("unhandledRejection", handler);
  return { handler, stats: () => counter.stats() };
}
