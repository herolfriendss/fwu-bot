// Reusable, reviewed staff response templates. Templates never send automatically;
// callers must present the rendered text to a staff member for review first.

const clean = (value, max = 160) => String(value ?? "")
  .replace(/@(everyone|here)/gi, "@​$1")
  .replace(/<@!?\d{5,20}>/g, "@membre")
  .replace(/<@&\d{5,20}>/g, "@rôle")
  .replace(/<#\d{5,20}>/g, "#salon")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

export const RESPONSE_TEMPLATES = Object.freeze({
  ticket: Object.freeze([
    Object.freeze({
      id: "received",
      label: "Demande reçue",
      description: "Confirmer la prise en charge.",
      body: "Bonjour {{member}}, ta demande dans le ticket #{{ticket_id}} a bien été reçue. {{staff}} la prend en charge et reviendra vers toi dès que possible.",
    }),
    Object.freeze({
      id: "need-info",
      label: "Informations nécessaires",
      description: "Demander les précisions utiles.",
      body: "Bonjour {{member}}, pour avancer sur le ticket #{{ticket_id}} concernant « {{subject}} », peux-tu nous transmettre les précisions ou captures utiles ? Pense à masquer toute information personnelle ou tout secret.",
    }),
    Object.freeze({
      id: "in-progress",
      label: "En cours",
      description: "Informer que le dossier est en cours d'analyse.",
      body: "Bonjour {{member}}, le ticket #{{ticket_id}} est en cours d'analyse par {{staff}}. Nous te tiendrons informé dès que nous aurons un résultat.",
    }),
    Object.freeze({
      id: "resolved",
      label: "Résolu",
      description: "Confirmer la résolution avant fermeture.",
      body: "Bonjour {{member}}, le problème signalé dans le ticket #{{ticket_id}} semble résolu. Peux-tu confirmer que tout fonctionne correctement ?",
    }),
  ]),
});

export function listResponseTemplates(category = "ticket") {
  return (RESPONSE_TEMPLATES[category] ?? []).map(({ id, label, description }) => ({ id, label, description }));
}

export function renderResponseTemplate(category, templateId, variables = {}) {
  const template = (RESPONSE_TEMPLATES[category] ?? []).find((entry) => entry.id === templateId);
  if (!template) return null;
  const values = {
    member: clean(variables.member ?? "bonjour"),
    staff: clean(variables.staff ?? "le staff"),
    ticket_id: clean(variables.ticket_id ?? "—", 20),
    subject: clean(variables.subject ?? "ta demande", 120),
    server: clean(variables.server ?? "ce serveur", 100),
  };
  return template.body
    .replace(/\{\{([a-z_]+)\}\}/g, (_, key) => values[key] ?? "")
    .replace(/@(everyone|here)/gi, "@​$1")
    .slice(0, 1900);
}
