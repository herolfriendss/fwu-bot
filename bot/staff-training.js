// STAFF CENTER (SUCK ME) — formation du staff (tâche 1.5).
//
// S'appuie sur PND Academy (`/academy` : parcours, étapes, quiz, progression) et ajoute :
//   • /staff formation exercice  — simulation (raid, conflit, signalement) : un cas pratique
//     à choix multiples, avec la correction expliquée ;
//   • /staff formation reponse   — le stagiaire répond, score et explications ;
//   • /staff formation valider   — un responsable (SYS+ / OWNER, autre que le stagiaire)
//     certifie un parcours Academy terminé ;
//   • /staff formation certifications — parcours certifiés et exercices d'un membre.
//
// Une formation ou une certification ne donne JAMAIS de rôle ni de permission Discord :
// une promotion reste une décision humaine (/staff promouvoir, garde des rôles protégés).
// Les cas pratiques ne citent que des commandes qui existent (vérifié par les tests).
import { randomUUID } from "node:crypto";
import { db as defaultDb } from "./database.js";

export const SCENARIOS = Object.freeze({
  raid: {
    title: "Simulation de raid",
    intro: "Il est 23 h. En deux minutes, 40 comptes créés aujourd'hui rejoignent le serveur et inondent le salon général de liens.",
    questions: [
      { prompt: "Première chose à faire ?", choices: ["Bannir un par un les comptes qui écrivent", "Déclencher la protection anti-raid (/raid) ou /panic pour couper les arrivées et l'écriture", "Prévenir les membres en MP", "Attendre que ça se calme"], answer: 1, why: "On arrête d'abord l'arrivée et la diffusion ; on traite les comptes ensuite. Bannir à la main pendant que le raid continue ne suffit pas." },
      { prompt: "Les messages déjà postés contiennent des liens douteux. Que faire ?", choices: ["Les laisser comme preuve dans le salon", "Les supprimer avec /purge après avoir gardé une preuve (capture ou lien dans un dossier)", "Fermer le serveur", "Demander aux membres de ne pas cliquer"], answer: 1, why: "La preuve se garde dans un dossier (/staff intervention preuve) ; le salon doit être nettoyé vite pour protéger les membres." },
      { prompt: "Un compte suspect est peut-être un vrai membre. Que faire ?", choices: ["Le bannir par précaution", "Le mettre en /quarantaine et vérifier avant de décider", "L'ignorer", "Lui retirer tous ses rôles à la main"], answer: 1, why: "La quarantaine est réversible ; un bannissement injustifié ne l'est pas vraiment. On vérifie avant de sanctionner." },
      { prompt: "Le raid est terminé. Ensuite ?", choices: ["Rien, c'est fini", "Lever les protections, ouvrir un dossier d'intervention avec le résumé et faire une passation (/staff passation)", "Annoncer le nom des comptes bannis à tout le serveur", "Bannir tous les comptes récents"], answer: 1, why: "On remet le serveur en état, on documente pour l'équipe suivante, et on ne désigne publiquement personne." },
    ],
  },
  conflit: {
    title: "Exercice de gestion de conflit",
    intro: "Deux membres s'insultent dans le salon général depuis dix minutes ; d'autres commencent à prendre parti.",
    questions: [
      { prompt: "Première action ?", choices: ["Répondre publiquement à chacun", "Calmer le salon (/slowmode) et demander aux deux de passer en privé ou en ticket", "Bannir les deux immédiatement", "Supprimer le salon"], answer: 1, why: "On baisse la tension sans punir avant d'avoir compris ; le ralentissement limite l'escalade." },
      { prompt: "L'un des deux est ton ami. Que fais-tu ?", choices: ["Tu tranches en sa faveur", "Tu passes la main à un autre membre du staff et tu le notes dans le dossier", "Tu ignores le conflit", "Tu le préviens en privé de ce qui va se passer"], answer: 1, why: "Un conflit d'intérêts se déclare : un autre membre du staff prend le relais, pour l'équité et pour ta protection." },
      { prompt: "Les insultes continuent malgré l'avertissement. Sanction adaptée ?", choices: ["Un bannissement définitif", "Une sanction graduée selon le barème (/warn puis /tempmute), avec la raison claire", "Rien, pour ne pas faire de vagues", "Retirer ses rôles sans explication"], answer: 1, why: "La sanction suit le barème et la gradation ; elle est motivée et enregistrée, donc contestable." },
      { prompt: "Un des membres conteste la sanction. Que faire ?", choices: ["Refuser toute discussion", "L'orienter vers la contestation (appel) examinée par un autre membre du staff", "Annuler la sanction tout de suite", "Le sanctionner à nouveau"], answer: 1, why: "La contestation est examinée par quelqu'un d'autre que l'auteur de la sanction." },
    ],
  },
  signalement: {
    title: "Exercice de signalement sensible",
    intro: "Un membre t'écrit en privé qu'un autre membre lui envoie des messages qui le mettent mal à l'aise.",
    questions: [
      { prompt: "Comment réagir d'abord ?", choices: ["Lui dire que ce n'est sûrement rien", "L'écouter, le remercier, lui proposer d'ouvrir un ticket pour garder une trace", "Publier l'histoire pour avertir les autres", "Bannir l'autre membre tout de suite"], answer: 1, why: "On accueille le signalement sans le minimiser, et on le fait passer dans un canal suivi et confidentiel." },
      { prompt: "Il t'envoie des captures. Où les ranger ?", choices: ["Dans le salon staff public", "Dans un dossier d'intervention (preuves), accès staff seulement", "Sur ton ordinateur seulement", "Dans le salon général"], answer: 1, why: "Les preuves vont dans un dossier suivi, réservé au staff, jamais dans un salon public." },
      { prompt: "La situation touche peut-être un mineur ou un danger réel. Que faire ?", choices: ["La gérer seul", "Prévenir immédiatement un responsable (SYS+ / OWNER) et suivre les règles de Discord (signalement à Discord)", "Attendre d'avoir plus d'éléments", "En parler au membre mis en cause"], answer: 1, why: "Les cas graves remontent tout de suite aux responsables et à Discord ; on ne mène pas l'affaire seul." },
    ],
  },
});

