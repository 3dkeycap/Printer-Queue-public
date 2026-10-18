/**
 * Journal du navigateur pour les signalements de bug : erreurs JS, warnings,
 * requêtes vers l'API (méthode, adresse, statut, durée) et changements de vue.
 * Les 300 dernières entrées restent en mémoire, rien n'est envoyé tant que
 * personne ne clique la coccinelle.
 */
const MAX = 300;
const entries = [];

export const logEvent = (level, msg, extra) => {
  entries.push({ ts: new Date().toISOString(), level, msg: String(msg).slice(0, 2000), ...(extra ? { extra } : {}) });
  if (entries.length > MAX) entries.shift();
};

export const clientLogs = () => [...entries];

const describe = (value) => {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

for (const level of ['error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    logEvent(level, args.map(describe).join(' '));
    original(...args);
  };
}

window.addEventListener('error', (event) => {
  logEvent('error', `${event.message} (${event.filename ?? ''}:${event.lineno ?? ''})`, event.error ? { stack: event.error.stack } : undefined);
});
window.addEventListener('unhandledrejection', (event) => {
  logEvent('error', `Promesse rejetée : ${describe(event.reason)}`);
});
window.addEventListener('hashchange', () => logEvent('info', `vue : ${location.hash || '#'}`));

// requêtes vers l'API : on garde l'adresse, le statut et la durée (pas les corps)
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const started = performance.now();
  const url = typeof input === 'string' ? input : input?.url ?? '';
  const method = (init.method ?? 'GET').toUpperCase();
  try {
    const response = await originalFetch(input, init);
    if (url.startsWith('/api')) {
      logEvent(response.ok ? 'info' : 'error', `${method} ${url} → ${response.status} (${Math.round(performance.now() - started)} ms)`);
    }
    return response;
  } catch (error) {
    if (url.startsWith('/api')) logEvent('error', `${method} ${url} → échec réseau : ${error.message}`);
    throw error;
  }
};
