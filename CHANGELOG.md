# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Les entrées les
plus récentes sont en haut ; chaque ligne correspond à un commit de l'historique Git.

## [Non publié]

### Modifié
- **Les objets d'inventaire se créent depuis `/inventory/mobile`** (le téléphone) : le formulaire « Nouvel objet » a quitté le tableau de bord, qui garde le code QR, le bouton « Ouvrir la page d'inventaire » et l'impression de ce code. Le code QR (et ses étiquettes imprimables) mène maintenant à `/inventory/mobile` ; `/inventory/new` marche toujours (ouvre le formulaire d'ajout), donc les étiquettes déjà imprimées restent valides. Modifier, signaler, commander et supprimer restent aussi possibles sur l'ordinateur.

### Ajouté
- **Unité du minimum** : on peut choisir une unité (rouleaux, bac, boîtes, bouteilles… ou n'importe quel texte) pour la quantité minimale et la quantité à commander : « Scanner à 2 rouleaux », « Minimum 1 bac ». Champ « Unité » dans le formulaire, « Modifier » et la page du téléphone ; elle apparaît sur les deux étiquettes (si l'unité est longue, la petite étiquette réduit le texte ou affiche seulement « 2 rouleaux ») et sur les cartes de l'app.
- **Étiquette « Ajouter à l'inventaire »** : un code QR imprimable (2×1 po ou grande) à coller dans l'atelier, qui ouvre la page d'ajout du téléphone (`/inventory/add-card`, boutons sur la page Inventaire).
- **Questions au scan depuis le téléphone** : la page d'ajout du téléphone a une section « Questions au scan » (choix dans une liste ou couleurs de résine avec plusieurs réponses possibles, nombre, texte libre).
- **Toutes les fonctions des cartes sur le téléphone** (`/inventory/mobile`, onglets « Ajouter » / « Objets ») : liste avec recherche, fiche d'un objet, **modifier** (tous les champs : nom, photo, minimum, unité, quantité à commander, fournisseur, note, questions), **« Il faut en racheter »** avec les questions (« Il manque aussi… » si déjà signalé), **« Commandé »**, **supprimer**, **étiquette 2×1 po / grande** (liens) et **téléchargement de l'étiquette en image**.
- **Ajouter un objet d'inventaire depuis le téléphone** : page `/inventory/new` pensée pour le téléphone (nom,
  **photo prise avec l'appareil**, minimum, quantité à commander, fournisseur ; les fournisseurs déjà saisis sont
  proposés). Un code QR sur la page Inventaire l'ouvre ; après l'ajout, « Ajouter un autre objet » et « Voir la
  grande étiquette ». Marche en mode simple comme avancé (page indépendante, protégée par le mot de passe de l'app s'il y en a un).
- **Deuxième style d'étiquette : grande, 4 par feuille Lettre.** Nom de l'article, **photo**, code QR, **minimum**,
  **quantité à commander** et **commander chez** (les trois derniers facultatifs : absents de l'étiquette s'ils sont vides).
  Chaque objet a maintenant deux boutons d'impression (« Étiquette 2×1 po » et « Grande étiquette »), et « Toutes en
  grand (4/feuille) » imprime tout l'inventaire (une feuille = 4 étiquettes, marges de 0,25 po). Les champs se
  remplissent dans « Plus d'options » du formulaire et dans « Modifier » ; la photo est réduite (700 px) dans le
  navigateur avant l'envoi. API : `order_qty`, `supplier`, `image` (data URL) sur `/api/inventory`, `GET /api/inventory/:id/image`,
  `/inventory/cards?style=large`.
- **`scripts/publish.sh`** : publie le commit courant sur `main` des deux dépôts (privé et public) après les tests et vérifie que les deux pointent sur le même commit (`--dry-run` pour simuler).
- **Extension 1.7.0 : tags par commande (Shopify et Etsy).** La fenêtre « J'ai packé » a une section « Tags de la
  commande » : To pack, Pre packed, Started, Hold, Address, Nylon restock (liste modifiable dans Réglages → Atelier
  → Tags de commande). Cocher un tag l'ajoute aux **tags de la commande Shopify** (le décocher le retire) ; sur Etsy,
  qui n'accepte pas de tags depuis l'extérieur, il reste dans l'app. « Pre packed » suit aussi le bac complet.
  Les boutons montrent ce qui a été coché depuis l'extension (pas les tags ajoutés à la main dans Shopify).
  Besoin du scope `write_orders` (reconnecter Shopify une fois, voir plus haut).
