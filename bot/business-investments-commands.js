import {
  createBusiness,
  getBusiness,
  listBusinesses,
  hireBusinessEmployee,
  setBusinessSalary,
  removeBusinessEmployee,
  collectBusinessRevenue,
  withdrawBusinessTreasury,
  runBusinessPayroll,
  getGuildInvestmentPolicy,
  setGuildInvestmentPolicy,
  createInvestment,
  closeInvestment,
  listInvestments,
} from "./business-investments.js";

const noMentions = { parse: [] };
const money = (value) => `${Number(value).toLocaleString("fr-FR")} PND`;
const idFrom = (value) => String(value ?? "").replace(/[<@!>]/g, "");
const help = [
  "**🏢 Entreprises PND**",
  "`=business list` · `=business create nom` · `=business info ID`",
  "`=business hire ID @membre` · `=business salary ID @membre montant` · `=business fire ID @membre`",
  "`=business deposit ID montant` · `=business withdraw ID montant` · `=business payroll ID`",
  "**📈 Investissements PND**",
  "`=invest create montant [risque_bps]` · `=invest list` · `=invest close ID` · `=invest policy défaut_bps maximum_bps`",
  "Monnaie virtuelle uniquement. Le risque est borné par les paramètres du serveur.",
].join("\n");

function hasPermission(member, bit) {
  try { return Boolean(member?.permissions?.has?.(BigInt(bit))); } catch { return false; }
}

function isGuildManager(message) {
  return Boolean(
    message.guild?.ownerId === message.author.id ||
    hasPermission(message.member, 8) ||
    hasPermission(message.member, 32),
  );
}

async function reply(message, content) {
  await message.reply({ content, allowedMentions: noMentions });
}

