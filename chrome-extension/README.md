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

## Lien live Shopify → Chit Chats (écran partagé)

Deux onglets côte à côte : une commande Shopify et Chit Chats.

1. Sur la commande Shopify, clique **🔗 Link** (dans le bouton accroché au bord droit).
2. Dans l'onglet Chit Chats, un bouton **🔗 Link** apparaît en bas : clique-le.
3. C'est **Live** : chaque commande que tu ouvres dans Shopify s'affiche automatiquement dans
   l'onglet Chit Chats (sens unique, Shopify → Chit Chats).
4. **Stop live** (sur Shopify) coupe le lien. Fermer un des deux onglets le coupe aussi.

Il faut le Client ID Chit Chats dans les réglages de l'extension.
