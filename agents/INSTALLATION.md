# Installer les agents (Superviseur, Observateur, Avocat du diable)

Ce guide installe les agents sur **une nouvelle machine gratuite Oracle**, séparée du VPS de tes bots. **Ton VPS actuel n'est pas touché.**

Compte environ 45 minutes. Chaque bloc de commandes se copie-colle tel quel. Remplace seulement ce qui est écrit `EN_MAJUSCULES`.

---

## Étape 1 : créer la machine Oracle gratuite

1. Va sur le site d'Oracle Cloud, menu **Compute → Instances → Create instance**.
2. **Name** : `her-agents`.
3. **Image** : Oracle Linux 9, comme ton VPS actuel.
4. **Shape** : clique sur *Change shape*, choisis **Ampere → VM.Standard.A1.Flex**, avec **1 OCPU et 6 Go de mémoire**. C'est inclus dans l'offre gratuite (« Always Free »).
   - Si Oracle répond qu'il n'y a plus de place (« Out of capacity »), réessaie plus tard ou prends **VM.Standard.E2.1.Micro** (1 Go, gratuit aussi).
5. **SSH keys** : garde la clé que tu utilises déjà pour ton VPS, ou télécharge celle qu'Oracle propose.
6. Clique sur **Create** et note l'**adresse IP publique**.

Il n'y a **aucun port à ouvrir** : les agents se connectent eux-mêmes à Discord, personne n'a besoin de se connecter à eux.

Connecte-toi comme sur ton VPS :

```bash
ssh opc@ADRESSE_IP_DE_LA_NOUVELLE_MACHINE
```

## Étape 2 : installer Node.js, PostgreSQL et pm2

```bash
sudo dnf module enable -y nodejs:22 postgresql:16
sudo dnf install -y nodejs git postgresql-server
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
sudo npm install -g pm2
```

Crée la base des agents. Elle appartient à ton utilisateur `opc`, donc tu n'as pas de mot de passe à retenir :

```bash
sudo -u postgres createuser opc
sudo -u postgres createdb -O opc agents
psql agents -c "select 'base OK';"
```

La dernière commande doit afficher `base OK`.

## Étape 3 : créer le bot Discord des agents

C'est un **bot à part**, pas FWU ni les 4 autres.

1. Sur le portail développeur de Discord, clique sur **New Application** et nomme-la `Agents`.
2. Onglet **Bot** :
   - clique sur **Reset Token** et copie le token. Garde-le pour l'étape 5 et ne le montre à personne ;
   - plus bas, dans *Privileged Gateway Intents*, active **Message Content Intent** et **Server Members Intent**, puis **Save**.
3. Onglet **General Information** : copie l'**Application ID**.
4. Invite le bot sur ton serveur. Ouvre ce lien après y avoir mis ton Application ID :

   `https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot+applications.commands&permissions=84992`

   Il ne demande que 4 permissions : voir les salons, envoyer des messages, intégrer des liens et lire l'historique. Le bot des agents **ne peut ni modérer, ni bannir, ni toucher aux rôles**.

## Étape 4 : préparer le salon et les identifiants

1. Crée un salon texte **privé** `#agents`, visible seulement par toi et par le bot `Agents`.
2. Active le mode développeur de Discord (Paramètres → Avancés → Mode développeur). Tu peux alors faire clic droit → *Copier l'identifiant* sur :
   - ton serveur (→ `AGENTS_GUILD_ID`) ;
   - le salon `#agents` (→ `AGENTS_CHANNEL_ID`) ;
   - ton propre profil (→ `AGENTS_OWNER_ID`) ;
   - chaque **salon public** que l'Observateur pourra lire (→ `AGENTS_READ_CHANNEL_IDS`, séparés par des virgules). Ne mets ni salons staff, ni salons NSFW, ni salons privés ;
   - tes 5 bots (→ `AGENTS_WATCHED_BOT_IDS`, facultatif). Ça permet de repérer leurs messages d'erreur.

