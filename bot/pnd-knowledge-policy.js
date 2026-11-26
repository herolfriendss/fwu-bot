export const KNOWLEDGE_TOPICS = Object.freeze([
  {
    key: "permissions",
    label: "Permissions & hiérarchie",
    title: "Permissions du serveur",
    content: "**Owner PND** : propriétaire unique des bots.\n**Cofondateurs** : rôle de confiance distinct, sans statut Owner.\n**SYS+** : accès aux outils SYS+ prévus, sans héritage automatique des scopes ADMIN+.\n**ADMIN+** : accès limité aux scopes explicitement activés.\n**WHITELIST** : exemption interne de certaines limites uniquement.\n\nLes permissions natives Discord, la hiérarchie des rôles et les contrôles de chaque module restent obligatoires.",
  },
  {
    key: "recruitment",
    label: "Recrutement",
    title: "Recrutement",
    content: "Les informations de recrutement sont publiées par l'équipe du serveur. Consulte les annonces et les consignes de candidature avant de contacter le staff.\n\n*L'équipe peut modifier ce texte depuis `/knowledge edit`.*",
  },
  {
    key: "tickets",
    label: "Tickets & assistance",
    title: "Support et tickets",
    content: "Pour demander de l'aide, ouvre un ticket depuis le panneau de support. Décris clairement ta demande et ajoute les informations utiles. Ne partage jamais de mot de passe, token ou donnée sensible.\n\n*L'équipe peut modifier ce texte depuis `/knowledge edit`.*",
  },
  {
    key: "rules",
    label: "Règlement",
    title: "Règlement du serveur",
    content: "Le règlement officiel de ce serveur doit être publié et maintenu par son équipe. En attendant sa personnalisation, demande les règles applicables à un membre du staff avant toute action qui pourrait les enfreindre.",
  },
  {
    key: "guide",
    label: "Guide du serveur",
    title: "Guide du serveur",
    content: "Bienvenue sur le serveur. Consulte les salons d'informations, respecte les consignes affichées et utilise les salons adaptés à tes échanges. En cas de doute, contacte l'équipe via le support.\n\n*L'équipe peut modifier ce texte depuis `/knowledge edit`.*",
  },
  {
    key: "sysplus",
    label: "Guide SYS+",
    title: "Guide SYS+",
    content: "SYS+ donne accès à des outils privilégiés définis par les bots. SYS+ ne signifie pas ADMIN+ : les scopes administratifs sont configurés séparément. Les permissions Discord et la hiérarchie des rôles restent applicables.\n\nLes actions sensibles sont journalisées lorsqu'un module le prévoit.",
  },
]);

const topicByKey = new Map(KNOWLEDGE_TOPICS.map((topic) => [topic.key, topic]));

export function getKnowledgeTopic(key) {
  return topicByKey.get(String(key ?? "").trim().toLowerCase()) ?? null;
}

export function normalizeKnowledgePage({ title, content }) {
  const normalizedTitle = String(title ?? "").replace(/\s+/g, " ").trim();
  const normalizedContent = String(content ?? "").trim();
  if (normalizedTitle.length < 2 || normalizedTitle.length > 100) {
    throw new Error("Le titre doit contenir entre 2 et 100 caractères.");
  }
  if (normalizedContent.length < 5 || normalizedContent.length > 4000) {
    throw new Error("Le contenu doit contenir entre 5 et 4 000 caractères.");
  }
  return { title: normalizedTitle, content: normalizedContent };
}

export function parseKnowledgePrefixCommand(content) {
  const raw = String(content ?? "").trim();
  if (!/^=knowledge(?:\s|$)/i.test(raw)) return null;
  const rest = raw.replace(/^=knowledge\s*/i, "");
  if (!rest || /^panel$/i.test(rest)) return { action: "panel" };
  const show = rest.match(/^show\s+([a-z-]+)$/i);
  if (show) return { action: "show", topic: show[1].toLowerCase() };
  // Format: =knowledge edit topic | titre | contenu
  const edit = rest.match(/^edit\s+([a-z-]+)\s*\|\s*([^|]{2,100})\s*\|\s*([\s\S]{5,4000})$/i);
  if (edit) return { action: "edit", topic: edit[1].toLowerCase(), title: edit[2].trim(), content: edit[3].trim() };
  return { action: "help" };
}
