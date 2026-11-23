# Appels de sanction

Le bot joint un bouton d’appel aux messages privés envoyés après avertissement, sourdine, expulsion ou bannissement. Le membre peut aussi ouvrir `/warnings` et utiliser le bouton associé à un de ses dossiers récents si ses messages privés sont fermés ou si les notifications sont désactivées. Le texte doit contenir 10 à 1 000 caractères; la demande doit être déposée dans les sept jours. Une seule demande est permise par dossier.

Les appels restent isolés par serveur dans `moderation_appeals`. Une demande est relayée au salon central de sanctions correspondant à son serveur, avec des boutons de décision. Seuls `Logs Modération`, `Logs Owner` et `Logs Admin` peuvent examiner les appels PND; seuls leurs rôles préfixés `MZ` peuvent examiner MZ. Les rôles sont relus depuis l’API Discord au clic. Les décisions sont à usage unique et journalisées en base.

Accepter un appel confirme la décision de l’équipe sur la demande, mais ne lève pas automatiquement une sanction Discord. Le staff doit examiner et appliquer séparément toute levée ou correction. Si le journal central est indisponible, la demande est conservée et le membre en est informé.

Validation locale : `node --test bot/moderation-appeals.test.js bot/moderation-cases.test.js`. La publication de commandes ou le déploiement du bot n’est pas effectué par ce module.
