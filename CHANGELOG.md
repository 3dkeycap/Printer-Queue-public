# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Les entrées les
plus récentes sont en haut ; chaque ligne correspond à un commit de l'historique Git.

## [Non publié]

### Ajouté
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

### Modifié
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
