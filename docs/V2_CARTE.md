# FWU V2 — carte du code (tâche 0, 26/11/2026)

Carte de référence pour les tâches V2 : elle évite de ré-auditer le projet. Les tableaux
« bruts » sont regénérés par `python3 scripts/v2-carte-data.py [roles|perms|ephemeral|timers|routing]`.

## 1. Modules principaux

| Domaine | Fichiers | Bot propriétaire |
|---|---|---|
| Démarrage, routage des événements | `bot/index.js` (≈1 760 lignes, ≈50 handlers enchaînés) | les 6 (profil `RUNTIME.profile`) |
| Profils, préfixes, propriété des commandes | `src/lib/bot-profiles.ts` (`PREFIX_COMMAND_OWNERS`, `DEFAULT_PREFIXES`), `bot/bot-runtime.js` (`loadBotPrefixes`, baux de domaine, relais de logs `bot_log_outbox`) | — |
| Hiérarchie (cible au-dessus / en dessous) | `bot/hierarchy-guard.js` (slash **et préfixe** depuis la V2), `bot/owner-shield.js` (couche discord.js, `runAsActor`), `target-hierarchy-policy.js`, `staff-hierarchy*.js` | les 6 |
| Garde des attributions de rôles | `bot/role-grant-guard.js` | les 6 |
| Bouclier palier 0 % | `bot/tier0-shield.js` | SUCK ME |
| Gel d'urgence du staff | `bot/shared/freeze.js`, `staff-freeze-gate.js`, `systems/sysplus/freeze-commands.js` | SUCK ME |
| SYS+ / ADMIN+ / WHITELIST | `bot/systems/sysplus/*` | SUCK ME |
| Rôles perso | `systems/sysplus/member-roles.js`, `custom-roles.js` | SUCK ME |
| DOG / MENOTTE / WAKEUP / Anti-Move | `dog-*.js`, `voice-commands.js`, `wakeup.js`, `anti-move*.js` | SUCK ME |
| Vocal privé / temporaire | `voice-v2.js`, `voice-lock-store.js`, `voice-access-store.js`, `voice-permissions.js`, `voice-session-reconciliation.js`, `voice-move.js` | FDPDLAVOC |
| Sécurité (anti-nuke, automod, piège, quarantaine) | `bot/guard/*`, `guard-commands.js`, `guild-guard*.js`, `moderation.js` | GUARD |
| Logs | `logs.js`, `logs-hub.js` (19 salons, routage par regex `logChannelKey`), `logs-coverage.js`, relais `bot-runtime.js` | FWU (hub) |
| Réponses | `interaction-reply.js` (`respondInPlace`), `banners.js`, `prefix-reply-wording` (`prefixifyPayload`/`slashifyPayload` dans `prefix-to-slash.js`) | les 6 |
| Règlement, screening, vérification | `embeds.js`, `reaction-verification.js` | FWU / GUARD |
| Matrice des droits | `permission-matrix.js` | — |
| Présence | `presence.js` | les 6 |
| Économie / jeux | `economy*.js`, `casino/*`, `games.js`, `features/fisc.js` | LE FISC |

## 2. Ordre de routage

### messageCreate (`bot/index.js`, `handleMessageCreate`)

1. MP → modmail (SUCK ME) ; message de bot ou serveur hors liste/hub → ignoré.
2. Préfixe : `parsePrefixedMessage` ; seul le bot propriétaire traite (`ownCommand`), contenu réécrit en forme canonique `=`.
3. `freezeRefusal` (gel du staff) puis **`checkPrefixHierarchy` (nouveau, V2)**.
4. Piège GUARD (`checkHoneypotMessage`), automod GUARD, niveaux FWU, Guardian (risque).
5. Handlers préfixés dans l'ordre : guardian-review, comptage, historique staff, vérification par réaction, WAOUF, commandes GUARD, `;mv`, RESUME, blacklist, LIVE, DM ALL, DOG, LOCKNAME, Knowledge, tickets, rôles perso, rôles (`=rank`, `=rankall`), radio, musique, vocal, économie, entreprises, PND Intelligence, automatisation, organisation, social, cartes, jeux, casino, Invest +, présence vocale, automatisation (réponses), mémoire IA, SYS+, puis réponses IA/mots-clés.

