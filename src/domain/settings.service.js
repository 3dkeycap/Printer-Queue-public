import { config } from '../config.js';
import { getDb, nowIso } from '../db/index.js';
import { badRequest } from '../lib/errors.js';

/**
 * Tous les réglages de l'application vivent ici : ils sont stockés en base
 * (table `settings`) et pilotés depuis la page « Intégrations ».
 * Les variables d'environnement ne servent plus que de valeur initiale, ce qui
 * permet de tout configurer sans redéployer.
 */
export const DEFINITIONS = [
  // --- Shopify (OAuth 2.0) -------------------------------------------------
  // Shopify exige maintenant une app OAuth (le token d'accès direct des
  // anciennes « apps privées » n'est plus proposé aux nouvelles boutiques).
  // Client ID / Client secret viennent du Partner Dashboard ; le secret sert
  // aussi à vérifier la signature HMAC des webhooks Shopify.
  { key: 'shopify.shopDomain', group: 'shopify', label: 'Domaine de la boutique', type: 'text', placeholder: 'ma-boutique.myshopify.com', fallback: () => config.shopify.shopDomain },
  {
    key: 'app.publicUrl',
    group: 'shopify',
    label: 'URL publique de ce serveur',
    type: 'text',
    placeholder: 'https://queue.3dkeycap.com',
    hint: "Nécessaire pour l'OAuth Shopify : à enregistrer telle quelle + « /api/integrations/shopify/oauth/callback » comme redirect URL dans le Partner Dashboard.",
    fallback: () => config.appUrl,
  },
  { key: 'shopify.apiKey', group: 'shopify', label: "Client ID (API key)", type: 'text', hint: 'Depuis le Partner Dashboard → votre app → Client credentials.', fallback: () => config.shopify.apiKey },
  { key: 'shopify.apiSecret', group: 'shopify', label: 'Client secret', type: 'secret', hint: 'Sert aussi à vérifier la signature des webhooks Shopify.', fallback: () => config.shopify.apiSecret },
  { key: 'shopify.scopes', group: 'shopify', label: 'Scopes OAuth', type: 'text', fallback: () => config.shopify.scopes },
  {
    key: 'shopify.accessToken',
    group: 'shopify',
    label: "Token d'accès",
    type: 'secret',
    hint: "Rempli automatiquement par « Connecter via OAuth » ci-dessous. Peut aussi être collé à la main pour une ancienne app privée.",
    fallback: () => config.shopify.accessToken,
  },
  { key: 'shopify.apiVersion', group: 'shopify', label: 'Version API', type: 'text', fallback: () => config.shopify.apiVersion },
  { key: 'shopify.enabled', group: 'shopify', label: 'Synchronisation active', type: 'boolean', fallback: () => true },

  // --- Etsy ---------------------------------------------------------------
  // --- Etsy (OAuth 2.0 + PKCE, obligatoire sur l'Open API v3) --------------
  { key: 'etsy.shopId', group: 'etsy', label: 'Shop ID', type: 'text', hint: 'Visible dans l\'URL de ton tableau de bord Etsy (Shop Manager).', fallback: () => config.etsy.shopId },
  { key: 'etsy.apiKey', group: 'etsy', label: 'Clé API (Keystring)', type: 'secret', hint: 'Aussi utilisée comme Client ID pour la connexion OAuth ci-dessous.', fallback: () => config.etsy.apiKey },
  { key: 'etsy.scopes', group: 'etsy', label: 'Scopes OAuth', type: 'text', fallback: () => 'transactions_r' },
  {
    key: 'etsy.accessToken',
    group: 'etsy',
    label: "Token d'accès",
    type: 'secret',
    hint: 'Rempli et renouvelé automatiquement par « Connecter via OAuth » ci-dessous (expire toutes les heures chez Etsy, sans action de ta part).',
    fallback: () => config.etsy.accessToken,
  },
  { key: 'etsy.enabled', group: 'etsy', label: 'Synchronisation active', type: 'boolean', fallback: () => true },

  // --- Chit Chats ---------------------------------------------------------
  { key: 'chitchats.clientId', group: 'chitchats', label: 'Client ID', type: 'text', fallback: () => config.chitchats.clientId },
  { key: 'chitchats.accessToken', group: 'chitchats', label: "Token d'accès", type: 'secret', fallback: () => config.chitchats.accessToken },
  { key: 'chitchats.apiBase', group: 'chitchats', label: 'URL de l\'API', type: 'text', fallback: () => config.chitchats.apiBase },
  { key: 'chitchats.webhookSecret', group: 'chitchats', label: 'Secret webhook (X-Webhook-Secret)', type: 'secret', fallback: () => config.chitchats.webhookSecret },
  { key: 'chitchats.shipAllParts', group: 'chitchats', label: 'Expédier toutes les pièces du colis', type: 'boolean', hint: 'Sinon, seules les pièces déjà imprimées passent à Expédié.', fallback: () => config.chitchats.shipAllParts },

  // --- Planification ------------------------------------------------------
  { key: 'schedule.syncCron', group: 'schedule', label: 'Cron des commandes', type: 'text', hint: 'Par défaut toutes les 5 minutes.', fallback: () => config.jobs.syncCron },
  { key: 'schedule.shipmentCron', group: 'schedule', label: 'Cron des expéditions', type: 'text', fallback: () => config.jobs.shipmentCron },
  { key: 'schedule.lookbackDays', group: 'schedule', label: 'Fenêtre de rattrapage (jours)', type: 'number', fallback: () => config.integrations.lookbackDays },

  // --- Mises à jour (lues par le service « updater », voir updater.service) -
  {
    key: 'update.githubToken',
    group: 'update',
    label: 'Token GitHub (lecture seule)',
    type: 'secret',
    hint: 'Nécessaire si le dépôt est privé. Fine-grained token limité à ce dépôt, permission « Contents : Read-only ».',
    fallback: () => process.env.GITHUB_TOKEN || '',
  },
  { key: 'update.githubRepo', group: 'update', label: 'Dépôt GitHub', type: 'text', placeholder: '3dkeycap/Printer-Queue', hint: 'owner/dépôt. Vide = le dépôt d\'origine du clone.', fallback: () => process.env.GITHUB_REPO || '3dkeycap/Printer-Queue' },
  { key: 'update.branch', group: 'update', label: 'Branche suivie', type: 'text', placeholder: 'main', hint: 'Vide = la branche actuellement installée.', fallback: () => process.env.UPDATE_BRANCH || '' },
  { key: 'update.autoEnabled', group: 'update', label: 'Mise à jour automatique', type: 'boolean', hint: 'Installe toute seule les nouvelles versions (sauvegarde + retour arrière si échec).', fallback: () => true },
  { key: 'update.intervalMinutes', group: 'update', label: 'Vérifier toutes les (minutes)', type: 'number', fallback: () => 60 },

  // --- Production ---------------------------------------------------------
  { key: 'production.uvOptions', group: 'production', label: 'Options UV', type: 'list', hint: 'Une valeur par ligne. Affichée sur chaque carte.', fallback: () => ['Standard', 'A', 'B', 'C'] },
  { key: 'production.commentOptions', group: 'production', label: 'Commentaires prédéfinis', type: 'list', hint: 'Liste déroulante disponible sur chaque pièce.', fallback: () => ['Réimpression', 'Support à revoir', 'Attente client', 'Pièce cassée', 'Prioritaire', 'Échantillon'] },
  { key: 'production.printerOptions', group: 'production', label: 'Imprimantes', type: 'list', hint: 'Une valeur par ligne. Liste déroulante pour assigner une pièce à une imprimante.', fallback: () => ['Mars 4 Ultra #1', 'Mars 4 Ultra #2', 'Mars 4 Ultra #3', 'Mars 4 Ultra #4'] },
  { key: 'production.defaultUv', group: 'production', label: 'Valeur UV par défaut', type: 'text', hint: 'Laisser vide pour ne rien pré-remplir.', fallback: () => '' },
  {
    key: 'production.nonPrintableKeywords',
    group: 'production',
    label: 'Suppléments à ne pas imprimer',
    type: 'list',
    hint: "Une valeur par ligne. Si le titre d'une ligne de commande contient un de ces mots (Etsy/Shopify), c'est un supplément/upsell, pas un objet : aucune pièce n'est créée pour cette ligne (la commande, elle, est conservée normalement).",
    fallback: () => ['Custom UV Printed Legends', 'Color Variety Pack'],
  },
  {
    key: 'production.uvTriggerKeywords',
    group: 'production',
    label: 'Suppléments qui indiquent un besoin UV',
    type: 'list',
    hint: "Une valeur par ligne, parmi les suppléments ci-dessus. Si un de ces titres apparaît dans une commande, les vraies pièces de cette même commande reçoivent automatiquement la valeur UV définie juste en dessous.",
    fallback: () => ['Custom UV Printed Legends'],
  },
  {
    key: 'production.uvAutoValue',
    group: 'production',
    label: 'Valeur UV appliquée automatiquement',
    type: 'text',
    hint: 'Doit correspondre à une des options UV définies plus haut (ex. « oui »).',
    fallback: () => 'oui',
  },
];

