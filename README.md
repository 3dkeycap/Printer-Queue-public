# Resin Print Queue

Remplaçant de la feuille de calcul « Printer Queue » d'une ferme d'imprimantes 3D résine.
L'application importe les commandes Shopify et Etsy toutes les 5 minutes, éclate chaque
commande en **pièces physiques individuelles**, les suit sur un tableau classable **par
couleur de résine**, gère le **poste UV** et les **commentaires** de chaque pièce, et les
sort automatiquement de la production quand Chit Chats scanne le colis.

```
docker compose up -d --build     →  http://localhost:8080
```

Aucun identifiant à saisir avant le premier démarrage : **tout se configure dans la page
« Intégrations »** du dashboard (clés API, crons, listes UV et commentaires, résines), et
les réglages sont stockés en base.

### Les trois pages

| Page | Rôle |
| --- | --- |
| **À imprimer** | Le tableau de production : colonnes *À imprimer · En impression · Échec · Imprimé*, glisser-déposer, regroupement par couleur de résine. |
| **Tout** | Toutes les pièces, tous statuts confondus, en tableau éditable (statut, UV, commentaire en liste déroulante) — l'équivalent direct de la feuille de calcul. Uniquement des filtres en haut, pas de compteurs. |
| **Intégrations** | Tous les réglages : Shopify, Etsy, Chit Chats, planification, listes UV / commentaires, catalogue de résines, journal des synchronisations. |

### Correspondance avec l'ancienne feuille

| Colonne de la feuille | Dans l'application |
| --- | --- |
| Print Started | statut **En impression** |
| Print Fail | statut **Échec** |
| Printed Successfully | statut **Imprimé** |
| Done (colis parti) | statut **Expédié** (posé automatiquement par Chit Chats) |
| Comment | liste déroulante **Commentaire** (options réglables dans Intégrations) |
| Uv (a/b/c) | liste déroulante **UV**, affichée sur chaque carte (options réglables) |
| — (assignation manuelle) | liste déroulante **Imprimante** (options réglables), sur la carte, le tableau et la fiche |
| What / Quantity | une ligne **par pièce physique** : quantité 3 = 3 lignes |
| For Who | colonne **Pour qui** (client de la commande) |
| Onglets White / Black / Grey… | filtre et regroupement **par couleur de résine** |

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
                            À imprimer · Tout · Intégrations