- **Extension 1.6.7** : quand le lien live est actif, « Stop live » est remplacé par **« 🐞 Bug »**, qui ouvre
  l'app sur la fenêtre **« Signaler un bug »** (adresse `/#bug`). Pour couper le lien, on clique sur « ● Live ».
  L'adresse `/#bugs` ouvre la liste des bugs signalés (Réglages → Mises à jour).
- **Inventaire : questions au scan.** Un objet peut poser des questions quand on scanne sa carte : un
  **choix** (liste libre ou **couleurs de résine** du catalogue, une ou plusieurs réponses), un **nombre** ou
  un **texte libre**. Une seule étiquette « Résine » suffit : on coche les couleurs qui manquent. Les réponses
  (une ligne par scan) s'affichent sous l'objet dans « À racheter » et s'accumulent jusqu'à « Commandé ».
  Sans question, rien ne change (le scan signale tout seul). Ouvrir l'adresse du code ne modifie toujours rien :
  c'est l'envoi du formulaire qui signale.
  Le bouton **« À racheter »** du tableau de bord pose les mêmes questions (fenêtre « Qu'est-ce qui manque ? »), et
  « Il manque aussi… » permet d'ajouter une autre variante à un objet déjà signalé.
- **Extension 1.6.5 (Etsy)** : un petit bouton (le logo) reste sur chaque commande, en plus de la barre de
  droite : il sélectionne la commande et ouvre / ferme sa boîte « J'ai packé ».
- **Extension 1.6.4 (Etsy)** : « Commande inconnue de l'app » sur des commandes pourtant synchronisées : le
  numéro affiché par Etsy (`#4208…`) n'est pas toujours le `receipt_id` que l'app a enregistré. L'extension
  essaie maintenant chaque identifiant des liens de la ligne avant le numéro affiché, et l'app retrouve aussi
  une commande par son numéro de commande.
- **Extension 1.6.3 (Etsy)** : plus de boutons sur chaque commande ; la **même barre sur Shopify** est
  accrochée au bord droit (poignée ⋮⋮, 📦 J'ai packé, 🔗 Link / Live). Elle agit sur la commande
  sélectionnée en cliquant sa ligne (entourée en bleu) ; une seule commande à l'écran = sélectionnée d'office.
- **Extension 1.6.2 (Etsy)** : les boutons sont posés sur chaque commande (repérée par son numéro `#…` affiché,
  plus par les liens de la page, ce qui les mettait aussi dans la barre d'onglets), et Chit Chats cherche
  **le nom de l'acheteur** (ligne « Ship to ») au lieu du numéro Etsy, qu'il ne connaît pas toujours.
- **Tags de l'extension → commande Shopify** : quand on enregistre le bac (« J'ai packé »), l'app ajoute à la
  commande Shopify le tag « Packé par X » et, si le bac est complet, « Pre packed » (retiré si le bac redevient
  incomplet). Les autres tags de la commande ne sont pas touchés. **À faire une fois** : Réglages → Boutiques →
  reconnecter Shopify (le scope `write_orders` est maintenant demandé) ; sans lui, la fenêtre du bac le dit
  mais l'enregistrement du bac réussit quand même. Extension 1.6.1.
- **Extension 1.6.0 : Etsy.** Sur la liste des commandes d'Etsy Shop Manager, un bouton (le logo de
  l'extension) et un bouton 🔗 sont accrochés à chaque commande : ouvre la boîte « J'ai packé » et amène
  Chit Chats sur la bonne commande, comme sur Shopify. Côté app : `GET`/`POST /api/packing/etsy/:etsyId`.
- **Réglages → API** : des exemples prêts à copier (liste des pièces, changement de statut, commandes,
  chiffres, synchro) en **curl**, **Windows (PowerShell)** et **n8n** (nœud « HTTP Request » à coller dans
  le canvas). Aucun jeton : l'API est ouverte sur le réseau local (mot de passe de l'app si elle en a un).
- **Webhook HTTP « nouveau bug »** : à chaque bug signalé avec la coccinelle, l'app appelle en
  **POST** (JSON) l'adresse réglée dans Réglages → Mises à jour (un résumé dans `text` / `content`,
  compatible Slack et Discord, et le détail dans `bug` avec des liens vers le rapport et la capture).
  Bouton « Envoyer un test » et état du dernier envoi ; l'adresse (souvent avec un jeton) n'est
  jamais renvoyée par l'API. Une panne du webhook ne bloque jamais un signalement.