Toute commande à préfixe s'exécute dans `runAsActor(auteur)` : la couche `owner-shield.js` applique donc la règle de rang aux actions nuisibles (ban, kick, timeout, pseudo, retrait de rôle, mute…).

### Ordre de routage interactionCreate (index.js)

1. `freezeRefusal` (ligne 1575)
2. `slashCommandOwner` (ligne 1579)
3. `handleStaffModerationInteraction` (ligne 1589)
4. `handleEmbedInteraction` (ligne 1590)
5. `checkInteractionHierarchy` (ligne 1594)
6. `handleToolsInteraction` (ligne 1600)
7. `handleResumeInteraction` (ligne 1601)
8. `handleDmAllInteraction` (ligne 1602)
9. `handleUndogAllInteraction` (ligne 1603)
10. `handleBlacklistInteraction` (ligne 1604)
11. `handleGuardInteraction` (ligne 1605)
12. `handleCommunityInteraction` (ligne 1606)
13. `handleFiscInteraction` (ligne 1607)
14. `handleVersusInteraction` (ligne 1608)
15. `handleSelfUpdateInteraction` (ligne 1609)
16. `handleSuckmeInteraction` (ligne 1610)
17. `handleMusicExtrasInteraction` (ligne 1611)
18. `handleLiveInteraction` (ligne 1612)
19. `runPrefixFromSlash` (ligne 1616)
20. `handleAiMemoryInteraction` (ligne 1622)
21. `handlePndIntelligenceInteraction` (ligne 1623)
22. `handlePackInteraction` (ligne 1624)
23. `handleMarketInteraction` (ligne 1625)
24. `handleWhitelistInteraction` (ligne 1626)
25. `handleLocknameInteraction` (ligne 1627)
26. `handleWaoufInteraction` (ligne 1628)
27. `handleSysPlusInteraction` (ligne 1629)
28. `handleCustomRolesInteraction` (ligne 1636)
29. `handleRoleInteraction` (ligne 1637)
30. `handlePanelSetupInteraction` (ligne 1639)
31. `handleCoreSlashInteraction` (ligne 1652)
32. `handleGuildGuardInteraction` (ligne 1653)
33. `handleStaffModerationInteraction` (ligne 1658)
34. `handleEmbedInteraction` (ligne 1659)
35. `handleModerationInteraction` (ligne 1660)
36. `handleVoiceV2Interaction` (ligne 1661)
37. `handleShieldInteraction` (ligne 1664)
38. `handleQuestInteraction` (ligne 1665)
39. `handleClanInteraction` (ligne 1666)
40. `handleOverviewInteraction` (ligne 1667)
41. `handleConfessionInteraction` (ligne 1668)
42. `handleInvestPlusInteraction` (ligne 1669)
43. `handleAnimationInteraction` (ligne 1670)
44. `handleCasinoInteraction` (ligne 1671)
45. `handlePerkInteraction` (ligne 1672)
46. `handleGamesInteraction` (ligne 1673)
47. `handleKnowledgeInteraction` (ligne 1674)
48. `handleTicketsInteraction` (ligne 1675)
49. `handleWebhookInteraction` (ligne 1680)
50. `handleAutomationInteraction` (ligne 1681)
51. `handleV4SlashInteraction` (ligne 1686)
52. `handleEconomyInteraction` (ligne 1693)
53. `handleMusicInteraction` (ligne 1694)
54. `handleVoiceInteraction` (ligne 1695)
55. `handleSavedSlashCommand` (ligne 1696)

## 3. Chemins qui donnent ou retirent un rôle (53 appels hors tests)

Statut vis-à-vis de `role-grant-guard.js` (G = gardé, O = OWNER seul, R = restauration volontairement hors garde, P = rôle créé sans permission, — = retrait) :

