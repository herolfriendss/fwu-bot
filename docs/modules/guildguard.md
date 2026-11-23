# GuildGuard

GuildGuard applique les règles de compte récent, de rafale anti-raid et de confinement séparément par guild. Une rafale déclenche une alerte; elle ne suffit pas à expulser un membre ancien. Pendant une rafale, l’action automatique configurée ne vise que les comptes qui échouent aussi au seuil d’âge minimum. Le confinement explicite reste distinct et applique son action configurée aux arrivées. `kick` ne rapporte une expulsion qu’après succès de Discord.

Pour la quarantaine, le bot recharge le rôle et son membre courant, vérifie `ManageRoles`, refuse un rôle managé, `@everyone` ou situé au-dessus du rôle du bot, puis tente l’attribution. Si la vérification ou l’appel Discord échoue, le journal indique le résultat `log`, émet le code d’erreur borné et ne prétend pas que le membre a été mis en quarantaine.

`node --test bot/guild-guard.test.js` couvre le seuil anti-raid/âge, le confinement, la hiérarchie, les permissions manquantes, le succès et le rejet Discord de l’attribution. Une validation réelle reste nécessaire pour confirmer les ACL et permissions effectives de la guild.
