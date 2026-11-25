# Audit du catalogue slash FWU

- Applications Discord : **6**.
- Définitions racine : **129** commandes uniques.
- Commandes communes à chaque application : **/aide, /status**.
- Doublons de définition : **0**.
- Commandes attribuées à plusieurs bots : **0**.
- Commandes sans propriétaire : **0**.

## Limite Discord par application

| Application | Commandes propres | Communes | Total | Limite |
|---|---:|---:|---:|---:|
| FWU | 10 | 2 | 12/100 | OK |
| GUARD | 15 | 2 | 17/100 | OK |
| FDPDLAVOC | 7 | 2 | 9/100 | OK |
| SUCK ME | 61 | 2 | 63/100 | OK |
| LE FISC | 32 | 2 | 34/100 | OK |
| Invest + | 2 | 2 | 4/100 | OK |

## FDPDLAVOC — racines regroupées

- /music player : play, pause, resume, skip, stop, queue, nowplaying, volume, loop, shuffle, clearqueue, remove, join, leave, panel
- /voice access : grant, revoke
- /voice private : activer, liste, retirer
- /voc : gestion des salons vocaux temporaires et commandes vocales existantes
- /radio
- /effet
- /playlist
- /dj

Les anciens noms slash du lecteur et des accès vocaux sont retirés du catalogue racine et nettoyés lors d'une future synchronisation. Les commandes préfixées historiques restent disponibles et sont traduites vers les nouveaux chemins slash.

## Autres applications

Les autres racines restent inchangées dans cette étape. Leur regroupement sera effectué par familles, avec une table de parité testée avant le retrait de chaque ancienne racine.
