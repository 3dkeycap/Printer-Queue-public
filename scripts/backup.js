/**
 * Sauvegarde manuelle de la base SQLite (même volume, rotation automatique).
 *
 *   docker compose exec app node scripts/backup.js            # sauvegarder
 *   docker compose exec app node scripts/backup.js --list     # lister
 *   docker compose exec app node scripts/backup.js --reason pre-update
 *
 * La dernière ligne de sortie est le chemin du fichier créé (utilisé par
 * scripts/update.sh pour en garder une copie hors du volume Docker).
 */
import { backupDatabase, listBackups } from '../src/db/backup.js';
import { closeDb } from '../src/db/index.js';

const args = process.argv.slice(2);

if (args.includes('--list')) {
  for (const backup of listBackups()) {
    console.log(`${backup.createdAt}  ${(backup.size / 1024).toFixed(0).padStart(8)} Ko  ${backup.name}`);
  }
} else {
  const index = args.indexOf('--reason');
  const reason = index >= 0 ? args[index + 1] : 'manual';
  const { file } = backupDatabase({ reason });
  console.log(file);
}

closeDb();
