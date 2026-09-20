# Resin Print Queue

File d'attente d'impression **et** gestionnaire d'inventaire pour une ferme d'imprimantes 3D
résine. L'application importe les commandes Shopify et Etsy toutes les 5 minutes, éclate
chaque commande en **pièces physiques individuelles**, les suit sur un tableau Kanban
classable **par couleur de résine**, et les sort automatiquement de la production quand
Chit Chats scanne le colis.

```
docker compose up -d --build     →  http://localhost:8080
```

Sans aucune clé d'API : l'application démarre en mode `mock` et fabrique des commandes
réalistes, ce qui permet de la découvrir immédiatement.

---

## 1. Architecture

### Vue d'ensemble

```
                    ┌──────────────────────────────────────────────┐
   Shopify  ───┐    │  conteneur « worker »                        │
   Etsy     ───┼───▶│  node-cron                                   │
   Chit Chats ─┘    │   ├─ */5  min  syncOrders  (Shopify + Etsy)   │
        ▲           │   └─ */15 min  syncShipments (Chit Chats)     │
        │           └───────────────────┬──────────────────────────┘
        │                               │  écrit
        │ webhook                       ▼
        │                    ┌─────────────────────┐
        │                    │  SQLite (WAL)       │  volume Docker « rpq-data »
        │                    │  /data/printer-     │
        │                    │  queue.db           │
        │                    └─────────▲───────────┘
        │                              │  lit / écrit
        │           ┌──────────────────┴───────────────────────────┐
        └──────────▶│  conteneur « app » — Express                 │
   POST /api/       │   ├─ API REST /api/*                         │
   webhooks/        │   ├─ Webhooks Chit Chats / Shopify / Etsy    │
   chitchats        │   └─ Dashboard statique (public/)            │
                    └──────────────────┬───────────────────────────┘
                                       │  fetch JSON
                                       ▼
                            Navigateur — Dashboard beige & noir
                            Kanban · Tableau · Inventaire · Commandes
```

### Choix techniques et pourquoi

| Décision | Raison |
| --- | --- |
| **Node.js 22 + Express** | Un seul langage du worker au navigateur, démarrage instantané, empreinte mémoire minuscule — adapté à un NAS ou un mini-PC d'atelier. |
| **SQLite + `better-sqlite3`** | Base d'un seul fichier, zéro service à administrer, API **synchrone** : pas de `await` dans les transactions, donc l'éclatement d'une commande en pièces est atomique et trivial à lire. Mode **WAL** pour que l'API et le worker écrivent dans le même fichier sans se bloquer. |
| **Worker dans son propre conteneur** | Une API lente de marketplace ne doit jamais ralentir le dashboard. Les deux conteneurs partagent le volume SQLite ; `SCHEDULER_INLINE=true` permet aussi de tout faire tourner dans un seul process. |
| **Front-end sans build** (ES modules + CSS natif) | Pas de webpack/Vite/node_modules côté client : l'image Docker reste légère, le déploiement est un simple `docker compose up`, et le dashboard fonctionne hors-ligne dans l'atelier. |
| **Mode `mock` par défaut** | Le projet est « plug-and-play » : il tourne et se démontre sans aucun identifiant. Passer en `live` ne change qu'une variable d'environnement. |
| **Webhook + polling pour Chit Chats** | Le webhook donne la réaction instantanée, le cron de 15 min sert de filet de sécurité si un webhook est perdu. Les deux passent par le même code (`applyShipment`). |

### Granularité des données — le cœur du modèle

Une commande Shopify avec une ligne « Keycap Kraken × 3 » produit :

```
orders (1 ligne)  →  order_items (1 ligne, quantity = 3)  →  parts (3 lignes)
                                                              unit_index 1, 2, 3
```

Chaque ligne de `parts` est **un objet physique** avec son propre statut, sa propre
imprimante, ses propres notes et son propre historique : si la pièce n°2 rate, elle
repasse à `FAILED` sans toucher aux deux autres.
La contrainte `UNIQUE (order_item_id, unit_index)` rend la synchronisation **idempotente** :
repasser le cron 100 fois ne crée jamais de doublon, et si le client augmente sa quantité,
seules les pièces manquantes sont ajoutées.

### Arborescence

