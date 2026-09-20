import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('purge-mock');
const { getDb, getSetting, closeDb, nowIso } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { ingestOrder } = await import('../src/domain/ingest.js');

const SCHEMA_PATH = fileURLToPath(new URL('../src/db/schema.sql', import.meta.url));

/**
 * Reproduit exactement ce que l'ancien générateur de démo (mode
 * `INTEGRATION_MODE=mock`, retiré depuis) écrivait en base avant la mise à
 * jour qui l'a supprimé : une commande dont le payload brut porte
 * `"mock": true` - le marqueur que le nettoyage automatique recherche.
 */
const insertLegacyMockOrder = (db) => {
  const ts = nowIso();
  // requis par la contrainte de clé étrangère parts.color_key -> resin_colors.key ;
  // normalement posé par le seed des résines, qu'on ne déclenche pas ici exprès.
  db.prepare(
    `INSERT OR IGNORE INTO resin_colors (key, name, hex, aliases, sort_order) VALUES ('unassigned', 'Non assigné', '#7C7364', '[]', 0)`,
  ).run();
  const order = db
    .prepare(
      `INSERT INTO orders (source, external_id, order_number, customer_name, placed_at, raw_payload, created_at, updated_at)
       VALUES ('shopify', '99001', '#1201', 'Marie Kowalski', ?, ?, ?, ?)`,
    )
    .run(ts, JSON.stringify({ mock: true, source: 'shopify', ref: 12 }), ts, ts);

  const item = db
    .prepare(
      `INSERT INTO order_items (order_id, external_id, title, quantity, raw_payload, created_at, updated_at)
       VALUES (?, 'mock-li-1', 'Switch opener - résine', 2, ?, ?, ?)`,
    )
    .run(order.lastInsertRowid, JSON.stringify({ mock: true, color: 'Blanc' }), ts, ts);

  for (let unit = 1; unit <= 2; unit += 1) {
    db.prepare(
      `INSERT INTO parts (order_id, order_item_id, unit_index, name, status, status_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'Switch opener - résine', 'TO_PRINT', ?, ?, ?)`,
    ).run(order.lastInsertRowid, item.lastInsertRowid, unit, ts, ts, ts);
  }

  return Number(order.lastInsertRowid);
};

describe('nettoyage automatique des anciennes données de démo', () => {
  after(() => closeDb());

  it('purge les commandes marquées "mock": true et laisse les vraies commandes intactes', () => {
    // Base "ancienne" : schéma déjà appliqué par une version antérieure du
    // code, avant que le nettoyage automatique n'existe. On applique donc le
    // schéma directement, sans passer par migrate(), pour insérer la donnée
    // de démo comme si elle datait d'avant cette mise à jour.
    const db = getDb();
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const mockOrderId = insertLegacyMockOrder(db);

    assert.equal(getSetting('internal.mockDataPurged'), null, 'le drapeau ne doit pas exister avant la 1ère migration');

    // Première migration après la mise à jour : c'est là que le nettoyage doit agir.
    migrate();

    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM orders WHERE id = ?').get(mockOrderId).n,
      0,
      'la commande de démo doit avoir disparu',
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM parts WHERE order_id = ?').get(mockOrderId).n,
      0,
      'ses pièces doivent disparaître avec elle (cascade)',
    );
    assert.equal(getSetting('internal.mockDataPurged'), '1');
  });

  it('ne touche jamais une vraie commande Shopify/Etsy (aucun marqueur mock)', () => {
    const result = ingestOrder(makeOrder({ externalId: 'real-9001', orderNumber: '#9001' }));
    assert.equal(
      getDb().prepare('SELECT COUNT(*) AS n FROM orders WHERE id = ?').get(result.orderId).n,
      1,
      'la vraie commande doit être présente avant toute nouvelle migration',
    );

    migrate(); // deuxième migration : le drapeau est déjà posé, donc no-op

    assert.equal(
      getDb().prepare('SELECT COUNT(*) AS n FROM orders WHERE id = ?').get(result.orderId).n,
      1,
      'une vraie commande ne doit jamais être supprimée par le nettoyage',
    );
  });

  it('ne supprime rien deux fois : idempotent une fois le drapeau posé', () => {
    const db = getDb();
    const before = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
    migrate();
    migrate();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, before);
  });
});
