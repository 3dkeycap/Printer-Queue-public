# Guide de l'atelier

Pour quelqu'un qui n'a jamais utilisé l'outil. Compte 10 minutes de lecture, ou lance la
visite guidée : bouton **Tutoriel** en haut de la page (elle démarre aussi toute seule la
première fois sur un appareil).

## L'idée

Chaque **carte** est **une pièce physique** à imprimer. Une commande de 3 clés donne 3 cartes.
Les commandes Shopify et Etsy arrivent toutes seules (toutes les 5 minutes) : il n'y a rien à
saisir.

## Les 3 colonnes

| Colonne | Veut dire |
| --- | --- |
| **À imprimer** | Pas encore lancée |
| **En impression** | Sur une imprimante en ce moment |
| **Imprimé** | Terminée, prête à être emballée |

Une pièce avance de gauche à droite :

- **le bouton avec la flèche** en bas de la carte (ex. « En impression › ») la passe à l'étape
  suivante ;
- ou **glisse la carte** dans la colonne d'à côté ;
- **touche la carte** pour voir ses détails (commande, notes du client, historique).

## Annuler une erreur (Ctrl+Z)

Une carte déplacée par erreur ? Le bouton **Annuler** (en haut) ou **Ctrl+Z** (Cmd+Z sur Mac)
défait la dernière action, puis la précédente, jusqu'à 30 actions : déplacements de cartes,
échecs (l'échec disparaît aussi de la page *Échecs*) et modifications d'une pièce. La liste
d'actions est vidée quand on recharge la page.

## Quand l'impression rate

Appuie sur le **triangle rouge** de la carte. La pièce retourne tout de suite dans
« À imprimer » pour être refaite, avec le tag **« A échoué »** (« ×2 » au deuxième échec).
L'échec est gardé : il compte dans la page **Échecs** (mode Avancé), qui montre quels fichiers
ratent le plus souvent.

## Commande annulée

Quand un client annule sa commande (Shopify ou Etsy), ses cartes **disparaissent toutes seules**
de « À imprimer » à la synchro suivante (au plus 5 minutes). Elles restent dans la page **Tout**
(mode Avancé) avec l'étiquette rouge « Annulée », pour l'historique. Si tu as déjà emballé une
pièce de cette commande, la boîte « J'ai packé » de l'extension te prévient qu'elle est annulée.

## Trouver ce qu'on cherche

- **Couleur** : touche une couleur pour ne voir que cette résine — pratique pour remplir un
  plateau. Retouche pour enlever le filtre. Le chiffre est le nombre de pièces.
- **En retard** : les commandes qui attendent depuis trop longtemps (badge rouge sur la carte).
- **Recherche** : un nom de pièce, un numéro de commande ou un client. La touche `/` y va
  directement.
- **Regrouper** (en haut de chaque colonne) : le bouton change la façon de ranger les cartes à
  chaque clic. **Commande** (par défaut) : une carte par commande, avec la liste de ses pièces ;
  **Séparées** : une carte par pièce ; **Identiques** : les pièces identiques fusionnées en
  « ×3 ». Les boutons d'une carte regroupée agissent sur toutes ses pièces.
- La **couleur de la résine** entoure toute la carte (pas seulement un trait sur le côté).
- **Agrandir** (icône des quatre coins) : une seule colonne en grille, pour tout voir d'un coup.

## Tags

Un tag est une petite étiquette libre sur une pièce (« Attente client », « Réimpression »…).
Dans la fiche d'une pièce : écris dans la case, puis **Entrée**. Un tag tapé reste sur sa
pièce. Pour qu'un tag soit **proposé partout**, ajoute-le dans Réglages → Atelier → Tags.

## Inventaire : « il faut en racheter »

Onglet **Inventaire** (mode Avancé). Pour chaque chose qu'on rachète (gants, alcool, filtres…) :

1. **Crée l'objet** : son nom, et la quantité à laquelle il faut prévenir (« quand il en reste 2 »).
2. **Imprime sa carte** (bouton « Imprimer la carte ») : le nom, la quantité et un **code QR**.
   Colle-la sur l'étagère ou la boîte.
3. Quand il n'en reste plus que cette quantité, **scanne le code QR avec ton téléphone** (appareil
   photo, sur le réseau de l'atelier). L'écran répond « C'est noté ! » : l'objet passe tout seul à
   **à racheter**. Une erreur ? Bouton « Je me suis trompé : annuler » sur ce même écran.
   Besoin de l'image ? Le bouton **PNG** télécharge la carte (prête à imprimer ou à envoyer).
4. Celui qui commande voit la liste **À racheter** dans l'onglet ; une fois commandé, il clique
   **Commandé** (l'objet repasse à OK).

Le code QR ouvre `http://3dkeycap.local/…` (le nom d'hôte se change dans Réglages → Atelier →
Inventaire) : pas besoin de se connecter. Si quelqu'un scanne deux
fois, rien n'est doublé (c'est juste noté).

## L'écran d'atelier (kiosque)

Sur l'iPad ou l'écran de l'atelier, ouvre `http://<adresse du serveur>:8080/kiosk` : la même
file, sans menu, avec de gros boutons. Le bouton **Plein écran** (ou le premier appui sur
l'écran) masque la barre du navigateur. Sur tablette, « Ajouter à l'écran d'accueil » ouvre
directement en plein écran.

## Simple ou Avancé

Le sélecteur en haut de la page (ordinateur seulement) :

- **Simple** (par défaut) : seulement le tableau « À imprimer ».
- **Avancé** : en plus, les pages **Tout** (toutes les pièces, tableau modifiable),
  **Échecs** et **Réglages**, ainsi que l'UV, le rush, la provenance et le numéro de commande
  sur les cartes.

## Réglages (mode Avancé)

- **Boutiques** : connexion Shopify, Etsy et Chit Chats.
- **Atelier** : postes UV, tags suggérés, ce qu'on n'imprime pas ici, couleurs forcées selon le
  nom (ex. « Ore Keycap » = Nylon Grey).
- **Résines** : couleurs, alias de détection, stock.
- **Mises à jour** : bouton pour installer la dernière version (la base est sauvegardée avant).

## Un problème ?

Touche le **bouton rouge** (coccinelle) en bas à droite, écris ce qui ne va pas en une phrase
et envoie : la capture de l'écran et les journaux partent avec.