```
.
├── docker-compose.yml          app + worker + profil « demo »
├── Dockerfile                  image multi-stage, non-root, healthcheck
├── .env.example                toute la configuration documentée
├── src/
│   ├── server.js               entrée du conteneur « app »
│   ├── app.js                  montage Express (helmet, auth, routes, SPA)
│   ├── config.js               lecture unique de l'environnement
│   ├── db/
│   │   ├── schema.sql          schéma SQLite complet
│   │   ├── migrate.js          application idempotente + seed des résines
│   │   ├── colors.seed.json    catalogue de résines (noms, hex, alias)
│   │   └── index.js            connexion, PRAGMA WAL, settings
│   ├── domain/
│   │   ├── statuses.js         les 7 statuts + transitions autorisées
│   │   ├── colors.js           résolution « Bleu nuit / R2 » → navy
│   │   ├── ingest.js           commande normalisée → pièces individuelles
│   │   ├── parts.service.js    requêtes, filtres, transitions, historique
│   │   ├── orders.service.js   commandes + passage en SHIPPED
│   │   └── stats.service.js    agrégats du dashboard, inventaire
│   ├── integrations/
│   │   ├── shopify.js          poll + normalisation + webhook
│   │   ├── etsy.js             poll + normalisation
│   │   ├── chitchats.js        poll, webhook, statuts d'expédition
│   │   └── mock-data.js        générateur déterministe de commandes
│   ├── jobs/
│   │   ├── scheduler.js        node-cron, anti-chevauchement
│   │   ├── syncOrders.js       Shopify + Etsy → base
│   │   ├── syncShipments.js    Chit Chats → statut SHIPPED
│   │   ├── worker.js           entrée du conteneur « worker »
│   │   └── run-once.js         `npm run sync:once`
│   ├── routes/                 parts, orders, colors, stats, sync, webhooks, meta
│   └── lib/                    logger JSON, erreurs HTTP, fetch + retry, auth
├── public/                     dashboard (HTML/CSS/ES modules, aucun build)
│   ├── index.html
│   ├── css/app.css             thème beige & noir, clair / sombre
│   └── js/                     api, store, views/{board,table,inventory,orders,integrations}
├── scripts/seed-demo.js        jeu de données de démonstration
└── tests/                      51 tests (node:test)
```

---

## 2. Démarrage

### Docker (recommandé)

```bash
cp .env.example .env          # facultatif : tout a une valeur par défaut
docker compose up -d --build

# jeu de données de démonstration (facultatif)
docker compose --profile demo run --rm seed

docker compose logs -f worker # voir les synchronisations
```

Dashboard : **http://localhost:8080** (changer le port : `APP_PORT=9000 docker compose up -d`).

### En local, sans Docker

```bash
npm install
npm run migrate
npm run seed:demo             # facultatif
SCHEDULER_INLINE=true npm start
```

### Tests

```bash
npm test                      # 51 tests : ingestion, statuts, Chit Chats, API, normalisation
```

---

## 3. Statuts d'une pièce

| Statut | Libellé | Signification |
| --- | --- | --- |
| `TO_PRINT` | À imprimer | Commande reçue, fichier pas encore tranché |
| `FILE_READY` | Fichier prêt | Tranché, supports posés, prêt pour la machine |
| `PRINTING` | En impression | Sur une imprimante en ce moment |
| `FAILED` | Échec | Impression ratée, à relancer (incrémente `fail_count`) |
| `DONE` | Terminé | Imprimé, lavé, post-durci |
| `IN_INVENTORY` | En stock | En bac, prêt à être emballé |
| `SHIPPED` | Expédié | Scanné par Chit Chats — **sort du tableau de production** |

Les transitions sont validées côté serveur (`src/domain/statuses.js`) ; le dashboard peut
forcer n'importe quelle transition (`force: true`) pour corriger une erreur de manipulation.
Chaque changement est écrit dans `part_events` avec son auteur (`dashboard`, `worker`,
`chitchats:webhook`…).

---

## 4. Le dashboard

* **Kanban** — une colonne par statut, **glisser-déposer** d'une colonne à l'autre,
  bouton d'action rapide sur chaque carte pour avancer d'un cran.
* **Regroupement par couleur de résine** — actif par défaut, dans le Kanban comme dans le
  tableau : on imprime un bac entier de « Glow in the dark » d'un coup.
* **Filtres** — pastilles de couleur avec compteurs, source (Shopify / Etsy / interne),
  rush, recherche plein texte (`/` pour y accéder au clavier).
* **Sélection multiple** — `Ctrl`/`Cmd` + clic, ou cases à cocher dans la vue tableau,
  puis changement de statut en lot depuis la barre d'action.
* **Fiche pièce** — historique complet, imprimante assignée, notes, couleur, priorité.
* **Inventaire** — pièces finies en bac + stock de résine en grammes par couleur avec
  alerte de seuil bas.
* **Thème beige & noir** — sombre par défaut, thème beige clair en un clic (mémorisé).

---

## 5. Intégrations

### Shopify

1. Créer une app personnalisée avec le scope `read_orders`.
2. Renseigner `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, puis `INTEGRATION_MODE=live`.
3. (Optionnel, pour l'instantané) webhook `orders/create` →
   `https://votre-domaine/api/webhooks/shopify`, avec `SHOPIFY_WEBHOOK_SECRET`
   (signature HMAC SHA-256 vérifiée).

