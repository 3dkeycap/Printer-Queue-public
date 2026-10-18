import { getDb, nowIso } from '../db/index.js';

const normalise = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const listColors = ({ activeOnly = false } = {}) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT key, name, hex, aliases, stock_grams, low_stock_grams, sort_order, is_active
       FROM resin_colors ${activeOnly ? 'WHERE is_active = 1' : ''}
       ORDER BY sort_order, name`,
    )
    .all();
  return rows.map((row) => ({
    ...row,
    aliases: JSON.parse(row.aliases || '[]'),
    is_active: Boolean(row.is_active),
  }));
};

export const getColor = (key) => listColors().find((c) => c.key === key) ?? null;

const NYLON_WORD = /(^|[^a-z0-9])nylon([^a-z0-9]|$)/;

const findBestColorMatch = (haystack, colors) => {
  let best = { key: 'unassigned', score: 0 };
  for (const color of colors) {
    if (color.key === 'unassigned') continue;
    const candidates = [color.key, color.name, ...(color.aliases ?? [])];
    for (const candidate of candidates) {
      const needle = normalise(candidate);
      if (!needle) continue;
      const matched =
        haystack === needle ||
        new RegExp(`(^|[^a-z0-9])${needle.replace(/ /g, '[ -]?')}([^a-z0-9]|$)`).test(haystack);
      if (matched && needle.length > best.score) {
        best = { key: color.key, score: needle.length };
      }
    }
  }
  return best;
};

/**
 * Maps free-text hints coming from a marketplace (variant title, SKU suffix,
 * personalisation field...) to a resin colour of the catalogue.
 * Longest alias wins so "bleu nuit" beats "bleu".
 *
 * Le nylon est un procédé d'impression totalement différent (FDM/SLS), jamais
 * de la résine : une variante « Nylon Grey » n'est donc jamais confondue avec
 * « Grey ». Elle est automatiquement dirigée vers une entrée dédiée
 * (`nylon-grey`), créée à la volée au premier passage si besoin, pour rester
 * visible et filtrable à part du reste de la file de production résine.
 */
export const resolveColorKey = (hints = [], colors = listColors()) => {
  const haystack = hints.filter(Boolean).map(normalise).join(' | ');
  if (!haystack) return 'unassigned';

  const match = findBestColorMatch(haystack, colors);
  if (!NYLON_WORD.test(haystack) || match.key.startsWith('nylon')) return match.key;

  const baseKey = match.key === 'unassigned' ? null : match.key;
  const nylonKey = baseKey ? `nylon-${baseKey}` : 'nylon';
  if (colors.some((color) => color.key === nylonKey)) return nylonKey;

  const baseColor = baseKey ? colors.find((color) => color.key === baseKey) : null;
  const created = createColor({
    key: nylonKey,
    name: baseColor ? `Nylon ${baseColor.name}` : 'Nylon',
    hex: baseColor?.hex ?? '#8C8579',
    aliases: baseColor
      ? [`Nylon ${baseColor.name}`, ...baseColor.aliases.map((alias) => `Nylon ${alias}`)]
      : ['Nylon'],
    // regroupées après les résines, jamais mélangées avec la couleur de base
    sort_order: 900 + (baseColor?.sort_order ?? 0),
  });
  return created?.key ?? nylonKey;
};

/**
 * Règles « nom d'article => couleur » (réglage production.colorRules).
 * Utile quand le nom de la variante désigne autre chose que la résine :
 * « Ore Keycap » en variante « Gold » est un nylon gris, pas de la résine or.
 * Une règle s'applique si le titre, la variante ou le SKU CONTIENT le mot-clé
 * (mots entiers, sans accents ni casse) ; la première qui correspond gagne.
 * La couleur visée est résolue comme n'importe quel texte de commande :
 * « Nylon Grey » mène à `nylon-grey`, « Noir » à `black`.
 */
export const parseColorRules = (lines = []) =>
  [].concat(lines ?? [])
    .map((line) => {
      const index = String(line).indexOf('=>');
      if (index < 0) return null;
      const keyword = normalise(String(line).slice(0, index));
      const target = String(line).slice(index + 2).trim();
      return keyword && target ? { keyword, target } : null;
    })
    .filter(Boolean);

const ruleMatches = (keyword, texts) => {
  const pattern = new RegExp(`(^|[^a-z0-9])${keyword.replace(/ /g, '[ -]?')}([^a-z0-9]|$)`);
  return texts.some((text) => pattern.test(normalise(text)));
};

export const findColorRule = (texts, rules) =>
  rules.find((rule) => ruleMatches(rule.keyword, texts.filter(Boolean))) ?? null;

/** Couleur d'une ligne de commande : règles d'abord, détection par indices ensuite. */
export const resolveItemColorKey = (item, colors = listColors(), rules = []) => {
  const rule = findColorRule([item.title, item.variantTitle, item.sku], rules);
  if (rule) return resolveColorKey([rule.target], colors);
  return resolveColorKey([item.variantTitle, item.sku, item.title, ...(item.colorHints ?? [])], colors);
};

/**
 * Rattrape les pièces déjà importées avec la mauvaise couleur quand une règle
 * est ajoutée. Même prudence que pour les suppléments : une pièce dont un
 * humain s'est occupé (statut, couleur ou tags modifiés...) n'est jamais touchée.
 */
export const applyColorRules = (rules) => {
  if (!rules.length) return { recolored: 0 };
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.order_item_id, p.color_key, i.title, i.variant_title, i.sku
         FROM parts p
         JOIN order_items i ON i.id = p.order_item_id
         JOIN orders o ON o.id = p.order_id
        WHERE o.source <> 'manual'
          AND p.status = 'TO_PRINT'
          AND p.updated_at = p.created_at
          AND NOT EXISTS (SELECT 1 FROM part_events e WHERE e.part_id = p.id AND e.actor <> 'worker')`,
    )
    .all();

  const colors = listColors();
  const setPart = db.prepare('UPDATE parts SET color_key = ? WHERE id = ?');
  const setItem = db.prepare('UPDATE order_items SET color_key = ? WHERE id = ?');
  let recolored = 0;
  db.transaction(() => {
    for (const row of rows) {
      const rule = findColorRule([row.title, row.variant_title, row.sku], rules);
      if (!rule) continue;
      const key = resolveColorKey([rule.target], colors);
      if (key === row.color_key || key === 'unassigned') continue;
      setPart.run(key, row.id);
      setItem.run(key, row.order_item_id);
      recolored += 1;
    }
  })();
  return { recolored };
};

