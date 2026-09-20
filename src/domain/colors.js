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
