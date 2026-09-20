const request = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(payload?.error ?? `Erreur ${response.status}`);
    error.status = response.status;
    error.details = payload?.details;
    throw error;
  }
  return payload;
};

const qs = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
    search.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
};

export const api = {
  meta: () => request('/api/meta'),
  parts: (params) => request(`/api/parts${qs(params)}`),
  part: (id) => request(`/api/parts/${id}`),
  createPart: (body) => request('/api/parts', { method: 'POST', body }),
  patchPart: (id, body) => request(`/api/parts/${id}`, { method: 'PATCH', body }),
  setStatus: (id, status, extra = {}) =>
    request(`/api/parts/${id}/status`, { method: 'POST', body: { status, ...extra } }),
  bulkStatus: (ids, status, extra = {}) =>
    request('/api/parts/bulk/status', { method: 'POST', body: { ids, status, ...extra } }),
  deletePart: (id) => request(`/api/parts/${id}`, { method: 'DELETE' }),

  colors: () => request('/api/colors'),
  createColor: (body) => request('/api/colors', { method: 'POST', body }),
  patchColor: (key, body) => request(`/api/colors/${key}`, { method: 'PATCH', body }),
  deleteColor: (key) => request(`/api/colors/${key}`, { method: 'DELETE' }),

  settings: () => request('/api/settings'),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body }),

  summary: () => request('/api/stats/summary'),
  runs: () => request('/api/sync/runs'),
  sync: (source = 'all') => request(`/api/sync/run?source=${source}`, { method: 'POST' }),
  shipOrder: (id, body = {}) => request(`/api/orders/${id}/ship`, { method: 'POST', body }),
};