export function ensureTrainingTables(db = defaultDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_training_runs (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, trainee_id TEXT NOT NULL, trainer_id TEXT NOT NULL,
      scenario TEXT NOT NULL, started_at INTEGER NOT NULL, answers TEXT, score INTEGER, finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS staff_training_runs_member ON staff_training_runs(guild_id, trainee_id);
    CREATE TABLE IF NOT EXISTS staff_certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, member_id TEXT NOT NULL,
      track_id TEXT NOT NULL, track_title TEXT NOT NULL, certified_by TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE (guild_id, member_id, track_id)
    );
  `);
}

export function startExercise({ guildId, traineeId, trainerId, scenario }, { db = defaultDb, now = Date.now() } = {}) {
  ensureTrainingTables(db);
  const sc = SCENARIOS[scenario];
  if (!sc) return { error: `Exercice inconnu (${Object.keys(SCENARIOS).join(", ")}).` };
  const id = randomUUID().slice(0, 8);
  db.prepare("INSERT INTO staff_training_runs(id, guild_id, trainee_id, trainer_id, scenario, started_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, String(guildId), traineeId, trainerId, scenario, now);
  return { id, scenario: sc };
}

export function formatExercise(id, sc, traineeId) {
  const letters = "ABCD";
  return [
    `🎓 **${sc.title}** pour <@${traineeId}> — exercice \`${id}\``,
    `> ${sc.intro}`,
    ...sc.questions.map((q, i) => `**${i + 1}. ${q.prompt}**\n${q.choices.map((c, j) => `${letters[j]}) ${c}`).join("\n")}`),
    `Réponds avec \`/staff formation reponse id:${id} reponses:${sc.questions.map(() => "A").join(",")}\` (remplace par tes lettres).`,
  ].join("\n").slice(0, 1950);
}

/** Only the trainee answers, once. Returns the score and the explanations. */
export function answerExercise({ guildId, id, userId, answers }, { db = defaultDb, now = Date.now() } = {}) {
  ensureTrainingTables(db);
  const run = db.prepare("SELECT * FROM staff_training_runs WHERE id = ? AND guild_id = ?").get(String(id).trim(), String(guildId));
  if (!run) return { error: "Exercice introuvable sur ce serveur." };
  if (run.trainee_id !== userId) return { error: "Seul le stagiaire de cet exercice peut y répondre." };
  if (run.finished_at) return { error: "Tu as déjà répondu à cet exercice." };
  const sc = SCENARIOS[run.scenario];
  const letters = String(answers ?? "").toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if (letters.length !== sc.questions.length || letters.some((l) => !/^[A-D]$/.test(l))) return { error: `Il faut ${sc.questions.length} lettres (A à D), par exemple ${sc.questions.map(() => "A").join(",")}.` };
  const picks = letters.map((l) => l.charCodeAt(0) - 65);
  const score = picks.filter((p, i) => p === sc.questions[i].answer).length;
  db.prepare("UPDATE staff_training_runs SET answers = ?, score = ?, finished_at = ? WHERE id = ?").run(letters.join(","), score, now, run.id);
  const details = sc.questions.map((q, i) => `${picks[i] === q.answer ? "✅" : "❌"} ${i + 1}. Bonne réponse : ${"ABCD"[q.answer]}. ${q.why}`);
  return { score, total: sc.questions.length, details, scenario: sc.title, trainerId: run.trainer_id };
}

/** Certification of a completed Academy track by a manager other than the member. */
export function certify({ guildId, memberId, actorId, canManage, track, progress }, { db = defaultDb, now = Date.now() } = {}) {
  ensureTrainingTables(db);
  if (!canManage) return { error: "Validation réservée aux SYS+ et à l'OWNER." };
  if (memberId === actorId) return { error: "Tu ne peux pas valider ta propre formation." };
  if (!track) return { error: "Parcours introuvable : donne l'identifiant affiché par `/academy liste`." };
  if (!progress?.complete) return { error: `Parcours pas terminé (${progress?.completedSteps?.length ?? 0}/${progress?.stepCount ?? "?"} étapes).` };
  const result = db.prepare("INSERT OR IGNORE INTO staff_certifications(guild_id, member_id, track_id, track_title, certified_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(String(guildId), memberId, track.trackId, String(track.title).slice(0, 100), actorId, now);
  if (!result.changes) return { error: "Ce parcours est déjà certifié pour ce membre." };
  return { ok: true };
}

export function trainingRecord(guildId, memberId, { db = defaultDb } = {}) {
  ensureTrainingTables(db);
  return {
    certifications: db.prepare("SELECT track_title, certified_by, created_at FROM staff_certifications WHERE guild_id = ? AND member_id = ? ORDER BY created_at DESC").all(String(guildId), memberId),
    exercises: db.prepare("SELECT scenario, score, finished_at FROM staff_training_runs WHERE guild_id = ? AND trainee_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 10").all(String(guildId), memberId)
      .map((r) => ({ ...r, total: SCENARIOS[r.scenario]?.questions.length ?? 0, title: SCENARIOS[r.scenario]?.title ?? r.scenario })),
  };
}