const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition]));

const parse = (definition, raw) => {
  if (raw === null || raw === undefined) return definition.fallback();
  switch (definition.type) {
    case 'boolean':
      return raw === '1' || raw === 'true';
    case 'number': {
      const value = Number(raw);
      return Number.isFinite(value) ? value : definition.fallback();
    }
    case 'list':
      try {
        const value = JSON.parse(raw);
        return Array.isArray(value) ? value : definition.fallback();
      } catch {
        return definition.fallback();
      }
    default:
      return raw;
  }
};

const serialize = (definition, value) => {
  switch (definition.type) {
    case 'boolean':
      return value ? '1' : '0';
    case 'number':
      return String(Number(value) || 0);
    case 'list':
      return JSON.stringify(
        [].concat(value ?? []).map((item) => String(item).trim()).filter(Boolean),
      );
    default:
      return value === null || value === undefined ? '' : String(value).trim();
  }
};

/** Tous les réglages résolus (base > environnement > défaut). */
export const getSettings = () => {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const settings = {};
  for (const definition of DEFINITIONS) {
    settings[definition.key] = parse(definition, stored.get(definition.key));
  }
  return settings;
};

export const getSetting = (key) => {
  const definition = BY_KEY.get(key);
  if (!definition) throw badRequest(`Réglage inconnu « ${key} »`);
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return parse(definition, row?.value);
};