export async function handleBusinessInvestmentMessage(message) {
  const match = String(message.content ?? "").trim().match(/^=(business|invest)(?:\s+([\s\S]*))?$/i);
  if (!match) return false;
  if (!message.guild || !message.author || message.author.bot) return true;

  const group = match[1].toLowerCase();
  const parts = (match[2] ?? "").trim().split(/\s+/).filter(Boolean);
  const action = (parts.shift() ?? "help").toLowerCase();
  const guildId = message.guild.id;
  const actorId = message.author.id;
  try {
    if (action === "help" || action === "aide" || action === "panel") {
      await reply(message, help);
      return true;
    }

    if (group === "business") {
      if (action === "list") {
        const rows = listBusinesses(guildId);
        const lines = rows.map((row) => `• **${row.name}** · ID \`${row.id}\` · trésorerie ${money(row.treasury)} · propriétaire <@${row.owner_id}>`);
        await reply(message, lines.length ? `**🏢 Entreprises PND**\n${lines.join("\n")}` : "Aucune entreprise sur ce serveur. Crée la première avec `=business create nom`.");
      } else if (action === "create") {
        const name = parts.join(" ");
        const business = createBusiness({ guildId, ownerId: actorId, name });
        await reply(message, `✅ Entreprise **${business.name}** créée. Son identifiant est \`${business.id}\`.`);
      } else if (action === "info") {
        const business = getBusiness(guildId, parts[0]);
        const employees = business.employees.map((row) => `• <@${row.user_id}> · ${row.role === "owner" ? "propriétaire" : `salaire ${money(row.salary)}`}`);
        await reply(message, `**🏢 ${business.name}**\nID : \`${business.id}\`\nTrésorerie : **${money(business.treasury)}**\n${employees.join("\n") || "Aucun membre."}`);
      } else if (action === "hire" || action === "fire") {
        const businessId = parts[0];
        const target = message.mentions.users.first();
        if (!target || target.bot) throw new Error("Mentionne un membre humain du serveur.");
        if (action === "hire") {
          hireBusinessEmployee({ guildId, businessId, actorId, userId: target.id });
          await reply(message, `✅ <@${target.id}> rejoint l'entreprise.`);
        } else {
          removeBusinessEmployee({ guildId, businessId, actorId, userId: target.id });
          await reply(message, `✅ <@${target.id}> a quitté l'entreprise.`);
        }
      } else if (action === "salary") {
        const businessId = parts[0];
        const target = message.mentions.users.first();
        const rawAmount = parts.find((part) => /^\d+$/.test(part));
        if (!target || !rawAmount) throw new Error("Utilisation : `=business salary ID @membre montant`.");
        const result = setBusinessSalary({ guildId, businessId, actorId, userId: target.id, salary: Number(rawAmount) });
        await reply(message, `✅ Salaire de <@${target.id}> fixé à **${money(result.salary)}** par période.`);
      } else if (action === "deposit") {
        const [businessId, rawAmount] = parts;
        const result = collectBusinessRevenue({ guildId, businessId, actorId, payerId: actorId, amount: Number(rawAmount), requestId: message.id });
        await reply(message, result.duplicate ? "Ce dépôt a déjà été traité." : "✅ Contribution versée à la trésorerie de l'entreprise.");
      } else if (action === "withdraw") {
        const [businessId, rawAmount] = parts;
        const result = withdrawBusinessTreasury({ guildId, businessId, actorId, amount: Number(rawAmount), requestId: message.id });
        await reply(message, result.duplicate ? "Ce retrait a déjà été traité." : "✅ Retrait effectué depuis la trésorerie de l'entreprise.");
      } else if (action === "payroll") {
        const businessId = parts[0];
        const periodKey = new Date().toISOString().slice(0, 7);
        const result = runBusinessPayroll({ guildId, businessId, actorId, periodKey });
        await reply(message, `**Paie ${periodKey}**\n✅ Payés : ${result.paid.length}\n⚠️ En attente : ${result.unpaid.length}${result.unpaid.length ? `\n${result.unpaid.map((row) => `• <@${row.userId}> : ${row.reason}`).join("\n")}` : ""}`);
      } else {
        throw new Error("Commande inconnue. Utilise `=business aide`.");
      }
    } else if (group === "invest") {
      if (action === "create") {
        const principal = Number(parts[0]);
        const riskBps = parts[1] === undefined ? null : Number(parts[1]);
        const investment = createInvestment({ guildId, userId: actorId, principal, riskBps });
        await reply(message, `✅ Placement créé · principal **${money(investment.principal)}** · risque **${investment.risk_bps / 100}%** · ID \`${investment.id}\`. Les variations sont simulées et bornées.`);
      } else if (action === "list") {
        const rows = listInvestments(guildId, actorId);
        const lines = rows.map((row) => `• \`${row.id}\` · ${money(row.current_value)} / ${money(row.principal)} · risque ${row.risk_bps / 100}% · ${row.status}`);
        await reply(message, lines.length ? `**📈 Tes placements**\n${lines.join("\n")}` : "Tu n'as aucun placement sur ce serveur.");
      } else if (action === "close") {
        const result = closeInvestment({ guildId, investmentId: parts[0], userId: actorId, requestId: message.id });
        await reply(message, result.duplicate ? "Ce retrait a déjà été traité." : `✅ Placement clôturé. Retour sur ton portefeuille : **${money(result.payout)}**.`);
      } else if (action === "policy") {
        if (!isGuildManager(message)) throw new Error("Seul le propriétaire ou un administrateur du serveur peut modifier le risque.");
        const policy = setGuildInvestmentPolicy({ guildId, actorId, defaultRiskBps: Number(parts[0]), maxRiskBps: Number(parts[1]) });
        await reply(message, `✅ Politique d'investissement mise à jour · défaut ${policy.defaultRiskBps / 100}% · maximum ${policy.maxRiskBps / 100}%.`);
      } else if (action === "status") {
        const policy = getGuildInvestmentPolicy(guildId);
        await reply(message, `**Risque des investissements**\nDéfaut : ${policy.defaultRiskBps / 100}%\nMaximum : ${policy.maxRiskBps / 100}%`);
      } else {
        throw new Error("Commande inconnue. Utilise `=invest aide`.");
      }
    }
    return true;
  } catch (error) {
    await reply(message, `❌ ${error instanceof Error ? error.message : "Opération impossible."}`).catch(() => {});
    return true;
  }
}
