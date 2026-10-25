# Guide de l'atelier — 3D Keycap Lab

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
de « Resin Queue » à la synchro suivante (au plus 5 minutes). Elles restent dans la page **Tout**
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

Le code QR ouvre `http://192.168.1.223:8080/…` (l'adresse se change dans Réglages → Atelier →
Inventaire) : pas besoin de se connecter. Si quelqu'un scanne deux
fois, rien n'est doublé (c'est juste noté).

## L'écran d'atelier (kiosque)

Sur l'iPad ou l'écran de l'atelier, ouvre `http://<adresse du serveur>:8080/kiosk` : la même
file, sans menu, avec de gros boutons. Le bouton **Plein écran** (ou le premier appui sur
l'écran) masque la barre du navigateur. Sur tablette, « Ajouter à l'écran d'accueil » ouvre
directement en plein écran.

Le **thème** (couleurs de l'écran) se change avec le sélecteur en haut de l'écran du kiosque.

## Simple ou Avancé

Le sélecteur en haut de la page (ordinateur seulement) :

- **Simple** (par défaut) : seulement la page **Resin Queue** (le tableau des 3 colonnes).
- **Avancé** : en plus, les pages **Tout** (toutes les pièces, tableau modifiable),
  **Échecs** et **Réglages**, ainsi que l'UV, le rush, la provenance et le numéro de commande
  sur les cartes.

## Réglages (mode Avancé)

- **Boutiques** : connexion Shopify, Etsy et Chit Chats.
- **Atelier** : postes UV, tags suggérés, ce qu'on n'imprime pas ici, couleurs forcées selon le
  nom (ex. « Ore Keycap » = Nylon Grey).
- **Résines** : couleurs, alias de détection, stock.
- **Mises à jour** : bouton pour installer la dernière version (la base est sauvegardée avant).

## Tags de commande (To pack, Hold…)

Dans la fenêtre « J'ai packé » (Shopify et Etsy), la section **Tags de la commande** : un clic coche / décoche
To pack, Pre packed, Started, Hold, Address, Nylon restock. Sur Shopify le tag est ajouté (ou retiré) aux tags
de la commande ; sur Etsy il reste dans l'app. La liste se change dans Réglages → Atelier → Tags de commande.

## Tags Shopify depuis le bac

Quand tu enregistres le bac, la commande Shopify reçoit « Packé par <ton nom> » et, si tout est dans le
bac, « Pre packed ». Première fois seulement : Réglages → Boutiques → reconnecter Shopify (autorisation
d'écriture).

## Inventaire : ajouter depuis le téléphone

Sur la page Inventaire, scanne le code « Ajouter depuis le téléphone » : un formulaire simple s'ouvre
(photo avec l'appareil, nom, minimum, quantité à commander, fournisseur). Pratique pour faire le tour de
l'atelier et tout ajouter en marchant ; le téléphone doit être sur le réseau de l'atelier. Un bouton imprime ce code
(« Étiquette 2×1 po » ou « Grande étiquette ») pour le coller dans l'atelier.

## Inventaire : deux styles d'étiquette

Chaque objet s'imprime en **petite étiquette 2 × 1 po** (imprimante d'étiquettes) ou en **grande étiquette** :
4 par feuille Lettre, avec la photo, le code QR, le minimum, la quantité à commander et le fournisseur
(facultatifs, à remplir dans « Plus d'options » ou « Modifier »).

## Inventaire : une étiquette, plusieurs variantes

Dans Inventaire, « Poser des questions au scan » : par exemple une carte « Résine » qui demande
**quelle résine manque** (couleurs du catalogue, plusieurs possibles), ou un nombre de bouteilles, ou un
texte. Au scan, le téléphone affiche les questions ; les réponses apparaissent dans « À racheter ».

## Piloter l'app depuis un script ou n8n

Réglages → **API** : des exemples à copier (curl, Windows, n8n). Pas de jeton à créer, l'API répond
sur le réseau de l'atelier.

## Apprendre l'extension Chrome

Dans les réglages de l'extension (clic droit sur son icône → Options), le bouton **Lancer le
tutoriel de l'extension** ouvre une fausse page Shopify avec une visite guidée du bandeau
Chit Chats, de la boîte « J'ai packé » et du lien live. Le tutoriel ne se lance jamais tout seul
et jamais sur le vrai Shopify.

## Un problème ?

Touche le **bouton rouge** (coccinelle) en bas à droite, écris ce qui ne va pas en une phrase
et envoie : la capture de l'écran et les journaux partent avec.