- Extension Chrome 1.5.0 : **tutoriel** (visite guidée du bandeau, de « J'ai packé » et du lien
  live) lancé seulement depuis la page de réglages de l'extension, sur la fausse page Shopify.
- **Kiosque** : sélecteur de thème en haut de l'écran (le menu latéral qui le portait y est caché).
- Inventaire : carte téléchargeable en **PNG** (bouton « PNG », 90 × 62 mm à 300 dpi, le nom
  rétrécit s'il est long) ; le champ « nom d'hôte » des Réglages accepte `3dkeycap.local`,
  `3dkeycap.local:8080` ou une IP sans écrire `http://`.
- **Inventaire** (nouvel onglet) : « il faut en racheter ». On crée un objet (nom + quantité à
  laquelle scanner) et on obtient une **carte imprimable avec un code QR** vers
  `http://3dkeycap.local/r/…`. Scanner le code avec un téléphone passe l'objet à « à racheter »
  tout seul (confirmation + « annuler » en cas d'erreur) ; il apparaît dans la liste « À racheter »
  du tableau de bord jusqu'à ce qu'on clique « Commandé ». Adresse des codes réglable (Réglages →
  Atelier → Inventaire). Nouvelle dépendance : `qrcode-generator`.
- **Annuler (Ctrl+Z)** et bouton « Annuler » : défait les déplacements de cartes, les échecs
  (retirés aussi de la page Échecs) et les modifications d'une pièce, jusqu'à 30 actions.
- Bouton **Regrouper** à 3 états par colonne : *Commande* (défaut, une carte par commande avec la
  liste de ses pièces), *Séparées*, *Identiques*.
- La **variante** s'affiche sur les cartes (aussi en mode Simple et au kiosque), sous le nom de la pièce.
- Extension Chrome 1.4.0 : **mode démo** dans ses réglages — une fausse admin Shopify et un faux
  Chit Chats pour tester le bouton Chit Chats, le bac « J'ai packé » et le lien live sans toucher
  aux vraies boutiques.
- Mode **Simple par défaut** sur un appareil neuf (le kiosque est toujours en simple).
- Au pied du menu : « Dernière synchro il y a 3 min ✓ » à la place des expressions cron.
- `CLAUDE.md` (règles du projet), `docs/guide-atelier.md`, `docs/technique.md`.
- Test qui vérifie que chaque module du front se charge (pas de page blanche).

### Corrigé
- **Plus rien d'effacé en cours de saisie** : le rafraîchissement automatique (toutes les 8 et 30 s) ne
  redessine plus la page quand une fenêtre est ouverte, qu'un champ a le focus ou contient du texte pas
  encore envoyé (nouvel objet d'inventaire, questions…). Dans Réglages, les modifications pas enregistrées
  survivent au changement d'onglet, l'onglet ouvert survit à F5, et le navigateur demande confirmation
  avant de recharger avec des modifications non enregistrées.
  Le formulaire « Nouvel objet » de l'inventaire (nom, quantité, questions) se garde aussi à travers n'importe quel
  redessin de la page (rafraîchissement, autre action).
- **Etsy : commandes manquantes** : la synchro ne lisait que la première page de 100 reçus ; au-delà, les plus
  anciennes commandes non expédiées n'arrivaient jamais. Elle parcourt maintenant toutes les pages.
- **Mémoire du serveur** : les caches de photos (Shopify, Etsy) et des essais de récupération d'images
  grossissaient sans limite tant que l'app tournait ; ils sont plafonnés à 5000 entrées. (Mesuré :
  ni les routes de l'API ni la synchro simulée ne montrent d'autre fuite ; l'interface reste stable
  après des centaines de rafraîchissements.)
- Les **commandes annulées** (Shopify : `cancelled_at`, Etsy : reçu « canceled ») quittent
  « À imprimer » et ses compteurs. Une commande déjà annulée à son arrivée ne crée aucune pièce ;
  une commande annulée après coup (webhook ou synchro, qui vérifie toutes les commandes ouvertes)
  voit ses pièces retirées de la file, mais gardées dans « Tout » avec l'étiquette « Annulée »
  (les pièces déjà expédiées ne bougent pas). Elle n'est plus importée dans Chit Chats ni marquée
  expédiée. Extension 1.4.2 : la boîte « J'ai packé » prévient « cette commande a été annulée ».

### Modifié
- **Inventaire : les réponses aux questions en gros.** Une fois signalé, ce qui manque (« Noir, Gris », « 3 »…) s'affiche en grosses pastilles, aussi lisibles que le nom de l'objet, dans « À racheter » et sur la carte de l'objet (avec la question en petit au-dessus).
  Les réponses identiques de plusieurs employés sont regroupées en une seule ligne : « Signalé 3 fois · dernier scan il y a 5 min ».
- **Cartes de « Resin Queue » : ce qui vient du bac s'affiche avec le nom de la personne.** Le « Manque au bac : <raison> »
  est suivi de « — <qui a packé> », et la note écrite dans le bac (ex. « Bac 4, étagère du haut ») apparaît sur la
  carte, aussi en mode simple, avec le même nom : on sait à qui demander.
- **Extension 1.8.1** : le titre « 📦 Bac — commande #… » est remis en haut de la fenêtre « J'ai packé ».
- **Mode simple, « Resin Queue »** : quand les cartes sont classées par couleur, la pastille de couleur de chaque carte
  est masquée (l'en-tête du groupe la donne déjà), de même que le « #1 » en haut à droite (le « ×3 » d'une pile
  reste). La fiche d'une pièce n'affiche plus « Reçue », « SKU » ni « Suivi » (toujours là en mode Avancé).
- **Extension 1.8.0 : moins de bruit au quotidien.** Les tags de commande sont dans une **liste déroulante** (cases à
  cocher) et le message « Ajouté dans Shopify aussi » a disparu (seule une panne est signalée). Quand le lien live
  est actif, le bouton « Chit Chats » et le libellé « ● Live » laissent place à un **petit point vert devant le numéro
  de commande** (cliquer le coupe), avec « 🐞 Bug » à côté. Dans la fenêtre du bac : plus de titre « 📦 Bac — commande
  … », plus d'image ni de variante sur les articles.
- **Étiquettes d'inventaire de 2 po × 1 po** (50,8 × 25,4 mm) au lieu des grandes cartes : nom, « Scanner à N »
  et code QR, en noir et blanc pour une imprimante d'étiquettes. La page d'impression règle le papier
  (`@page` 2 po × 1 po, une étiquette par page) ; le PNG fait 600 × 300 px (300 dpi). Les codes QR ne
  changent pas : les cartes déjà imprimées restent valides.
- L'adresse de l'app dans les codes QR d'inventaire (et dans les liens du webhook de bugs) est par
  défaut **`http://192.168.1.223:8080`** (l'adresse IP de l'app), à la place de `3dkeycap.local`.
  Les cartes déjà imprimées avec l'ancien nom ne marchent plus : les réimprimer (ou remettre
  l'ancien nom dans Réglages → Atelier → Inventaire).
- L'application s'appelle maintenant **3D Keycap Lab** (menu, titre de l'onglet, kiosque installé,
  signalements de bug) et sa page principale **Resin Queue** (ex. « À imprimer »). Les trois
  colonnes gardent leurs noms « À imprimer », « En impression », « Imprimé » (ce sont des statuts).
  L'extension Chrome, le dépôt et Docker gardent leurs noms.
- Extension Chrome 1.4.1, boîte « J'ai packé » : plus de **rouge** pour ce qui n'est qu'une étape à
  compléter (nom pas choisi, raison d'une pièce manquante, bac commencé) — rappel aimable en ambre,
  champ entouré, qui disparaît dès que la personne agit. Les vraies pannes restent en rouge mais
  disent que rien n'est perdu et que ce n'est pas de la faute de l'employé.
- Les **3 colonnes** de « À imprimer » se partagent toute la largeur de l'écran (bureau et
  kiosque) ; sur un téléphone elles défilent. Une colonne agrandie prend toute la largeur.
- Le contour de couleur des cartes passe de 2 à **3 px**.
- La couleur de la résine **entoure toute la carte** (et la ligne du tableau « Tout ») au lieu
  d'un simple trait sur le côté.
- Plus aucun affichage **Chit Chats** dans l'app (cartes, fiche, tableau « Tout »). Les réglages
  Chit Chats et l'extension Chrome restent.
- Un tag tapé sur une pièce n'est plus ajouté à la liste globale des suggestions.
- README raccourci ; l'ancienne version complète devient `docs/technique.md`.

## 2026-10-18

### Ajouté
- **Échecs** : un clic sur Échec renvoie la pièce dans « À imprimer » (plus de colonne Échec).
  Nouvelle page *Échecs* : taux d'échec par fichier (échecs ÷ impressions terminées), détail par
  résine, historique de chaque échec, fichiers masquables. Tag « A échoué ×N » sur la pièce.
- **Couleur forcée selon le nom** (« Ore Keycap => Nylon Grey ») : corrige les variantes dont le
  nom (Gold, Diamond, Redstone…) ressemblait à une résine.
- **Kiosque** : vrai plein écran (bouton + premier appui) et manifeste installable.
- **Tutoriel** réécrit en 10 étapes simples ; démarre seul à la première visite.
- Bouton coccinelle pour signaler un bug (capture d'écran, journaux, liste dans les réglages).
- Résumé lisible de chaque synchro Shopify / Etsy.
- Bascule **Simple / Avancé** (sans barre latérale ni nom de client en simple).

### Modifié
- Plus de sélecteur d'**imprimante** ; plus de doublons (résine, UV) dans la fiche d'une pièce.
- Photos Etsy génériques masquées ; pas de bouton Synchroniser en mode simple.

## 2026-10-04

### Ajouté
- **Mises à jour depuis GitHub** (dépôt public ou privé) : script `scripts/update.sh`, service
  `updater`, section « Mises à jour » des réglages (token, bouton, mode automatique),
  sauvegardes de la base avant chaque mise à jour, retour arrière automatique.
- **Filtres** : compteurs « à facettes », puce « Sans UV », recherche littérale (`%`, `_`).
- Extension Chrome 1.1 → 1.3.4 : « Ouvert sur Shopify », barre Chit Chats, bac « J'ai packé »,
  notes internes, mises à jour en un clic.
- **Bac**, commandes traitées par les marketplaces, âge des commandes, notes clients.
- Import horaire des commandes dans Chit Chats avec erreurs expliquées.
- Photos produits Shopify (scope `read_orders`), clé Etsy `keystring:secret`.
- Réglages en onglets, 3 nouveaux thèmes (blanc & bleu, forêt, lavande), tutoriel guidé.
- Couleurs masquées, regroupement des pièces identiques, mode `/kiosk`, « Enlever tout
  maintenant », plusieurs tags par pièce.

### Corrigé
- Tableau de bord en HTTP sur l'adresse IP du réseau local (en-têtes de sécurité).
- Cartes écrasées en colonne agrandie ; défilement conservé au rafraîchissement.

## 2026-09-20

### Ajouté
- Application initiale (file d'impression + inventaire résine), refonte autour de la feuille de
  calcul remplacée, liste d'imprimantes (retirée depuis).
- Shopify puis Etsy en **OAuth 2.0** (PKCE pour Etsy).
- Détection des suppléments de commande, séparation Nylon / résine.
- Vue « colonne agrandie » et tags rapides ; photo au survol.

### Corrigé
- Curseur de synchro qui masquait les anciennes commandes ; nettoyage automatique des
  commandes de démonstration ; double slash dans l'URL de redirection OAuth.