```

### Choix techniques et pourquoi

| Décision | Raison |
| --- | --- |
| **Node.js 22 + Express** | Un seul langage du worker au navigateur, démarrage instantané, empreinte mémoire minuscule — adapté à un NAS ou un mini-PC d'atelier. |
| **SQLite + `better-sqlite3`** | Base d'un seul fichier, zéro service à administrer, API **synchrone** : pas de `await` dans les transactions, donc l'éclatement d'une commande en pièces est atomique et trivial à lire. Mode **WAL** pour que l'API et le worker écrivent dans le même fichier sans se bloquer. |
| **Worker dans son propre conteneur** | Une API lente de marketplace ne doit jamais ralentir le dashboard. Les deux conteneurs partagent le volume SQLite ; `SCHEDULER_INLINE=true` permet aussi de tout faire tourner dans un seul process. |
| **Front-end sans build** (ES modules + CSS natif) | Pas de webpack/Vite/node_modules côté client : l'image Docker reste légère, le déploiement est un simple `docker compose up`, et le dashboard fonctionne hors-ligne dans l'atelier. |
| **Réglages en base, pas en `.env`** | L'atelier change une clé API ou une expression cron depuis le dashboard, sans toucher à Docker : les réglages sont lus à chaque cycle et le worker se reprogramme en moins d'une minute. Les secrets ne ressortent jamais de l'API. |
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
├── docker-compose.yml          app + worker + updater (mises à jour)
├── Dockerfile                  image multi-stage, non-root, healthcheck
├── .env.example                toute la configuration documentée
├── src/
│   ├── server.js               entrée du conteneur « app »
│   ├── app.js                  montage Express (helmet, auth, routes, SPA)
│   ├── config.js               lecture unique de l'environnement
│   ├── db/
│   │   ├── schema.sql          schéma SQLite complet
│   │   ├── migrate.js          application idempotente + seed des résines
│   │   ├── backup.js           sauvegardes SQLite (VACUUM INTO) + rotation
│   │   ├── colors.seed.json    catalogue de résines (noms, hex, alias)
│   │   └── index.js            connexion, PRAGMA WAL, settings
│   ├── domain/
│   │   ├── statuses.js         les 5 statuts + transitions autorisées
│   │   ├── settings.service.js réglages en base pilotés par la page Intégrations
│   │   ├── colors.js           résolution « Bleu nuit / R2 » → navy
│   │   ├── ingest.js           commande normalisée → pièces individuelles
│   │   ├── parts.service.js    requêtes, filtres, transitions, historique
│   │   ├── orders.service.js   commandes + passage en SHIPPED
│   │   └── stats.service.js    agrégats du dashboard, inventaire
│   ├── integrations/
│   │   ├── shopify.js          poll + normalisation + webhook
│   │   ├── etsy.js             poll + normalisation
│   │   └── chitchats.js        poll, webhook, statuts d'expédition
│   ├── jobs/
│   │   ├── scheduler.js        node-cron, anti-chevauchement
│   │   ├── syncOrders.js       Shopify + Etsy → base
│   │   ├── syncShipments.js    Chit Chats → statut SHIPPED
│   │   ├── worker.js           entrée du conteneur « worker »
│   │   └── run-once.js         `npm run sync:once`
│   ├── routes/                 parts, orders, colors, stats, settings, sync, webhooks, meta
│   └── lib/                    logger JSON, erreurs HTTP, fetch + retry, auth
├── public/                     dashboard (HTML/CSS/ES modules, aucun build)
│   ├── index.html
│   ├── css/app.css             thème beige & noir, clair / sombre
│   └── js/                     api, store, drawer, views/{board,all,integrations}
├── scripts/update.sh           mise à jour depuis GitHub (privé OK), sauvegarde + retour arrière
├── scripts/updater.sh          boucle du conteneur updater (bouton et mode auto du dashboard)
├── scripts/backup.js           sauvegarde / liste des sauvegardes de la base
├── scripts/reset-data.js       purge des commandes et des pièces
├── scripts/diagnose-shopify.js interroge Shopify en direct (0 commande sans erreur ?)
└── tests/                      58 tests (node:test)
```

---

## 2. Démarrage

### Docker (recommandé)

```bash
docker compose up -d --build       # aucun .env nécessaire
docker compose logs -f worker      # suivre les synchronisations
```

Ouvrir ensuite **Intégrations** et saisir les identifiants Shopify / Etsy / Chit Chats :
la première synchronisation part dans les 5 minutes (ou immédiatement avec le bouton
« Synchroniser »).

> Une base qui contient encore des commandes de l'ancien mode démo (retiré du code) est
> nettoyée **automatiquement et une seule fois** au premier démarrage après une mise à
> jour — repère-le dans les logs à la ligne `legacy demo orders purged automatically`.
> Rien à faire de ton côté ; ça ne touche jamais une vraie commande Shopify/Etsy.

Pour repartir d'une base vide de ta propre initiative (après des essais, par exemple) :

```bash
docker compose exec app node scripts/reset-data.js --yes
```

Dashboard : **http://localhost:8080** (changer le port : `APP_PORT=9000 docker compose up -d`).

### Mettre à jour depuis GitHub (sans perdre les données)

Les données (commandes, pièces, réglages, tokens) vivent dans le **volume Docker
`rpq-data`**, pas dans l'image : reconstruire l'image ne les touche pas.

**Depuis le dashboard** : *Intégrations → Mises à jour*

* **Dépôt / branche** : par défaut `3dkeycap/Printer-Queue-public`, branche `main`
  (dépôt public : aucun token nécessaire).