La couleur de résine est déduite, dans l'ordre : propriété de ligne `Color` / `Colour` /
`Couleur` / `Resin`, puis `variant_title`, puis le SKU.

### Etsy

1. App Open API v3 avec le scope `transactions_r`.
2. Renseigner `ETSY_SHOP_ID`, `ETSY_API_KEY`, `ETSY_ACCESS_TOKEN`.
3. Etsy ne propose pas de webhook de commande : le poll de 5 minutes fait le travail
   (`/api/webhooks/etsy` reste disponible pour un relais type Zapier).

La couleur vient de la variation dont le nom vaut `Color` / `Couleur` / `Resin`.

### Chit Chats

1. `CHITCHATS_CLIENT_ID` + `CHITCHATS_ACCESS_TOKEN`.
2. Webhook vers `https://votre-domaine/api/webhooks/chitchats` avec l'en-tête
   `X-Webhook-Secret: <CHITCHATS_WEBHOOK_SECRET>` (comparaison à temps constant).
3. À la réception, le colis est rapproché de la commande locale via `order_id`,
   `reference`, `name`, puis le nom du destinataire ; toutes les pièces de la commande
   passent à `SHIPPED`, le numéro de suivi est stocké et les pièces disparaissent du
   tableau de production.

Les statuts considérés comme « parti » : `shipped`, `in_transit`, `out_for_delivery`,
`delivered`, `ready_for_pickup`, `picked_up`, `completed`.
`SHIP_ALL_PARTS_ON_SHIPMENT=false` limite le passage à `SHIPPED` aux pièces déjà
`DONE`/`IN_INVENTORY` et signale l'incohérence dans les logs.

---

## 6. API REST

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check (utilisé par Docker) |
| `GET` | `/api/meta` | Statuts, mode, expressions cron |
| `GET` | `/api/parts` | Liste filtrable : `status`, `color`, `source`, `q`, `priority`, `sort`, `scope=board` |
| `POST` | `/api/parts` | Pièce manuelle (réimpression, production pour le stock) |
| `GET` | `/api/parts/:id` | Fiche + historique |
| `PATCH` | `/api/parts/:id` | Couleur, imprimante, notes, priorité, statut |
| `POST` | `/api/parts/:id/status` | Transition unitaire (`{ status, note, force }`) |
| `POST` | `/api/parts/bulk/status` | Transition en lot (`{ ids, status }`) |
| `GET` | `/api/orders` · `/api/orders/:id` | Commandes et leurs pièces |
| `POST` | `/api/orders/:id/ship` | Expédition manuelle |
| `GET` | `/api/colors` · `PATCH /api/colors/:key` | Catalogue de résines, stock en grammes |
| `GET` | `/api/stats/summary` · `/api/stats/inventory` | Agrégats du dashboard |
| `POST` | `/api/sync/run?source=all\|shopify\|etsy\|chitchats` | Synchronisation manuelle |
| `GET` | `/api/sync/runs` · `/api/sync/webhooks` | Journal des exécutions et des webhooks |
| `POST` | `/api/webhooks/{chitchats,shopify,etsy}` | Entrées webhook |

---

## 7. Schéma SQLite

| Table | Rôle |
| --- | --- |
| `orders` | Commande importée (source, numéro, client, suivi, expédition) |
| `order_items` | Ligne de commande telle que reçue (quantité, variante, prix) |
| `parts` | **Une ligne = un objet physique** (statut, imprimante, notes, échecs) |
| `part_events` | Historique de toutes les transitions de statut |
| `resin_colors` | Catalogue des résines : nom, hex, alias de détection, stock en g |
| `sync_runs` | Journal des exécutions du worker (durée, volumétrie, erreurs) |
| `webhook_events` | Payloads bruts reçus, pour l'audit et le rejeu |
| `settings` | Curseurs de synchronisation, version du schéma |

Le fichier complet et commenté : [`src/db/schema.sql`](src/db/schema.sql).

---

## 8. Exploitation

* **Sauvegarde** : `docker compose exec app node -e "require('better-sqlite3')(process.env.DATABASE_PATH).backup('/data/backup.db')"`
  puis récupérer le fichier depuis le volume `rpq-data`.
* **Authentification** : renseigner `DASHBOARD_PASSWORD` active une authentification HTTP
  Basic sur le dashboard et l'API (les webhooks et le health check restent ouverts, ils
  ont leur propre secret).
* **Derrière un reverse proxy** : terminer le TLS chez le proxy et ne publier que le port
  8080 du service `app` ; le worker n'expose rien.
* **Logs** : JSON sur stdout (`LOG_LEVEL=debug` pour le détail des requêtes).
