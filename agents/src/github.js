/** Crée un ticket GitHub pour une proposition validée (facultatif). */
export async function createIssue({ token, repo, proposal, fetchImpl = fetch }) {
  const d = proposal.details;
  const body = [
    `**${proposal.kind === "correctif" ? "Correctif" : "Nouvelle fonctionnalité"}** · concerne : ${d.bot_concerne} · priorité : ${d.priorite} · effort : ${d.effort}`,
    "",
    d.description,
    "",
    "### Pourquoi",
    d.pourquoi,
    "",
    `_Proposé par l'${proposal.agent} (proposition #${proposal.id}), validé par le propriétaire dans #agents._`,
  ].join("\n");
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "her-agents",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: proposal.title, body, labels: ["agents"] }),
  });
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  const json = await res.json();
  return json.html_url;
}