| Fichier | Chemin | Statut |
|---|---|---|
| `rankall-runner.js:276` | rankall (relit le rôle à chaque membre) | G (`assertRoleGrantable` automatic dans `role-commands.js`) + revérification permissions par membre |
| `rankall-runner.js:370` | annulation rankall | — |
| `role-commands.js:75-76` | `=rank` / `/rank` / `/removerole` | G (actorId) |
| `embeds.js:430` | écran d'adhésion (règlement accepté) | G automatic |
| `reaction-verification.js:183` | vérification par réaction | G automatic |
| `moderation.js:515` | CAPTCHA validé | G automatic |
| `automation.js:40` | rôle automatique | G automatic |
| `automation-rules-commands.js:47-48` | règles d'automatisation | G automatic |
| `features/community.js:101,336` | niveaux, anniversaire | G automatic |
| `features/perks.js:114,121` | couleur de pseudo / avantage | G automatic |
| `economy.js:878` | boutique | G automatic |
| `economy.js:383-388` | transfert de rôle entre membres | G automatic (sens direct) ; sens inverse = R |
| `features/investplus-commands.js:213,219` | formule Invest + | G automatic |
| `features/suckme.js:68,73,85` | `/roletemp` | G actorId |
| `features/suckme.js:202,204` | `/staff promouvoir/retrograder` | G actorId |
| `guild-guard.js:112`, `guard/shield.js:85` | quarantaine automatique | G automatic |
| `guard/commands.js:176-180` | `/quarantaine ajouter` (retrait + rôle quarantaine, rollback) | G |
| `guard/commands.js:191-192` | fin de quarantaine | **R** (rend les rôles sauvegardés) |
| `guard/anti-nuke.js:148` | retrait des rôles dangereux | — |
| `systems/sysplus/commands.js:907-908` | `/sysp add/remove` | O |
| `systems/sysplus/whitelist-commands.js:97,106` | WHITELIST | O |
| `systems/sysplus/freeze-commands.js:22,40` | gel / dégel ADMIN+ | — / R (au nom de l'OWNER, garde appelée) |
| `systems/sysplus/member-roles.js:126` | rôle perso donné | P (rôle créé à zéro permission) |
| `dog-commands.js:210-761` | rôle de laisse | P (créé sans permission, réutilisé seulement s'il est sans permission) |
| `tier0-shield.js:183` | rôle 0 % remis | R |
| `permission-matrix.js:44-46` | `Set.add` (simulation, pas un appel Discord) | n/a |

Restaurations hors garde (R) : fin de quarantaine, sens inverse du transfert, dégel ADMIN+, rôle 0 % remis, libération DOG (rôle de laisse retiré seulement). Décision : elles restent hors garde de **privilège** (le membre avait déjà ces rôles) mais passeront par le filtre BLR (tâche 3).

## 4. Dérogations de permissions (revue tâche 0)

≈53 tests directs `has(Administrator|ManageGuild|ManageRoles)` hors tests. Classement :

**Vérification des permissions du bot** (pas une autorisation d'humain) : `tickets.js:360`, `embeds.js:375`, `custom-roles.js:55`, `sysplus/commands.js:896,941`, `whitelist-commands.js:79`, `panel-setup.js:117`, `dog-commands.js:43,215`, `voice-move.js:111`, `guild-guard.js:106`, `reaction-verification.js:56,178`, `moderation.js:450,504`, `automation-rules-commands.js:40`, `voice-access-requests.js:339`, `voice-commands.js:156,574`, `autoconfig.js:120`, `role-commands.js:67,101,205,216`, `install-check.js:115`.

**Dérogations voulues (documentées)** — une permission Discord équivalente vaut autorisation :
- Administrateur / Gérer le serveur : gestion des tickets (`tickets.js:33`), panneau `/setup` (`panel-setup.js:54`), administration LE FISC (`features/fisc.js:13`), musique staff (`music/music.js:391,617`), rôle automatique (`automation.js:14`), jeux (`games.js:30`), économie admin (`economy.js:350`), vérification par réaction (`reaction-verification.js:26`), GuildGuard (`guild-guard-commands.js:12-13`), bouclier GUARD (`guard/shield-commands.js:15`), revue staff (`staff-audit.js:71`), CAPTCHA (`moderation.js:292`).
- Gérer les rôles/salons/messages : actions PND Intelligence après confirmation (`pnd-intelligence.js:51-64,159`) — la création de rôle se fait **toujours à zéro permission**.
- Gérer les salons / Admin : vocal temporaire (`voice-v2.js:648`), demandes d'accès vocal (`voice-access-requests.js:301,344`), déplacement (`voice-commands.js:407`), blocage vocal (`voice-commands.js:589` protège un Admin d'un blocage).
- Staff pour le gel : `sysplus/commands.js:302,636` (« Gérer le serveur/les rôles » comptés comme staff — voulu).
- DOG : `dog-commands.js:571` (un Administrateur peut retirer une laisse).
- Autres dérogations par conception : OWNER unique (`PND_OWNER_DISCORD_ID`), propriétaire du serveur Discord, liste de confiance de l'anti-nuke (OWNER seulement), rôles/salons exemptés de l'automod.

**Failles corrigées (tâche 0)** :
1. `hierarchy-guard.js` s'ouvrait en cas d'erreur de lecture du membre ciblé (limite de requêtes, réseau) : désormais seuls Unknown Member (10007) et Unknown User (10013) valent « absent » ; toute autre erreur → refus. Tests : `hierarchy-guard.test.js`.
2. Les commandes à préfixe (`=dog`, `=wakeup`, `=lockname`, `=menotte`…) n'avaient pas le contrôle central de hiérarchie (seulement les contrôles des modules et la couche `owner-shield` pour les actions nuisibles ; un déplacement vocal ou l'ajout d'un rôle de laisse ne sont pas « nuisibles » pour cette couche). `checkPrefixHierarchy` applique la même règle, sur le même chemin que la forme slash (`prefixHierarchyPath`). Tests : `hierarchy-guard.test.js`.

## 5. Préfixes et commandes préfixées par bot (`src/lib/bot-profiles.ts`)

| Bot | Préfixe par défaut | Commandes préfixées |
|---|---|---|
| FWU | aucun (slash uniquement, imposé par `validatePrefixes`) | — |
| GUARD | `+` | ban, unban, kick, blacklist, purge, nettoyer, slowmode, lock, unlock, guardian-review, verification |
| FDPDLAVOC | `;` | pv, unpv, access, unaccess, panel, demandevocal, mv, accessall, play, p, pause, resume, skip, stop, queue, nowplaying, np, volume, vol, loop, shuffle, clearqueue, remove, join, leave, musicpanel, radio |
| SUCK ME | `=` | sysp, rank, addrole, removerole, rankall, rolepanel, staffhistory, vocalpresence, lockname, unlockname, locknamelist, automation, autorule, knowledge, dog, undog, doginfo, doglist, menotte, unmenotte, menotteinfo, wakeup, anti-moove, anti-move, wouaf, waouf, dmall, ticket, candidature(s), ia, pndia, profil(e), bio, color, couleur, rep, rephistorique, rephistory, toprep, giveaway, event, pndevent, academy, award, story, radar, wrapped, afk, live |
| LE FISC | `-` | balance, solde, daily, work, job, mission, bank, history, rob, lottery, pay, leaderboard, inventory, shop, buy, market, auction, pnd, pnd-history, pnd-audit, pnd-add, pnd-remove, roulette, blackjack, casino, business, invest, dice, coinflip, trivia, card(s), pack, trade(s) |
| Invest + | `$` | abonnement, abo |

## 6. Tableaux générés

### Appels roles.add/remove/set (53)

| Fichier:ligne | Code |
|---|---|
| `automation-rules-commands.js:47` | `await target.roles.add(role, "Automatisation PND confirmée par le staff");` |
| `automation-rules-commands.js:48` | `} else await target.roles.remove(role, "Automatisation PND confirmée par le staff");` |
| `automation.js:40` | `await member.roles.add(roleId, "Rôle automatique");` |
| `dog-commands.js:210` | `await currentMember.roles.remove(previousRole, "DOG : passage au rôle du maître").catch(() => {});` |
| `dog-commands.js:218` | `await currentMember.roles.add(leashRole, "DOG : maintien du rôle de laisse");` |
| `dog-commands.js:518` | `await target.roles.add(leashRole, Mis en laisse par ${message.author.tag});` |
| `dog-commands.js:523` | `await target.roles.remove(leashRole, "Annulation de la laisse DOG échouée").catch(() => {});` |
| `dog-commands.js:597` | `if (role && target.roles.cache.has(role.id)) await target.roles.remove(role, Laisse retirée par ${message.author.tag});` |
| `dog-commands.js:688` | `await member.roles.remove(record.leashRoleId, Laisses retirées en masse par ${actorTag});` |
| `dog-commands.js:761` | `for (const role of roles) await member.roles.remove(role, Ancienne laisse DOG retirée par ${actorTag});` |
| `economy.js:383` | `await runAsActor(from.id, () => from.roles.remove(role, "Transfert de rôle PND"));` |
| `economy.js:385` | `await to.roles.add(role, "Transfert de rôle PND");` |
| `economy.js:387` | `if (to.roles.cache.has(roleId)) await runAsActor(to.id, () => to.roles.remove(role, "Annulation du transfert PND")).catch(() => {});` |
| `economy.js:388` | `if (removed && !from.roles.cache.has(roleId)) await from.roles.add(role, "Restauration après échec PND").catch(() => {});` |
| `economy.js:878` | `await message.member.roles.add(role, Achat boutique PND (${price}));` |
| `embeds.js:430` | `await member.roles.add(config.role_id, "Règlement accepté (écran d'adhésion)");` |
| `features/community.js:101` | `if (grantable.length) await member.roles.add(grantable, Niveau ${after} atteint).catch(() => {});` |
| `features/community.js:321` | `if (member?.roles?.cache?.has(given.role_id)) await member.roles.remove(given.role_id, "Fin de l'anniversaire").catch(() => {});` |
| `features/community.js:336` | `await member.roles.add(roleId, "Anniversaire").catch(() => {});` |
| `features/investplus-commands.js:213` | `if (take && take !== give && member.roles.cache.has(take)) await member.roles.remove(take, "Invest + : fin de formule").catch(() => null);` |
| `features/investplus-commands.js:219` | `return (await member.roles.add(role, "Invest + : formule active").then(() => null).catch(() => "le bot ne peut pas donner ce rôle (place du rôle du bo` |
| `features/perks.js:114` | `if (!member.roles.cache.has(existing.id)) await member.roles.add(existing, reason);` |
| `features/perks.js:121` | `await member.roles.add(role, reason);` |
| `features/suckme.js:68` | `await member.roles.add(role, Rôle temporaire donné par ${interaction.user.id});` |
| `features/suckme.js:73` | `await member.roles.remove(role, Rôle temporaire retiré par ${interaction.user.id}).catch(() => {});` |
| `features/suckme.js:85` | `if (member?.roles?.cache?.has(row.role_id)) await member.roles.remove(row.role_id, "Fin du rôle temporaire").catch(() => {});` |
| `features/suckme.js:202` | `await member.roles.add(step.add, ${sub === "promouvoir" ? "Promotion" : "Rétrogradation"} par ${interaction.user.id});` |
| `features/suckme.js:204` | `if (step.remove) await member.roles.remove(step.remove, ${sub === "promouvoir" ? "Promotion" : "Rétrogradation"} par ${interaction.user.id});` |
| `guard/anti-nuke.js:148` | `await member.roles.remove(dangerous, "Anti-nuke : actions destructrices en masse");` |
| `guard/commands.js:176` | `if (removable.length) await member.roles.remove(removable, Quarantaine par ${interaction.user.id} : ${reason});` |
| `guard/commands.js:177` | `await member.roles.add(role, Quarantaine par ${interaction.user.id} : ${reason});` |
| `guard/commands.js:180` | `if (removable.length) await member.roles.add(removable).catch(() => {});` |
| `guard/commands.js:191` | `if (roleId && member.roles.cache.has(roleId)) await member.roles.remove(roleId, Fin de quarantaine par ${interaction.user.id});` |
| `guard/commands.js:192` | `if (saved.length) await member.roles.add(saved, Fin de quarantaine par ${interaction.user.id});` |
| `guard/shield.js:85` | `const ok = grantable && await member.roles.add(quarantineRoleId, reason).then(() => true).catch(() => false);` |
| `guild-guard.js:112` | `await member.roles.add(role, "GuildGuard : quarantaine");` |
| `moderation.js:515` | `await freshMember.roles.add(role, "CAPTCHA validé");` |
| `permission-matrix.js:44` | `if (tier === "sysplus" && sysPlusRoleId) roles.add(sysPlusRoleId);` |
| `permission-matrix.js:45` | `if (tier === "adminplus" && adminPlusRoleId) roles.add(adminPlusRoleId);` |
| `permission-matrix.js:46` | `if (tier === "whitelist" && whitelistRoleId) roles.add(whitelistRoleId);` |
| `rankall-runner.js:276` | `await fresh.roles.add(` |
| `rankall-runner.js:370` | `await runAsActor(null, () => member.roles.remove(role, Rankall ${job.id} annulé));` |
| `reaction-verification.js:183` | `await member.roles.add(role, "Acceptation du règlement PND par réaction ✅");` |
| `role-commands.js:75` | `if (add) await target.roles.add(role, Gestion des rôles par ${actor.id});` |
| `role-commands.js:76` | `else await target.roles.remove(role, Gestion des rôles par ${actor.id});` |
| `systems/sysplus/commands.js:907` | `if (subcommand === "add") await target.roles.add(role, SYS+ attribué par le propriétaire ${member.id});` |
| `systems/sysplus/commands.js:908` | `else await target.roles.remove(role, SYS+ retiré par le propriétaire ${member.id});` |
| `systems/sysplus/freeze-commands.js:22` | `try { await member.roles.remove(roleId, "Gel d'urgence du staff (owner)"); removed.push(member.id); } catch { /* rôle trop haut : signalé par le compt` |
| `systems/sysplus/freeze-commands.js:40` | `try { await member.roles.add(roleId, "Fin du gel d'urgence : ADMIN+ rendu"); restored += 1; } catch { failed += 1; }` |
| `systems/sysplus/member-roles.js:126` | `await target.roles.add(role, Rôle perso donné par ${actor.id});` |
| `systems/sysplus/whitelist-commands.js:97` | `await target.roles.add(role, WHITELIST attribuée par le propriétaire ${actor.id});` |
| `systems/sysplus/whitelist-commands.js:106` | `await target.roles.remove(role, WHITELIST retirée par le propriétaire ${actor.id});` |
| `tier0-shield.js:183` | `changes.push({ kind: "rôle 0 % retiré", key: "$remove", action: () => newMember.roles.add(removed.map((role) => role.id), "Rôle 0 % : intouchable"), t` |

### Modifications de permissions de salons (24)

| Fichier:ligne | Code |
|---|---|
| `autoconfig.js:106` | `const ok = await channel.permissionOverwrites.edit(roleId, { ViewChannel: false, SendMessages: false, Connect: false }, { reason: "Rôle de quarantaine` |
| `guard-commands.js:111` | `await message.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: locked ? false : null }, { reason: GUARD ${parsed.command} par ` |
| `guard/shield.js:232` | `const ok = await channel.permissionOverwrites.edit(guild.id, { SendMessages: false }, { reason })` |
| `guard/shield.js:251` | `const ok = await channel.permissionOverwrites.edit(guild.id, { SendMessages: null }, { reason })` |
| `moderation.js:380` | `await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: locked ? false : null }, { reason: Modération par ${interac` |
| `tickets.js:235` | `await channel.permissionOverwrites.edit(user.id, {` |
| `tickets.js:247` | `await channel.permissionOverwrites.delete(user.id, Ticket #${row.id} : retrait par ${interaction.user.tag}).catch(() => {});` |
| `voice-access-requests.js:351` | `await channel.permissionOverwrites.edit(requester, { ViewChannel: true, Connect: true }, PND Voice Access accepté par ${actor.id});` |
| `voice-access-requests.js:353` | `await channel.permissionOverwrites.edit(requester, { ViewChannel: true, Connect: false }, PND Voice Access bloqué par ${actor.id});` |
| `voice-commands.js:72` | `await channel.permissionOverwrites.edit(` |
| `voice-commands.js:102` | `await channel.permissionOverwrites.edit(` |
| `voice-commands.js:502` | `await channel.permissionOverwrites.edit(target, { Connect: true }, Accès vocal accordé par ${message.author.tag} avec =access);` |
| `voice-commands.js:505` | `await channel.permissionOverwrites.edit(target, { Connect: null }, Accès vocal retiré par ${message.author.tag} avec =unaccess);` |
| `voice-commands.js:599` | `await channel.permissionOverwrites.edit(target, { Connect: action === "allow" }, Accès vocal depuis le panneau par ${interaction.user.tag});` |
| `voice-lock-store.js:191` | `await channel.permissionOverwrites.edit(` |
| `voice-move.js:121` | `await channel.permissionOverwrites.edit(member, { ViewChannel: true, Connect: true }, ;accessall par ${author.user?.tag ?? author.id});` |
| `voice-v2.js:128` | `await channel.permissionOverwrites.edit(id, perms, { type: OverwriteType.Member, reason: "Vocal V2 : listes du propriétaire" }).catch(() => {});` |
| `voice-v2.js:196` | `await channel.permissionOverwrites.edit(previousOwnerId, OWNER_REVOKE, { type: OverwriteType.Member, reason }).catch(() => {});` |
| `voice-v2.js:197` | `await channel.permissionOverwrites.edit(nextOwnerId, OWNER_GRANT, { type: OverwriteType.Member, reason }).catch(() => {});` |
| `voice-v2.js:426` | `await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member, reason: Vocal V2 : invitation ` |
| `voice-v2.js:435` | `await channel.permissionOverwrites.edit(target.id, { Connect: false }, { type: OverwriteType.Member, reason: Vocal V2 : expulsion par ${member.user.t` |
| `voice-v2.js:474` | `if (owned) await owned.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member, reason: "Vocal V2 : me` |
| `voice-v2.js:485` | `await owned.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: null }, { type: OverwriteType.Member, reason: "Vocal V2 : membre bloqu` |
| `voice-v2.js:494` | `if (owned) await owned.permissionOverwrites.edit(targetId, { Connect: null, ViewChannel: null }, { type: OverwriteType.Member, reason: "Vocal V2 : ret` |

### Réponses éphémères (481 occurrences, 57 fichiers)

| Fichier | Nombre |
|---|---|
| `v4-commands.js` | 103 |
| `systems/sysplus/commands.js` | 69 |
| `moderation.js` | 29 |
| `voice-access-requests.js` | 20 |
| `role-commands.js` | 18 |
| `index.js` | 16 |
| `games.js` | 15 |
| `tickets.js` | 14 |
| `systems/setup/panel-setup.js` | 12 |
| `voice-v2.js` | 12 |
| `automation.js` | 10 |
| `systems/sysplus/custom-roles.js` | 9 |
| `systems/sysplus/whitelist-commands.js` | 9 |
| `webhooks.js` | 9 |
| `guild-guard-commands.js` | 8 |
| `dmall.js` | 7 |
| `embeds.js` | 7 |
| `pnd-knowledge.js` | 7 |
| `features/fisc.js` | 6 |
| `features/self-update.js` | 6 |
| `guard/shield-commands.js` | 6 |
| `casino/commands.js` | 5 |
| `staff-moderation.js` | 5 |
| `systems/marketplace/commands.js` | 5 |
| `features/community.js` | 4 |
| `features/quests-commands.js` | 4 |
| `pnd-intelligence.js` | 4 |
| `blacklist.js` | 3 |
| `economy.js` | 3 |
| `features/confessions-commands.js` | 3 |
| `features/investplus-commands.js` | 3 |
| `features/overview.js` | 3 |
| `live-commands.js` | 3 |
| `resume.js` | 3 |
| `systems/entitlements/commands.js` | 3 |
| `voice-commands.js` | 3 |
| `dog-commands.js` | 2 |
| `features/animation-commands.js` | 2 |
| `features/perks-commands.js` | 2 |
| `guard/commands.js` | 2 |
| `interaction-reply.js` | 2 |
| `music/music.js` | 2 |
| `systems/creator/commands.js` | 2 |
| `systems/lockname/commands.js` | 2 |
| `systems/sysplus/abuse-alerts.js` | 2 |
| `systems/sysplus/freeze-commands.js` | 2 |
| `systems/sysplus/member-card.js` | 2 |
| `systems/sysplus/staff-notes.js` | 2 |
| `systems/sysplus/staff-stats.js` | 2 |
| `systems/waouf/commands.js` | 2 |
| `features/clans-commands.js` | 1 |
| `features/suckme.js` | 1 |
| `features/tools-commands.js` | 1 |
| `features/versus.js` | 1 |
| `interaction-response.js` | 1 |
| `interaction-watchdog.js` | 1 |
| `systems/sysplus/member-roles.js` | 1 |

### Minuteries de fond (setInterval / setTimeout longs) (44)

| Fichier:ligne | Code |
|---|---|
| `automation.js:90` | `const timer = setInterval(() => {` |
| `business-investments-maintenance.js:29` | `const timer = setInterval(run, Math.min(DAY_MS, 60 * 60_000));` |
| `games.js:175` | `const timer = setInterval(() => {` |
| `index.js:170` | `setInterval(() => { tickDomainLease(); }, LEASE_RENEW_MS).unref?.();` |
| `index.js:1077` | `setInterval(() => { if (serves("fwu")) void tickVoiceXp(communityGuilds()).catch(() => record("levels_error")); }, 60_000).unref?.();` |
| `index.js:1078` | `setInterval(() => { if (serves("fwu")) void runReminders(client).catch(() => record("reminders_error")); }, 30_000).unref?.();` |
| `index.js:1079` | `setInterval(() => { if (serves("fwu")) void runBirthdays(communityGuilds()).catch(() => record("birthdays_error")); }, 5 * 60_000).unref?.();` |
| `index.js:1081` | `setInterval(() => { if (serves("suckme")) void announceUpdateResult(client).catch(() => {}); }, 2 * 60_000).unref?.();` |
| `index.js:1083` | `setInterval(() => { if (serves("suckme")) void runQotd(communityGuilds()).catch(() => record("qotd_error")); }, 5 * 60_000).unref?.();` |
| `index.js:1085` | `setInterval(() => {` |
| `index.js:1091` | `setInterval(() => { if (serves("fisc")) void runVersusExpiry(client).catch(() => record("versus_error")); }, 60_000).unref?.();` |
| `index.js:1093` | `setInterval(() => {` |
| `index.js:1100` | `setInterval(() => {` |
| `index.js:1108` | `setInterval(() => {` |
| `index.js:1133` | `const analyticsTimer = setInterval(() => flushAnalyticsMetrics(), 60_000);` |
| `index.js:1137` | `const intelligenceExpiryTimer = setInterval(() => {` |
| `index.js:1142` | `const guardianRetentionTimer = setInterval(() => {` |
| `index.js:1148` | `const scheduledAutomationTimer = setInterval(() => {` |
| `index.js:1172` | `const relayTimer = setInterval(() => {` |
| `index.js:1186` | `const resumeRetentionTimer = setInterval(() => { try { pruneResumeEvents(); } catch { record("resume_retention_error"); } }, 60 * 60_000);` |
| `index.js:1189` | `const voiceHandoverTimer = setInterval(() => {` |
| `index.js:1242` | `const liveAlertsTimer = setInterval(() => { if (serves("fwu")) void checkLiveAlerts(client, settings, record).catch(() => record("live_alert_feed_erro` |
| `index.js:1244` | `const economyTimer = setInterval(() => { if (serves("fisc")) void reportEconomy(); }, 5 * 60_000);` |
| `index.js:1247` | `const activityTimer = setInterval(() => { if (serves("fwu")) void reportActivity(); }, 15 * 60_000);` |
| `index.js:1249` | `const auctionSettlementTimer = setInterval(() => {` |
| `index.js:1281` | `const economyReconcileTimer = setInterval(() => { if (serves("fisc")) void runEconomyReconciliation(10 * 60_000); }, 10 * 60_000);` |
| `index.js:1298` | `const cascadeTimer = setInterval(drain, 20_000);` |
| `index.js:1300` | `const pruneTimer = setInterval(() => { try { pruneEvents(); } catch { record("event_prune_error"); } }, 6 * 60 * 60_000);` |
| `index.js:1308` | `const menotteExpiryTimer = setInterval(() => {` |
| `index.js:1314` | `const voiceAccessExpiryTimer = setInterval(() => {` |
| `index.js:1326` | `const transcriptPurgeTimer = setInterval(() => {` |
| `index.js:1332` | `const healthTimer = setInterval(checkHealthAlerts, 5 * 60_000);` |
| `index.js:1334` | `const antiMoveSnapshotTimer = setInterval(() => {` |
| `index.js:1343` | `const waoufExpiryTimer = setInterval(() => {` |
| `index.js:1732` | `setInterval(sync, 60_000);` |
| `index.js:1733` | `setInterval(reportStatus, 20_000);` |
| `index.js:1758` | `setInterval(() => gatewayWatchdog.check(), 15_000).unref?.();` |
| `organization-maintenance.js:71` | `const timer = setInterval(() => { void run(); }, 60 * 60_000);` |
| `presence.js:135` | `const timer = setInterval(apply, config.interval * 1000);` |
| `shared/audit.js:122` | `flushTimer = setInterval(() => { void flushOutbox(); }, 60_000);` |
| `shared/retention.js:47` | `setInterval(() => {` |
| `staff-freeze-gate.js:48` | `const timer = setInterval(tick, REFRESH_MS);` |
| `systems/sysplus/freeze-commands.js:102` | `const timer = setInterval(() => { void run(); }, 60_000);` |
| `systems/sysplus/staff-notes.js:67` | `const timer = setInterval(run, 24 * 3600_000);` |