## Étape 5 : la clé de l'IA et le plafond de dépense

1. Sur la console Anthropic, crée une **clé d'API** et copie-la.
2. Dans la partie **Billing / Limits** de la console, fixe une **limite de dépense mensuelle**, par exemple 10 $. C'est la sécurité côté Anthropic.
3. Les agents ont aussi leur propre plafond (`AGENTS_MONTHLY_BUDGET_USD`). Ils se mettent en pause tout seuls à 90 % de ce plafond.

## Étape 6 : installer le code des agents

```bash
cd ~
git clone --branch agents-superviseur-observateur https://github.com/herolfriendss/her-v3-.git her-agents-src
cd ~/her-agents-src/agents
npm ci --omit=dev
cp .env.example .env
openssl rand -hex 32
```

Si GitHub te demande un mot de passe (dépôt privé), mets un **jeton GitHub** en lecture seule à la place du mot de passe.

La dernière commande affiche une longue suite de caractères : c'est ton `AGENTS_PSEUDONYM_SECRET`. Ouvre le fichier de configuration :

```bash
nano .env
```

Remplis chaque ligne avec ce que tu as noté aux étapes 3 à 5. Pour la base de données, mets exactement :

```
AGENTS_DATABASE_URL=postgres://opc@/agents?host=/var/run/postgresql
```

Enregistre avec `Ctrl+O`, `Entrée`, puis quitte avec `Ctrl+X`.

## Étape 7 : démarrer

```bash
pm2 start ecosystem.config.cjs
pm2 logs her-agents --lines 20
```

Tu dois voir : `[agents] connecté en tant que Agents#…, N salon(s) lu(s).`

Si tu vois `configuration incomplète`, la ligne en dessous dit ce qui manque dans `.env`.

Pour que les agents redémarrent tout seuls si la machine redémarre :

```bash
pm2 save
pm2 startup
```

`pm2 startup` affiche une commande qui commence par `sudo env PATH=…`. Copie-la et lance-la.

## Étape 8 : vérifier

Dans Discord, tape `/agents statut`. Tu dois voir l'état « actifs » et un budget de 0,00 $.

L'Observateur a besoin de quelques heures d'activité pour avoir quelque chose à dire. Le premier résumé arrive le lendemain à 9 h, heure de Paris. Pour en lancer un tout de suite : `/agents analyser`.

## Au quotidien

| Tu veux… | Tu fais… |
|---|---|
| Voir l'état et le budget | `/agents statut` |
| Tout arrêter tout de suite | `/agents pause` |
| Relancer | `/agents reprendre` |
| Revoir les propositions en attente | `/agents propositions` |
| Arrêter complètement le programme | `pm2 stop her-agents` |
| Mettre à jour les agents | `cd ~/her-agents-src && git pull && cd agents && npm ci --omit=dev && pm2 restart her-agents` |

## Ligne à ajouter au règlement du serveur

> Un outil d'analyse lit les messages des salons publics pour aider l'équipe à améliorer le serveur et ses bots. Il ne lit pas les messages privés, ne conserve pas les pseudos et efface les extraits au bout de 7 jours.

## Ce que les agents font et ne font pas

- Ils **lisent** seulement les salons listés dans `AGENTS_READ_CHANNEL_IDS`.
- Ils **ne stockent jamais** un pseudo ou un identifiant de membre en clair, seulement une empreinte impossible à inverser. Mentions, liens, e-mails et numéros sont masqués avant tout stockage.
- Ils **gardent** les extraits de messages 7 jours au maximum, et seulement ceux qui parlent de bugs, d'idées ou de questions.
- Ils **n'envoient à l'IA** ni pseudo, ni identifiant, ni nom de membre : uniquement « membre A », « membre B »…
- Ils **ne font aucune action** sur le serveur : ils postent dans `#agents`, c'est tout. Toi seul peux cliquer sur les boutons.
