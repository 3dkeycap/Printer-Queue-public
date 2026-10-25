# Extension Chrome Resin Queue (Shopify → Chit Chats)

Quand tu ouvres une commande dans l'admin Shopify, l'extension prévient l'app :

- dans « À imprimer », les cartes de cette commande affichent **Ouvert sur Shopify** (avec ton nom)
  et un bouton **Ouvrir sur Chit Chats** ;
- sur la page Shopify, un bouton **Chit Chats #1234** est accroché au bord droit (loin du chat
  Sidekick de la nouvelle interface Shopify, en bas de page). Il se déplace en glissant la poignée ⋮⋮ ;
- en cliquant l'icône de l'extension sur une commande : une fenêtre avec le numéro de commande et
  un gros bouton **Ouvrir sur Chit Chats**.

Le numéro de commande est lu directement sur la page Shopify : le bouton marche même si l'app
est injoignable (il faut seulement le Client ID Chit Chats dans les réglages de l'extension).

« Ouvrir sur Chit Chats » ouvre la page d'expédition Chit Chats (adresse réglable dans
Réglages → Boutiques → Chit Chats, `{order}` = numéro de commande) **et copie le numéro de commande**
dans le presse-papiers : si Chit Chats ne le pré-remplit pas, il suffit de le coller.

Le marquage disparaît tout seul quand :
1. la même page est ouverte depuis plus de **30 minutes** ;
2. tu **changes de page** (autre commande, liste...) ou **fermes l'onglet** ;
3. l'app n'a plus de nouvelles depuis 90 s (navigateur fermé, ordinateur en veille).

## Installation (une fois par ordinateur)

1. Dans l'app : Réglages → Apparence & aide → **Télécharger l'extension** (fichier
   `resin-queue-extension.zip`, l'adresse de l'app y est déjà), puis **décompresse-le**.
   (Ou copie ce dossier `chrome-extension` depuis le dépôt.)
2. Dans Chrome : `chrome://extensions` → active **Mode développeur** (en haut à droite).
3. **Charger l'extension non empaquetée** → choisis le dossier décompressé (`resin-queue-extension`).
4. Clique l'icône de l'extension (pièce de puzzle → Resin Queue) : renseigne l'adresse de l'app
   (ex. `http://192.168.1.50:8080`), ton nom, et le mot de passe du dashboard s'il y en a un.
   **Enregistrer et tester** doit afficher « connexion à l'app OK ».

## Mise à jour

Icône de l'extension → **Mettre à jour** (un ↑ apparaît sur l'icône quand une nouvelle version
est sur GitHub) → **Mettre à jour depuis GitHub**. La première fois, Chrome demande de choisir le
dossier de l'extension (celui chargé dans `chrome://extensions`) ; ensuite c'est un seul clic :
les fichiers sont téléchargés depuis GitHub, écrits dans ce dossier, et l'extension se recharge.
Tes réglages et le fichier `defaults.json` sont conservés.

Les versions 1.0.0 n'ont pas encore ce bouton : il faut les remplacer une dernière fois à la main
(télécharger l'extension depuis l'app, remplacer le dossier, cliquer ↻ dans `chrome://extensions`).

## Etsy (liste des commandes)

Sur Etsy Shop Manager → Commandes (`etsy.com/your/orders/…`), il n'y a pas de page plein écran par
commande : l'extension accroche à **chaque commande** un bouton avec son logo, plus un bouton 🔗.
Le logo ouvre la boîte « J'ai packé » de la commande et amène Chit Chats sur la bonne commande
(onglet lié si le lien live est actif, sinon un nouvel onglet, numéro copié). Le 🔗 fait le même
« Link » que sur Shopify. Le numéro de commande Etsy est lu dans les liens de la page.

## Lien live Shopify → Chit Chats (écran partagé)

Deux onglets côte à côte : une commande Shopify et Chit Chats.

1. Sur la commande Shopify, clique **🔗 Link** (dans le bouton accroché au bord droit).
2. Dans l'onglet Chit Chats, un bouton **🔗 Link** apparaît en bas : clique-le. Cette barre se
   déplace n'importe où avec la poignée ⋮⋮ (position mémorisée ; double-clic sur ⋮⋮ = retour en bas).
3. C'est **Live** : chaque commande que tu ouvres dans Shopify s'affiche automatiquement dans
   l'onglet Chit Chats (sens unique, Shopify → Chit Chats).
4. **Stop live** (sur Shopify) coupe le lien. Fermer un des deux onglets le coupe aussi.

Il faut le Client ID Chit Chats dans les réglages de l'extension.

Si l'app a détecté que l'**import de cette commande dans Chit Chats a échoué**, la barre en bas de
l'onglet Chit Chats devient rouge et dit pourquoi (ex. « line_items required ») : c'est pour ça que
la commande n'apparaît pas dans Chit Chats. Une commande pas encore importée est signalée en orange.

La boîte « 📦 J'ai packé » garde ton choix : ouverte, elle se rouvre toute seule sur chaque
commande (et après un rechargement) ; fermée (bouton ▴ ou ×), elle reste fermée.

Quand le bac d'une commande est **déjà commencé**, une petite bulle apparaît sous la barre :
« 📦 Bac commencé · Alex · 2/3 » (orange, le survol liste ce qui manque et pourquoi) ou
« ✓ Bac complet · Alex » (vert). Un clic dessus ouvre la boîte du bac.

## Mode démo (pour tester sans toucher aux vraies boutiques)

Réglages de l'extension (clic droit sur l'icône → Options) → **Mode démo (tests)** : deux fausses
pages servies par l'extension elle-même, signalées par un bandeau « DÉMO ».

- **Fausse admin Shopify** (`demo/shopify/orders/…`) : liste de commandes (#1001, #1002, #1003) et
  navigation « une seule page » comme Shopify : l'URL change d'abord, le numéro affiché suit
  600 ms plus tard. On peut aussi saisir l'**ID et le numéro d'une vraie commande de l'app** pour
  essayer « Ouvert sur Shopify » et la boîte « J'ai packé » avec ses vraies pièces (ne pas
  recharger la page ensuite : cette commande n'existe que dans l'onglet).
- **Faux Chit Chats** (`demo/chitchats/`) : recherche d'expédition (`?q=` = numéro de commande).

Le vrai code de l'extension (`background.js`, `content.js`, `pack-panel.js`,
`content-chitchats.js`) y tourne tel quel : bouton « Chit Chats #…» (ouvre le faux Chit Chats,
sans Client ID nécessaire), « J'ai packé », et **lien live** — ouvrir les deux pages, « 🔗 Link »
sur Shopify puis sur Chit Chats, puis « Commande suivante » : le faux Chit Chats suit.

Détail technique : les pages d'extension cachent leur adresse aux requêtes d'onglets (pas de
permission « tabs », qu'on ne veut pas demander), donc le service worker repère les pages de démo
grâce à l'adresse que leur script lui envoie.
