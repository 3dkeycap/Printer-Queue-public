import { config } from '../config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

const write = (level, scope, message, meta) => {
  if (LEVELS[level] > threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
};

export const createLogger = (scope) => ({
  error: (message, meta) => write('error', scope, message, meta),
  warn: (message, meta) => write('warn', scope, message, meta),
  info: (message, meta) => write('info', scope, message, meta),
  debug: (message, meta) => write('debug', scope, message, meta),
  child: (sub) => createLogger(`${scope}:${sub}`),
});

export const logger = createLogger('app');
