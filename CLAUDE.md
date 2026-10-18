# Règles du projet — Resin Print Queue

File d'impression d'une ferme d'imprimantes 3D résine (Shopify / Etsy → une carte par pièce
physique). Node 22, Express, SQLite (`better-sqlite3`), front-end en modules ES **sans build**.
Voir `README.md` (démarrage), `docs/technique.md` (architecture, API, base) et
`docs/guide-atelier.md` (usage).

## Commandes

```bash
npm test                          # node:test ; doit rester vert avant tout push
SCHEDULER_INLINE=true npm start   # app + synchro, un seul processus (http://localhost:8080)
docker compose up -d --build      # stack complète : app + worker + updater
```

## Langue et style

- Interface, documentation, commentaires : **français**. Messages de commit : **anglais**,
  une première ligne claire, puis le pourquoi.
- Écrire comme le code autour : mêmes noms, même densité de commentaires (ils expliquent le
  *pourquoi*). Pas de dépendance ni d'étape de build côté front.
- Dans une chaîne JS entre apostrophes, **pas d'apostrophe** (`'qu'il'` casse tout le front) :
  utiliser `’`, des guillemets ou des gabarits. `tests/frontend-syntax.test.js` le détecte.

## Invariants à ne pas casser

- **Une ligne `parts` = un objet physique** (quantité 3 = 3 lignes). L'ingestion est
  idempotente (`UNIQUE (order_item_id, unit_index)`) : relancer la synchro ne duplique rien.
- **Statuts** : `TO_PRINT → PRINTING → DONE → SHIPPED`. `FAILED` n'est **jamais** un état stable :
  `setStatus(…, 'FAILED')` consigne l'échec (`print_results`, `fail_count`, tag « A échoué ×N »)
  et remet la pièce en `TO_PRINT`. Les taux d'échec viennent de `print_results`, qui n'a pas de
  clé étrangère : l'historique survit à la suppression d'une pièce.
- **Réglages en base** (`settings`, définis dans `src/domain/settings.service.js`), pas en
  `.env` (qui ne donne que des valeurs initiales). Un réglage `type: 'secret'` n'est **jamais**
  renvoyé par l'API.
- **Migrations idempotentes** (`src/db/migrate.js`) : `addColumnIfMissing`, et toute
  réparation de données ponctuelle est gardée par une clé `internal.*` dans `settings`. Jamais
  de suppression de données utilisateur.
- **Modes** : *Simple* par défaut (appareil neuf), *Avancé* au choix sur ordinateur ; `/kiosk`
  est toujours en simple et n'écrase pas le choix mémorisé.
- **Chit Chats** : aucun affichage dans l'app (cartes, fiche, « Tout »). On garde ses réglages,
  la synchro côté serveur et l'extension Chrome (`chrome-extension/`).
- **Tags** : un tag tapé sur une pièce reste sur cette pièce ; seule la liste Réglages →
  Atelier → Tags alimente les suggestions.
- Plus de sélecteur d'imprimante ni de colonne « Échec » : ne pas les réintroduire sans demande.

## Docker, données, mises à jour

- Les données sont dans le volume `rpq-data`. **Jamais `docker compose down -v`.**
- L'app n'a pas accès à Docker. Le conteneur `updater` exécute `scripts/update.sh` (sauvegarde,
  pull, rebuild, retour arrière si l'app n'est pas saine) et dialogue avec l'app par fichiers
  dans `/data/updater`. L'identifiant de version (`GIT_SHA`) est affiché dans l'interface.
- Une sauvegarde SQLite automatique est faite au premier démarrage d'une nouvelle version,
  avant les migrations.

## Branches et dépôts

- Deux dépôts identiques : `3dkeycap/Printer-Queue` (privé) et `3dkeycap/Printer-Queue-public`.
  Le serveur de l'atelier se met à jour depuis **`main` du dépôt public** : toute modification
  livrée doit être poussée sur `main` des **deux** dépôts (même commit).
- Ne jamais commiter de secret (token, `.env`, base SQLite). Les faux tokens de test sont
  préfixés explicitement (`shpat_test`…).

## Avant de pousser

1. `npm test` vert. Un changement d'interface se vérifie dans un vrai navigateur (Playwright
   + Chromium sont installés ; pas de capture « de mémoire »).
2. Mettre à jour la doc concernée : `CHANGELOG.md` (section « Non publié »),
   `docs/guide-atelier.md` si l'usage change, `docs/technique.md` si l'API ou la base change.
3. Ne pas élargir le périmètre : une demande = un changement ciblé, sans refactor voisin.
