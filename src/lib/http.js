import { createLogger } from './logger.js';

const log = createLogger('http');

export class ApiError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status} on ${url}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch + timeout + exponential backoff on 429/5xx/network errors.
 * Marketplaces rate-limit aggressively; the worker must survive it.
 */
export const requestJson = async (url, { retries = 3, timeoutMs = 15000, ...options } = {}) => {
  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      const body = text ? safeJson(text) : null;

      if (response.ok) return body;
      if (response.status === 429 || response.status >= 500) {
        lastError = new ApiError(response.status, body, url);
      } else {
        throw new ApiError(response.status, body, url);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    const delay = 2 ** attempt * 500;
    log.warn('request failed, retrying', { url, attempt: attempt + 1, delay, error: String(lastError) });
    await sleep(delay);
    attempt += 1;
  }

  throw lastError;
};

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};
