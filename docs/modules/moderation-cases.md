# Dossiers de modération

Les sanctions exécutées avec succès (`warn`, `mute`, `unmute`, `kick`, `ban`) reçoivent un identifiant SQLite unique et un historique indexé par guild et membre. Le warning et son dossier sont créés dans une même transaction. Les logs de sanction et la réponse de confirmation incluent l’identifiant du dossier.

`/warnings [membre]` conserve la liste des avertissements actifs et affiche aussi les dossiers récents. Un membre ne peut consulter que son propre historique; la consultation d’un autre membre garde le contrôle `ManageMessages`. Les raisons sont nettoyées et bornées, les détails structurés sont limités, et les données d’une guild ne sont jamais jointes à celles d’une autre.

Les détails de dossiers sont stockés en JSON valide et borné; au-delà de la limite, ils deviennent un indicateur `truncated` plutôt qu’un fragment invalide. La lecture tolère aussi d’anciennes valeurs JSON corrompues sans faire échouer l’historique. Les tests utilisent une base temporaire : `node --test bot/moderation-cases.test.js`. La table `moderation_cases` est additive; aucun dossier de sanction existant n’est réécrit. Les sanctions déjà enregistrées par les anciens systèmes restent disponibles dans leurs tables et leurs logs historiques.