* **Token GitHub** (seulement pour un dépôt privé) : token en lecture seule
  ([fine-grained token](https://github.com/settings/personal-access-tokens/new), accès au
  seul dépôt `Printer-Queue`, permission *Contents : Read-only*). Comme les autres
  secrets, il n'est jamais renvoyé par l'API.
* **Dépôt / branche suivis**, **mise à jour automatique** (activée par défaut) et
  **intervalle de vérification**.
* Boutons **Vérifier** (liste les nouveaux commits) et **Mettre à jour** : la page suit
  l'opération, puis se recharge toute seule sur la nouvelle version. Le journal de la
  dernière opération est consultable sous les boutons.

Le bouton est exécuté par le conteneur `updater` (démarré avec le reste de la stack), le
seul à avoir accès au socket Docker de l'hôte ; l'app et le worker n'y ont pas accès. Les
deux échangent par fichiers dans le volume (`/data/updater`).

**En ligne de commande** (même procédure, depuis le dossier du clone) :

```bash
sh scripts/update.sh            # met à jour si GitHub a une version plus récente
sh scripts/update.sh --check    # dit seulement s'il y a une mise à jour
```

Chaque mise à jour :

1. récupère la branche suivie sur GitHub ;
2. **sauvegarde la base** dans le volume (`/data/backups`) **et** sur l'hôte (`./backups/`) ;
3. avance le code, reconstruit l'image, redémarre `app` + `worker` ;
4. attend que l'app réponde ; sinon **revient toute seule à la version précédente**.

L'app fait aussi une sauvegarde automatique au premier démarrage de chaque nouvelle
version, avant les migrations (les 10 dernières sont gardées, `BACKUP_KEEP`). Version
installée : en bas du menu de gauche.

En ligne de commande, le token peut aussi venir de `.env` (`GITHUB_TOKEN=...`,
`GITHUB_REPO=`, `UPDATE_BRANCH=`) ; les valeurs saisies dans le dashboard sont
prioritaires pour le conteneur `updater`. Le token n'est envoyé qu'à github.com : il n'est
écrit ni dans `.git/config`, ni dans l'image.

**Dossier sans Git** (copié depuis une archive ZIP) : la mise à jour le transforme en clone
toute seule au premier clic. L'état actuel est gardé comme point de départ (retour arrière
possible) ; `.env`, `docker-compose.override.yml`, `data/` et `backups/` ne sont jamais touchés.

**Première fois** (installation antérieure à cette fonction) : sur le serveur, une seule
fois, `git pull && docker compose up -d --build`. Ensuite tout se fait depuis le dashboard.

> ⚠ Ne jamais lancer `docker compose down -v` : l'option `-v` supprime le volume
> `rpq-data`, donc la base **et** ses sauvegardes internes. `docker compose down` (sans
> `-v`), `up --build`, `pull` ou la suppression de l'image sont sans danger.
>
> Ne modifiez pas les fichiers suivis par Git (sinon la mise à jour s'arrête) : vos
> réglages vont dans `.env`, vos ajustements Docker dans `docker-compose.override.yml`.

**Restaurer une sauvegarde** :

```bash
docker compose exec app node scripts/backup.js --list
docker compose stop app worker
docker compose run --rm --no-deps app sh -c \
  'cp /data/backups/<fichier>.db /data/printer-queue.db && rm -f /data/printer-queue.db-wal /data/printer-queue.db-shm'
docker compose up -d
```

### En local, sans Docker

```bash
npm install
npm run migrate
SCHEDULER_INLINE=true npm start
```

### Tests

```bash
npm test                      # 58 tests : ingestion, statuts, réglages, Chit Chats, API, normalisation
```

---

## 3. Statuts d'une pièce

| Statut | Libellé | Équivalent dans la feuille |
| --- | --- | --- |
| `TO_PRINT` | À imprimer | aucune case cochée |
| `PRINTING` | En impression | Print Started |
| `FAILED` | Échec | Print Fail (incrémente `fail_count`) |
| `DONE` | Imprimé | Printed Successfully |
| `SHIPPED` | Expédié | Done — **sort du tableau de production** |

Les transitions sont validées côté serveur (`src/domain/statuses.js`) ; le dashboard peut
forcer n'importe quelle transition (`force: true`) pour corriger une erreur de manipulation.
Chaque changement est écrit dans `part_events` avec son auteur (`dashboard`, `worker`,
`chitchats:webhook`…).

---

## 4. Le dashboard

**Page « À imprimer »**

* Quatre colonnes (*À imprimer · En impression · Échec · Imprimé*), **glisser-déposer**
  d'une colonne à l'autre, bouton d'action rapide pour avancer d'un cran.
* **Regroupement par couleur de résine** actif par défaut : on imprime un bac entier de
  « Glow in the dark » d'un coup. Regroupement possible aussi par UV ou par commande.
* Chaque carte affiche la **résine**, le **poste UV**, le **commentaire**, la source, le
  numéro de commande, l'**imprimante assignée** et le drapeau rush.
* Filtres : pastilles de couleur et d'UV (dont « Sans UV ») avec compteurs, source,
  rush, recherche plein texte (`/` pour y accéder au clavier). Les compteurs tiennent
  compte des autres filtres actifs : avec « Etsy » coché, la pastille « Noir » indique
  le nombre de pièces noires **Etsy**.

**Page « Tout »**

* Toutes les pièces, tous statuts confondus, en **tableau éditable** : statut, UV,
  commentaire et imprimante se changent directement dans la ligne, comme dans la feuille
  de calcul.
* Mêmes filtres, plus un filtre par statut (propre à cette page : il ne vide jamais le
  tableau « À imprimer »). Groupes par couleur / UV / commande.
* Sélection multiple (cases à cocher) puis changement de statut, d'UV ou de commentaire
  **en lot**.

**Commun**

* **Fiche pièce** (clic sur une ligne ou une carte) : historique complet des transitions,
  imprimante, notes libres, couleur, UV, commentaire, priorité.
* **Thème beige & noir** — sombre par défaut, thème beige clair en un clic (mémorisé).

---

## 5. Intégrations

Tout se saisit dans la page **Intégrations** ; les valeurs sont stockées en base et les
secrets ne sont jamais renvoyés au navigateur (le champ affiche « enregistré »). Laisser
un champ secret vide conserve la valeur existante.

### Shopify (OAuth 2.0)

Shopify n'émet plus de token d'accès direct pour les nouvelles boutiques : la connexion
passe par OAuth 2.0. L'application gère tout le flux (redirection, vérification de la
signature, échange du code) — il n'y a qu'à créer l'app et cliquer un bouton.

