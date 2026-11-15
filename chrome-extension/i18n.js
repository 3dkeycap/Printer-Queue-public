/*
 * Traduction de l'interface (français -> English, Español, Filipino), PARTAGÉE par l'app et l'extension Chrome :
 * `public/js/i18n.js` et `chrome-extension/i18n.js` sont le même fichier (tests/i18n.test.js le vérifie).
 *
 * Pourquoi traduire « ce qui est affiché » plutôt que chaque écran : l'interface est écrite en français partout (cartes,
 * fiche, kiosque, inventaire, extension…). Le traducteur regarde les textes affichés (et les title / placeholder) et
 * remplace ceux qu'il connaît EXACTEMENT, plus quelques modèles avec des nombres (« il y a 3 min »). Ce qu'il ne connaît
 * pas reste tel quel : jamais de traduction des noms de produits, des clients, des notes ou des tags tapés par l'équipe.
 * Le texte français d'origine est gardé : changer de langue (ou revenir au français) se fait sans recharger.
 *
 * Langue : celle de la personne choisie (Réglages → Équipe, sélecteur en haut à droite), mémorisée sur l'appareil.
 */
(() => {
  if (globalThis.RQI18n) return;

  const LANGS = { fr: 'Français', en: 'English', es: 'Español', fil: 'Filipino' };

  /** [français, English, Español, Filipino] — le français est la clé, tel qu'affiché (espaces en trop ignorés). */
  const T = globalThis.RQI18nTable ?? [];

  /** Modèles avec des parties variables : [regex sur le français, en, es, fil] ($1, $2… = parties variables). */
  const P = globalThis.RQI18nPatterns ?? [];

  const LANG_KEY = 'rpq.lang';
  const squash = (text) => String(text).replace(/\s+/g, ' ').trim();
  const dict = { en: new Map(), es: new Map(), fil: new Map() };
  for (const [fr, en, es, fil] of T) {
    const key = squash(fr);
    if (en) dict.en.set(key, en);
    if (es) dict.es.set(key, es);
    if (fil) dict.fil.set(key, fil);
  }
  const patterns = P.map(([source, en, es, fil]) => ({ re: new RegExp(`^${source}$`, 'u'), en, es, fil }));

  const browserLang = () => {
    const wanted = String(globalThis.navigator?.language ?? 'fr').toLowerCase();
    if (wanted.startsWith('fil') || wanted.startsWith('tl')) return 'fil';
    if (wanted.startsWith('es')) return 'es';
    if (wanted.startsWith('en')) return 'en';
    return 'fr';
  };
  // dans l'extension Chrome, le localStorage est celui de Shopify / Etsy / Chit Chats : on n'y touche pas
  const noStorage = Boolean(globalThis.RQI18nNoStorage);
  const stored = () => {
    if (noStorage) return null;
    try {
      return globalThis.localStorage?.getItem(LANG_KEY) || null;
    } catch {
      return null;
    }
  };
  // sans choix enregistré : le français (app de l'atelier), sauf les pages de téléphone (code QR, inventaire) qui
  // prennent la langue du téléphone (RQI18nBrowserDefault) ; l'extension attend celle de la personne réglée
  let lang = LANGS[stored()] ? stored() : globalThis.RQI18nBrowserDefault && !noStorage ? browserLang() : 'fr';

  /** Traduit un texte français (exact, modèle, ou liste « a, b, c » de textes connus) ; null si inconnu. */
  const lookup = (text, to = lang, depth = 0) => {
    if (to === 'fr' || depth > 3) return null;
    const key = squash(text);
    if (!key || key.length > 600) return null;
    const hit = dict[to]?.get(key);
    if (hit) return hit;
    for (const pattern of patterns) {
      const match = pattern.re.exec(key);
      if (!match || !pattern[to]) continue;
      // une partie variable peut elle-même être un texte connu (« Passer à Imprimé », « … : code HS ×5, poids 1 g ×5 »)
      return pattern[to].replace(/\$(\d)/g, (_, index) => {
        const part = match[Number(index)] ?? '';
        return lookup(part, to, depth + 1) ?? part;
      });
    }
    if (key.includes(', ')) {
      const pieces = key.split(', ');
      const done = pieces.map((piece) => lookup(piece, to, depth + 1));
      if (done.some(Boolean)) return pieces.map((piece, index) => done[index] ?? piece).join(', ');
    }
    return null;
  };

  /** Pour le code : t('Expédié') ; renvoie le français si inconnu. */
  const t = (text) => lookup(text) ?? text;

  /* --------------------------------------------------------------- DOM */

  const SKIP = 'script, style, textarea, code, pre, [contenteditable=""], [contenteditable="true"], [data-no-i18n]';
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const originals = new WeakMap(); // nœud texte -> français d'origine
  const attrOriginals = new WeakMap(); // élément -> { attribut: français }
  const written = new WeakMap(); // nœud texte -> dernier texte écrit par NOUS (pour reconnaître nos propres changements)
  const roots = new Map(); // racine observée -> sélecteur limitant ce qu'on traduit (ou null = tout)
  let scopeNow = null;

  const skipped = (node) => {
    const parent = node.nodeType === 1 ? node : node.parentElement;
    if (!parent || parent.closest?.(SKIP)) return true;
    // extension : seulement nos propres éléments, jamais la page de Shopify / Etsy / Chit Chats
    return Boolean(scopeNow && !parent.closest?.(scopeNow));
  };

  const translateTextNode = (node) => {
    if (skipped(node)) return;
    const current = node.data;
    // le texte a changé sans nous : c'est le nouveau français d'origine
    if (written.get(node) !== current) originals.set(node, current);
    const source = originals.get(node) ?? current;
    if (!/[A-Za-zÀ-ÿ]/.test(source)) return;
    const translated = lookup(source);
    const next = translated ? source.replace(squash(source), translated) : source;
    if (next !== current) {
      written.set(node, next);
      node.data = next;
    } else written.set(node, current);
  };

  const translateAttrs = (element) => {
    // les attributs d'un champ (placeholder d'un textarea…) se traduisent, pas ce qui est tapé dedans
    if (element.closest?.('[data-no-i18n]') || (scopeNow && !element.closest?.(scopeNow))) return;
    const saved = attrOriginals.get(element) ?? {};
    for (const name of ATTRS) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name);
      const mine = saved[`${name}:mine`];
      if (value !== mine) saved[name] = value;
      const source = saved[name];
      const translated = lookup(source);
      const next = translated ?? source;
      saved[`${name}:mine`] = next;
      if (next !== value) element.setAttribute(name, next);
    }
    // boutons <input type=submit|button value="…">
    if (element instanceof HTMLInputElement && ['submit', 'button'].includes(element.type) && element.value) {
      const mine = saved['value:mine'];
      if (element.value !== mine) saved.value = element.value;
      const next = lookup(saved.value) ?? saved.value;
      saved['value:mine'] = next;
      if (next !== element.value) element.value = next;
    }
    attrOriginals.set(element, saved);
  };

  const translateTree = (root, scope = scopeNow) => {
    if (!root) return;
    scopeNow = scope;
    if (root.nodeType === 3) return translateTextNode(root);
    if (root.nodeType === 1) translateAttrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) translateTextNode(node);
      else translateAttrs(node);
    }
  };

  /**
   * Traduit `root` (document, élément ou shadow root) et suit ses changements. `scope` (sélecteur) limite la traduction
   * aux éléments qui y correspondent (l'extension : '[data-resin-queue]').
   */
  const observe = (root = document.documentElement, { scope = null } = {}) => {
    if (!root || roots.has(root)) return;
    roots.set(root, scope);
    translateTree(root, scope);
    new MutationObserver((mutations) => {
      if (lang === 'fr' && !mutations.some((m) => m.type === 'characterData' && written.has(m.target))) return;
      scopeNow = scope;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        else if (mutation.type === 'attributes') translateAttrs(mutation.target);
        else mutation.addedNodes.forEach((node) => translateTree(node, scope));
      }
    }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'value'] });
  };

  const listeners = new Set();
  const setLang = (next, { remember = true } = {}) => {
    const wanted = LANGS[next] ? next : 'fr';
    if (remember && !noStorage) {
      try {
        globalThis.localStorage?.setItem(LANG_KEY, wanted);
      } catch {
        /* stockage indisponible : la langue vaut pour cette page */
      }
    }
    if (wanted === lang) return;
    lang = wanted;
    if (globalThis.document?.documentElement) document.documentElement.lang = lang === 'fil' ? 'fil' : lang;
    roots.forEach((scope, root) => translateTree(root, scope));
    listeners.forEach((listener) => listener(lang));
  };

  globalThis.RQI18n = {
    LANGS,
    t,
    lookup,
    observe,
    setLang,
    getLang: () => lang,
    browserLang,
    onChange: (listener) => listeners.add(listener),
    size: () => ({ en: dict.en.size, es: dict.es.size, fil: dict.fil.size, patterns: patterns.length }),
  };
})();
