# Extension Chrome Resin Queue (Shopify → Chit Chats)

Quand tu ouvres une commande dans l'admin Shopify, l'extension prévient l'app :

- dans « À imprimer », les cartes de cette commande affichent **Ouvert sur Shopify** (avec ton nom)
  et un bouton **Ouvrir sur Chit Chats** ;
- sur la page Shopify, un petit panneau en bas à droite confirme et propose le même bouton.

« Ouvrir sur Chit Chats » ouvre la page d'expédition Chit Chats (adresse réglable dans
Réglages → Boutiques → Chit Chats, `{order}` = numéro de commande) **et copie le numéro de commande**
dans le presse-papiers : si Chit Chats ne le pré-remplit pas, il suffit de le coller.

Le marquage disparaît tout seul quand :
1. la même page est ouverte depuis plus de **30 minutes** ;
2. tu **changes de page** (autre commande, liste...) ou **fermes l'onglet** ;
3. l'app n'a plus de nouvelles depuis 90 s (navigateur fermé, ordinateur en veille).

## Installation (une fois par ordinateur)

1. Récupère ce dossier `chrome-extension` (copie du dépôt, ou « Download ZIP » sur GitHub puis décompresser).
2. Dans Chrome : `chrome://extensions` → active **Mode développeur** (en haut à droite).
3. **Charger l'extension non empaquetée** → choisis le dossier `chrome-extension`.
4. Clique l'icône de l'extension (pièce de puzzle → Resin Queue) : renseigne l'adresse de l'app
   (ex. `http://192.168.1.50:8080`), ton nom, et le mot de passe du dashboard s'il y en a un.
   **Enregistrer et tester** doit afficher « connexion à l'app OK ».
