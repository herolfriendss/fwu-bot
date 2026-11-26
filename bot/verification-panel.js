// FWU V2 — panneau de vérification refait : bannière, étapes visibles (règlement,
// acceptation, CAPTCHA pendant un raid), message de bienvenue à la fin, état de
// vérification consultable par le staff. Aucun nom de produit affiché : le nom du serveur.
import { bannerUrl } from "./banners.js";
import { db } from "./database.js";

db.exec(`CREATE TABLE IF NOT EXISTS verification_log (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, method TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
)`);

export const VERIFICATION_RULES = Object.freeze([
  ["Respect", "Respecte chaque membre. Insultes, harcèlement et discriminations ne sont pas acceptés."],
  ["Communication", "Pas de spam, de flood, de raid ni de publicité non autorisée."],
  ["Contenus", "Les contenus illégaux, dangereux ou contraires aux règles de Discord sont interdits."],
  ["Vie du serveur", "Utilise les bons salons et suis les consignes du staff."],
  ["Sanctions", "Le non-respect du règlement peut entraîner une sanction ou une exclusion."],
]);

/** Panneau public. `raid` : le CAPTCHA devient une étape obligatoire. */
export function buildVerificationPanel({ guildName, raid = false }) {
  const banner = bannerUrl("verification");
  return {
    title: `🛡️ Règlement et accès — ${String(guildName ?? "le serveur").slice(0, 80)}`,
    description: "Bienvenue ! Trois étapes et tu découvres le serveur.",
    fields: [
      { name: "① Lis le règlement", value: VERIFICATION_RULES.map(([name, text], i) => `**${String(i + 1).padStart(2, "0")} · ${name}** — ${text}`).join("\n") },
      { name: "② Accepte", value: "Réagis avec ✅ sous ce message." },
      { name: raid ? "③ CAPTCHA (obligatoire : mode raid actif)" : "③ CAPTCHA (seulement pendant un raid)", value: raid ? "Le staff a activé la protection anti-raid : termine la vérification avec le CAPTCHA (bouton de vérification), tu reçois les instructions en message privé." : "En temps normal, l'étape ② suffit." },
    ],
    ...(banner ? { image: { url: banner } } : {}),
    footer: { text: "Réagis avec ✅ pour accepter le règlement et accéder au serveur." },
    timestamp: new Date().toISOString(),
  };
}

export function buildWelcomeEmbed(guildName, memberId) {
  return {
    title: `🎉 Bienvenue sur ${String(guildName ?? "le serveur").slice(0, 80)} !`,
    description: `<@${memberId}>, ta vérification est terminée : tu as maintenant accès au serveur.\nPrésente-toi, découvre les salons et n'hésite pas à demander de l'aide au staff.\n\nLe guide des rangs et des sanctions : \`/guide voir\`.`,
  };
}

export function buildRaidCaptchaNotice(guildName, channelId) {
  return {
    title: "🛡️ Vérification renforcée",
    description: `Le serveur ${String(guildName ?? "").slice(0, 80)} est en mode anti-raid. Ton acceptation est enregistrée ; termine avec le CAPTCHA${channelId ? ` (bouton de vérification dans <#${channelId}>)` : ""}. Si aucun CAPTCHA n'est proposé, le staff validera ton accès dès la fin du raid.`,
  };
}

export function recordVerification(guildId, userId, status, method = null, now = Date.now()) {
  db.prepare(`INSERT INTO verification_log(guild_id, user_id, status, method, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET status = excluded.status, method = excluded.method, updated_at = excluded.updated_at`)
    .run(String(guildId), String(userId), status, method, now);
}

/** État consultable par le staff : vérifié, en attente du CAPTCHA, jamais vu. */
export function verificationStatus(guildId, userId, { hasRole = null } = {}) {
  const row = db.prepare("SELECT status, method, updated_at FROM verification_log WHERE guild_id = ? AND user_id = ?").get(String(guildId), String(userId));
  const labels = { verified: "✅ vérifié", pending_captcha: "⏳ en attente du CAPTCHA (mode raid)", accepted: "📝 règlement accepté" };
  const lines = [
    `État : ${row ? labels[row.status] ?? row.status : "aucune vérification enregistrée"}`,
    row ? `Dernière étape : <t:${Math.floor(row.updated_at / 1000)}:R>${row.method ? ` (${row.method})` : ""}` : null,
    hasRole === null ? null : `Rôle de vérification : ${hasRole ? "présent" : "absent"}`,
  ].filter(Boolean);
  return { status: row?.status ?? null, text: lines.join("\n") };
}
