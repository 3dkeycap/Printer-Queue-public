# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Les entrées les
plus récentes sont en haut ; chaque ligne correspond à un commit de l'historique Git.

## [Non publié]

### Ajouté
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