/** Vue destinée au front : les secrets ne sortent jamais de la base. */
export const describeSettings = () => {
  const values = getSettings();
  return DEFINITIONS.map((definition) => {
    const value = values[definition.key];
    return {
      key: definition.key,
      group: definition.group,
      label: definition.label,
      type: definition.type,
      hint: definition.hint ?? null,
      placeholder: definition.placeholder ?? null,
      value: definition.type === 'secret' ? '' : value,
      configured: definition.type === 'secret' ? Boolean(value) : undefined,
    };
  });
};

/**
 * Enregistre un lot de réglages.
 * Un secret reçu vide est ignoré (on ne veut pas effacer une clé par erreur) ;
 * envoyer `null` l'efface explicitement.
 */
export const updateSettings = (patch = {}) => {
  const db = getDb();
  const ts = nowIso();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );

  const applied = [];
  const run = db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      const definition = BY_KEY.get(key);
      if (!definition) throw badRequest(`Réglage inconnu « ${key} »`);
      if (definition.type === 'secret' && value === '') continue;
      upsert.run(key, value === null ? '' : serialize(definition, value), ts);
      applied.push(key);
    }
  });
  run();

  return { applied, settings: describeSettings() };
};

/** État des connecteurs, affiché dans la page Intégrations. */
export const connectorStatus = () => {
  const s = getSettings();
  return {
    shopify: {
      configured: Boolean(s['shopify.shopDomain'] && s['shopify.accessToken']),
      enabled: s['shopify.enabled'],
    },
    etsy: {
      configured: Boolean(s['etsy.shopId'] && s['etsy.apiKey'] && s['etsy.accessToken']),
      enabled: s['etsy.enabled'],
    },
    chitchats: {
      configured: Boolean(s['chitchats.clientId'] && s['chitchats.accessToken']),
      enabled: true,
    },
  };
};