export const updateColor = (key, patch) => {
  const db = getDb();
  const existing = getColor(key);
  if (!existing) return null;

  const fields = [];
  const values = {};
  for (const field of ['name', 'hex', 'stock_grams', 'low_stock_grams', 'sort_order']) {
    if (patch[field] !== undefined) {
      fields.push(`${field} = @${field}`);
      values[field] = patch[field];
    }
  }
  if (patch.is_active !== undefined) {
    fields.push('is_active = @is_active');
    values.is_active = patch.is_active ? 1 : 0;
  }
  if (patch.aliases !== undefined) {
    fields.push('aliases = @aliases');
    values.aliases = JSON.stringify(patch.aliases);
  }
  if (!fields.length) return existing;

  db.prepare(
    `UPDATE resin_colors SET ${fields.join(', ')}, updated_at = @updated_at WHERE key = @key`,
  ).run({ ...values, key, updated_at: nowIso() });

  return getColor(key);
};

export const createColor = ({ key, name, hex = '#8C8579', aliases = [], sort_order = 200 }) => {
  const db = getDb();
  const slug = normalise(key || name).replace(/ /g, '-');
  if (!slug) return null;
  db.prepare(
    `INSERT INTO resin_colors (key, name, hex, aliases, sort_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET name = excluded.name, hex = excluded.hex`,
  ).run(slug, name || slug, hex, JSON.stringify(aliases), sort_order, nowIso());
  return getColor(slug);
};

export const deleteColor = (key) => {
  const db = getDb();
  if (key === 'unassigned') return { deleted: null, reason: 'La couleur par défaut ne peut pas être supprimée' };
  const used = db.prepare('SELECT COUNT(*) AS n FROM parts WHERE color_key = ?').get(key).n;
  if (used) {
    // on ne casse pas l'historique : la couleur est simplement désactivée
    updateColor(key, { is_active: false });
    return { deleted: null, deactivated: key, parts: used };
  }
  db.prepare('DELETE FROM resin_colors WHERE key = ?').run(key);
  return { deleted: key };
};