1. Sur [partners.shopify.com](https://partners.shopify.com), créer une app et noter son
   **Client ID** et son **Client secret** (Configuration → Client credentials).
2. Page Intégrations → *Shopify*, renseigner dans l'ordre :
   - **URL publique de ce serveur** (ex. `https://queue.3dkeycap.com`) ;
   - **Domaine de la boutique** (`ma-boutique.myshopify.com`) ;
   - **Client ID** et **Client secret**.
3. Cliquer **Enregistrer**, puis cliquer **Copier** à côté de la « Redirect URL OAuth »
   affichée sous les champs et la coller telle quelle dans le Partner Dashboard →
   Configuration → **Allowed redirection URL(s)**.
4. Cliquer **Connecter via OAuth** : le navigateur va sur Shopify, le marchand approuve les
   accès, puis revient automatiquement sur le dashboard — le token d'accès est rempli tout
   seul et la pastille passe à « Configuré ».
5. (Optionnel, pour l'instantané) webhook `orders/create` →
   `https://votre-domaine/api/webhooks/shopify`. Il est signé avec le **Client secret** de
   l'app, déjà renseigné ci-dessus — aucun secret webhook séparé à configurer.

« Se déconnecter » efface le token pour forcer une nouvelle autorisation (utile si l'app a
été révoquée côté Shopify, ou pour changer de boutique).

Une app privée existante qui a encore un token classique peut continuer à le coller
directement dans le champ **Token d'accès** : le flux OAuth n'écrase rien tant qu'on ne
clique pas sur « Connecter ».

**Erreur « Oops, something went wrong / Unauthorized Access »** en cliquant sur
« Connecter via OAuth » : Shopify rejette la demande dès que l'URL de redirection reçue ne
correspond pas exactement à ce qui est enregistré dans le Partner Dashboard.
- vérifier que **Allowed redirection URL(s)** n'est pas vide et contient l'URL copiée
  depuis le bouton **Copier** ci-dessus, au caractère près (l'app rejette silencieusement
  toute variation — https vs http, `/` de fin, sous-domaine) ;
- si l'app est encore en brouillon, la publier (ou l'installer via un lien d'installation)
  avant de réessayer.

**La synchro tourne sans erreur mais renvoie toujours 0 commande** (`orders fetched,
count: 0` dans les logs, alors que la boutique a bien des commandes non honorées) :

Une mise à jour a corrigé un bug réel qui provoquait exactement ce symptôme : le curseur de
synchro (`cursor:shopify` / `cursor:etsy`, qui mémorise « jusqu'où on a déjà cherché »)
avançait sur l'horloge murale à *chaque* cycle de 5 minutes, même quand 0 commande était
trouvée ou que la boutique n'était pas encore configurée. La fenêtre de recherche se
rétrécissait ainsi progressivement à quelques minutes au lieu des 14 jours prévus, et les
commandes placées avant la connexion de la boutique ne remontaient plus jamais. Mettre à
jour vers cette version répare le curseur automatiquement au premier démarrage (`stale sync
cursors reset` dans les logs) et relance un balayage complet sur toute la fenêtre de
rattrapage — rien à faire de plus qu'un redéploiement.

Si ça persiste après la mise à jour, lancer le diagnostic qui interroge Shopify directement
et affiche sa vraie réponse plutôt que de deviner :

```bash
docker compose exec app node scripts/diagnose-shopify.js
```

Il distingue trois cas : accès aux données protégées pas encore effectif (erreur 401/403
explicite), commandes existantes mais aucune n'est réellement « non honorée », ou boutique
sans commande du tout dans les 60 derniers jours. `read_orders` suffit amplement — inutile
(et pas souhaitable) de demander tous les scopes disponibles dans le Partner Dashboard.

La couleur de résine est déduite, dans l'ordre : propriété de ligne `Color` / `Colour` /
`Couleur` / `Resin`, puis `variant_title`, puis le SKU.

**Suppléments Etsy/Shopify (« Custom UV Printed Legends », « Color Variety Pack »...)** —
ce ne sont pas des objets à imprimer, ce sont des options rattachées à la vraie pièce de la
même commande (souvent un « Custom Keycap Set »). Réglable dans Réglages → Atelier :
- **Suppléments à ne pas imprimer** : tout titre de ligne contenant un de ces mots ne
  génère aucune pièce (la ligne de commande reste enregistrée pour l'historique). Si le nom d'une résine contient un de ces mots (ex. « Nylon »), cette résine est aussi retirée de « À imprimer ». Le mot
  est cherché dans le titre, la variante et le SKU (sans tenir compte des accents/majuscules).
  Les pièces déjà créées pour ces articles sont retirées de la file à la prochaine synchro, au
  démarrage et à l'enregistrement du réglage — **sauf** si un humain s'en est occupé (statut
  changé, imprimante/UV/commentaire/notes modifiés, pièce ajoutée à la main) : c'est la façon
  de dire « celle-là, on la veut dans la file ».
- **Suppléments qui indiquent un besoin UV** : si un de ces titres apparaît dans la
  commande, les vraies pièces de la même commande reçoivent automatiquement la **valeur UV
  appliquée automatiquement** (ex. `oui`).

**Nylon** — un procédé d'impression totalement différent de la résine (FDM/SLS, pas MSLA).
Une variante commençant par « Nylon » (ex. « Nylon Grey ») n'est donc jamais rangée avec la
résine de même nom : elle est automatiquement dirigée vers une entrée séparée du catalogue
(`Nylon Gris`, classée à part, après toutes les résines), créée à la volée dès la première
commande qui en contient. Fonctionne avec n'importe quelle couleur suivant « Nylon », sans
liste à préconfigurer.

### Etsy (OAuth 2.0 + PKCE)

Comme Shopify, l'Open API v3 d'Etsy exige OAuth 2.0 — avec en plus PKCE, obligatoire sur
tout le flux. L'application gère les deux bouts (redirection, échange du code, et le
renouvellement automatique du token qui expire **toutes les heures** chez Etsy) — il n'y a
qu'à créer l'app et cliquer un bouton.

1. Sur [etsy.com/developers](https://www.etsy.com/developers/register), créer une app et
   noter sa **Keystring** (= la clé API = le Client ID OAuth, une seule et même valeur chez
   Etsy).
2. Page Intégrations → *Etsy*, renseigner :
   - **URL publique de ce serveur** (partagée avec Shopify, à ne saisir qu'une fois) ;
   - **Shop ID** (visible dans l'URL du Shop Manager) ;
   - **Clé API (Keystring)**.
3. Cliquer **Enregistrer**, copier la « Redirect URL OAuth » et l'ajouter dans la config de
   l'app côté Etsy (callback URL autorisée).
4. Cliquer **Connecter via OAuth** : retour automatique sur le dashboard une fois autorisé,
   token d'accès et de rafraîchissement remplis tout seuls.

Le token d'accès expire au bout d'une heure ; l'application le renouvelle **avant chaque
synchronisation** grâce au refresh token (valable 90 jours chez Etsy), sans aucune
intervention. Une ancienne connexion par token collé à la main continue de fonctionner mais
ne se renouvelle pas automatiquement (pas de refresh token) — elle finira par expirer et
demandera de passer par « Connecter via OAuth ».

Etsy ne propose pas de webhook de commande : le poll de 5 minutes fait le travail
(`/api/webhooks/etsy` reste disponible pour un relais type Zapier).

La couleur vient de la variation dont le nom vaut `Color` / `Couleur` / `Resin`.

### Chit Chats

1. Page Intégrations → *Chit Chats* : client ID + token d'accès.
2. Webhook vers `https://votre-domaine/api/webhooks/chitchats` avec l'en-tête
   `X-Webhook-Secret: <secret saisi dans la page>` (comparaison à temps constant).
3. À la réception, le colis est rapproché de la commande locale via `order_id`,
   `reference`, `name`, puis le nom du destinataire ; toutes les pièces de la commande
   passent à `SHIPPED`, le numéro de suivi est stocké et les pièces disparaissent du
   tableau de production.

Les statuts considérés comme « parti » : `shipped`, `in_transit`, `out_for_delivery`,
`delivered`, `ready_for_pickup`, `picked_up`, `completed`.
Décocher « Expédier toutes les pièces du colis » limite le passage à `SHIPPED` aux pièces
déjà `DONE` et signale l'incohérence dans les logs.

---

## 6. API REST

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check (utilisé par Docker) |
| `GET` | `/api/meta` | Statuts, mode, expressions cron |
| `GET` | `/api/parts` | Liste filtrable : `status`, `color`, `uv` (`__none__` = sans UV), `source`, `q`, `priority`, `sort`, `scope=board` |
| `GET` | `/api/parts/facets` | Compteurs des filtres (mêmes paramètres), chaque dimension sans son propre filtre |
| `POST` | `/api/parts` | Pièce manuelle (réimpression, production pour le stock) |
| `GET` | `/api/parts/:id` | Fiche + historique |
| `PATCH` | `/api/parts/:id` | Couleur, UV, commentaire, imprimante, notes, priorité, statut |
| `POST` | `/api/parts/:id/status` | Transition unitaire (`{ status, note, force }`) |
| `POST` | `/api/parts/bulk/status` | Transition en lot (`{ ids, status }`) |
| `GET` | `/api/orders` · `/api/orders/:id` | Commandes et leurs pièces |
| `POST` | `/api/orders/:id/ship` | Expédition manuelle |
| `GET` | `/api/colors` · `POST` · `PATCH /api/colors/:key` · `DELETE` | Catalogue de résines, alias, stock en grammes |
| `GET` | `/api/settings` | Tous les réglages (secrets masqués) + état des connecteurs |
| `PUT` | `/api/settings` | Enregistre un lot de réglages |
| `GET` | `/api/stats/summary` | Agrégats du dashboard (statuts, couleurs, UV, sources) |
| `POST` | `/api/sync/run?source=all\|shopify\|etsy\|chitchats` | Synchronisation manuelle |
| `GET` | `/api/sync/runs` · `/api/sync/webhooks` | Journal des exécutions et des webhooks |
| `GET` | `/api/system/update` | Version installée, état du service updater, commits disponibles, journal |
| `POST` | `/api/system/update` | `{ action: "check" \| "update" }` : exécuté par le conteneur updater |
| `POST` | `/api/webhooks/{chitchats,shopify,etsy}` | Entrées webhook |
| `GET` | `/api/integrations/{shopify,etsy}/oauth/start` | Démarre le flux OAuth (navigation, pas un fetch) |
| `GET` | `/api/integrations/{shopify,etsy}/oauth/callback` | Retour du fournisseur : vérifie state (+ HMAC pour Shopify, PKCE pour Etsy), échange le code |
| `POST` | `/api/integrations/{shopify,etsy}/oauth/disconnect` | Efface le token pour forcer une nouvelle connexion |

---

## 7. Schéma SQLite

| Table | Rôle |
| --- | --- |
| `orders` | Commande importée (source, numéro, client, suivi, expédition) |
| `order_items` | Ligne de commande telle que reçue (quantité, variante, prix) |
| `parts` | **Une ligne = un objet physique** (statut, UV, commentaire, imprimante, notes, échecs) |
| `part_events` | Historique de toutes les transitions de statut |
| `resin_colors` | Catalogue des résines : nom, hex, alias de détection, stock en g |
| `sync_runs` | Journal des exécutions du worker (durée, volumétrie, erreurs) |
| `webhook_events` | Payloads bruts reçus, pour l'audit et le rejeu |
| `settings` | Réglages de la page Intégrations, curseurs de synchronisation |

Le fichier complet et commenté : [`src/db/schema.sql`](src/db/schema.sql).

---

## 8. Exploitation

* **Sauvegarde** : `docker compose exec app node scripts/backup.js` (fichier dans
  `/data/backups`, rotation `BACKUP_KEEP`), puis `docker cp rpq-app:/data/backups/<fichier>.db .`
  pour la garder hors du serveur. Automatique avant chaque mise à jour (voir § 2).
* **Authentification** : renseigner `DASHBOARD_PASSWORD` active une authentification HTTP
  Basic sur le dashboard et l'API (les webhooks et le health check restent ouverts, ils
  ont leur propre secret).
* **Secrets** : les identifiants saisis dans la page Intégrations sont stockés en clair
  dans le fichier SQLite, comme tout auto-hébergement de ce type — protégez le volume
  `rpq-data` et les sauvegardes en conséquence.
* **Repartir à zéro** : `node scripts/reset-data.js --yes` vide commandes, pièces,
  historiques et journaux ; le catalogue de résines et les réglages sont conservés.
* **Derrière un reverse proxy** : terminer le TLS chez le proxy et ne publier que le port
  8080 du service `app` ; le worker n'expose rien.
* **Logs** : JSON sur stdout (`LOG_LEVEL=debug` pour le détail des requêtes).

## Tableau « À imprimer » : couleurs masquées, regroupement, kiosque iPad

- **Couleurs masquées** : bouton « Couleurs masquées » dans la barre de filtres → coche les
  résines qu'on n'imprime pas ici (ex. Nylon Grey, fait dans une autre usine). Elles
  disparaissent de « À imprimer » (et de son compteur) ; la vue « Tout » les montre toujours.
- **Regrouper** : bouton dans l'en-tête de chaque colonne, à côté de l'agrandissement. Les
  pièces identiques (même nom, couleur, variante, UV, commentaire, imprimante) deviennent une
  carte « ×3 » ; les actions (passer à l'étape suivante, échec) s'appliquent à toute la pile.
- **Kiosque** : `http://<ip>:8080/kiosk` — sans barre latérale, en-tête minimal, cibles
  tactiles agrandies, colonnes qu'on fait défiler au doigt. Pensé pour l'iPad de l'atelier
  (« Ajouter à l'écran d'accueil » pour le plein écran).

## Réglages, thèmes et tutoriel

- **Réglages** (ex-« Intégrations ») : 6 onglets — Atelier (imprimantes, UV, commentaires, ce qu'on
  n'imprime pas), Résines, Boutiques (Shopify / Etsy / Chit Chats, options avancées repliées),
  Synchronisation (fréquences en clair, journal), Apparence & aide, Mises à jour. Les listes
  s'éditent en pastilles (taper + Entrée), et un seul bouton « Enregistrer » apparaît en bas dès
  qu'il y a une modification.
- **Thèmes** : Nuit, Beige, Blanc & bleu, Forêt, Lavande — bouton dans le menu latéral (passe au
  suivant) ou Réglages → Apparence & aide.
- **Tutoriel** : bouton « Tutoriel » en haut de la page (aussi en mode kiosque) — visite guidée
  de la page « À imprimer » (flèches du clavier, Échap pour quitter).

**Enlever tout maintenant** — bouton sous « Articles toujours en stock » (Réglages → Atelier) :
parcourt la file, montre ce qui serait retiré (aperçu + confirmation) puis supprime les pièces
« À imprimer » / « Échec » dont le titre, la variante ou le SKU contient un des mots de la
liste (même non enregistrée). Les pièces ajoutées à la main, en cours d'impression ou déjà
imprimées ne sont pas touchées.

**Ouvrir sur la boutique** — dans la fiche d'une pièce (clic sur la carte), des boutons
« Ouvrir sur Shopify / Etsy » (commande dans l'admin de la boutique) et « Ouvrir sur Chit Chats »
(page de suivi du colis) apparaissent quand le lien peut être construit : le domaine Shopify doit
être configuré, et le colis doit avoir un numéro de suivi.

## Extension Chrome : « Ouvert sur Shopify » → « Ouvrir sur Chit Chats »

Dossier [`chrome-extension/`](chrome-extension/README.md). Quand une commande est ouverte dans
l'admin Shopify, ses cartes affichent **Ouvert sur Shopify** (avec le nom de la personne) et un
bouton **Ouvrir sur Chit Chats**, qui ouvre la page d'expédition (adresse réglable dans
Réglages → Boutiques → Chit Chats, `{order}` = numéro de commande) et copie le numéro de commande.
Le marquage disparaît en changeant de page, en fermant l'onglet, ou après 30 min sur la même page.

## Import automatique des commandes dans Chit Chats

Toutes les heures (Réglages → Synchronisation, activable dans Boutiques → Chit Chats), chaque
commande Shopify / Etsy ouverte et récente devient un **envoi « en attente » dans Chit Chats**
(rien n'est acheté : l'étiquette s'achète toujours dans Chit Chats). Adresse reprise de la commande,
poids / dimensions par défaut réglables, Canada → Chit Chats Canada Tracked, États-Unis → USPS
Ground Advantage, ailleurs → International Tracked (avec détail douane), ou « le moins cher ».
Si Chit Chats a déjà un envoi pour ce numéro de commande, il est simplement relié (pas de doublon).

En cas d'échec, l'app **trouve la raison** (adresse incomplète : code postal / province manquant,
pas d'adresse de livraison, accès refusé, refus de Chit Chats avec le champ en cause...) et
l'affiche en **étiquette rouge sur les pièces** de la commande, avec le détail et un bouton
« Réessayer maintenant » dans la fiche. Les commandes en erreur sont retentées à chaque heure.

**Photo du produit** : la fiche d'une pièce affiche la photo Shopify / Etsy quand elle est connue.
Pour Shopify, la photo vient de la ligne de commande (API GraphQL, scope `read_orders` suffit) ;
l'API produits (`read_products`) ne sert plus qu'en secours. Les commandes déjà importées sans
photo la reçoivent automatiquement à la synchro Shopify suivante.

**Pièce déjà en inventaire** — sur une carte « À imprimer », le bouton **Expédié** la fait
passer directement à Expédié, sans passer par l'impression.

**Tags** — plusieurs tags par pièce, ajoutés comme dans les Réglages : taper puis Entrée (suggestions
= tags prédéfinis ; un nouveau tag y est ajouté automatiquement), × pour en retirer un. Visibles sur les cartes, la fiche et la vue « Tout ». Le tableau reste groupé par couleur.

**Extension v1.1** — bouton « Chit Chats #1234 » accroché au bord droit de la commande Shopify
(déplaçable, loin du chat Sidekick de la nouvelle interface), fenêtre de l'extension avec un gros
bouton « Ouvrir sur Chit Chats », numéro de commande lu sur la page (marche sans l'app), et
mise à jour en un clic depuis GitHub (icône → Mettre à jour).

**Extension v1.2 — lien live** : Shopify et Chit Chats côte à côte ; « 🔗 Link » sur Shopify puis
« 🔗 Link » sur l'onglet Chit Chats, et chaque commande ouverte dans Shopify s'affiche dans Chit
Chats. « Stop live » pour couper. Détails dans [`chrome-extension/README.md`](chrome-extension/README.md).

**Etsy : Shared secret obligatoire** — Etsy exige maintenant sur chaque appel l'en-tête
`x-api-key: <keystring>:<shared secret>` (sinon 403). Renseigne le **Shared secret** (Etsy →
Your Apps, à côté de la keystring) dans Réglages → Boutiques → Etsy. Le Shop ID est aussi
détecté automatiquement depuis le compte connecté (à la connexion OAuth, et corrigé si Etsy
refuse celui saisi).

**« Tout » = tout ce qui est expédié d'ici** — les articles qu'on n'imprime pas ici (suppléments,
articles toujours en stock, résines faites ailleurs) ne sont plus supprimés : ils sortent seulement
de « À imprimer » et restent dans « Tout » avec l'étiquette « Pas imprimé ici ». Dans la fiche,
le bouton « Pas imprimé ici » les sort de la file ou les y remet. « Enlever tout maintenant » fait
pareil (rien n'est supprimé). Les anciennes lignes de commande qui n'avaient pas de pièce en
reçoivent une automatiquement à la mise à jour.
