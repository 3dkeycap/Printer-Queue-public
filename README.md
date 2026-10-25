# 3D Keycap Lab

File d'impression d'une ferme d'imprimantes 3D résine. Elle importe les commandes
**Shopify** et **Etsy** toutes les 5 minutes, crée **une carte par pièce physique** et les
suit de « À imprimer » à « Imprimé », groupées par couleur de résine, sur la page **Resin Queue**.

## Démarrer

```bash
git clone https://github.com/3dkeycap/Printer-Queue-public.git
cd Printer-Queue-public
docker compose up -d --build        # puis http://localhost:8080
```

Aucun fichier `.env` nécessaire : clés Shopify / Etsy / Chit Chats, listes et résines se
règlent dans **Réglages** (stockés dans la base).

- **Adresse de l'atelier** : `http://3dkeycap.local/`.
- **iPad / écran d'atelier** : `http://<ip>:8080/kiosk` (toujours en mode Simple, plein écran).
- **Mettre à jour** : Réglages → Mises à jour → *Mettre à jour* (sauvegarde la base, installe,
  revient en arrière si ça ne démarre pas). Détails dans la documentation technique.
- **Les données** vivent dans le volume Docker `rpq-data`. ⚠ Ne jamais lancer
  `docker compose down -v` : le `-v` supprime la base et ses sauvegardes.

## Développer

```bash
npm install
npm test                            # node:test, aucune dépendance externe
SCHEDULER_INLINE=true npm start     # app + synchro dans un seul processus
```

## Documentation

| Document | Pour qui |
| --- | --- |
| [docs/guide-atelier.md](docs/guide-atelier.md) | Les gens de l'atelier : utiliser l'outil au quotidien |
| [docs/technique.md](docs/technique.md) | Architecture, intégrations, API, base de données, exploitation |
| [CHANGELOG.md](CHANGELOG.md) | Ce qui a changé, version par version |
| [CLAUDE.md](CLAUDE.md) | Règles du projet (pour qui modifie le code, humain ou assistant) |
| [chrome-extension/](chrome-extension/README.md) | Extension Chrome « Ouvert sur Shopify » |
