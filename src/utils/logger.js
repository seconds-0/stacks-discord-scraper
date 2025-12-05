import chalk from 'chalk';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel = LOG_LEVELS.info;
let logFormat = 'text';

/**
 * Initialize logger with config.
 * @param {Object} options - Logger options
 * @param {string} options.level - Log level (debug, info, warn, error)
 * @param {string} options.format - Output format (json or text)
 */
export function initLogger(options = {}) {
  currentLevel = LOG_LEVELS[options.level || 'info'] || LOG_LEVELS.info;
  logFormat = options.format || 'text';
}

/**
 * Log a message at the specified level.
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} data - Additional data to log
 */
export function log(level, message, data = {}) {
  if (LOG_LEVELS[level] < currentLevel) return;

  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, ...data };

  if (logFormat === 'json') {
    console.log(JSON.stringify(entry));
  } else {
    const colors = {
      debug: 'gray',
      info: 'blue',
      warn: 'yellow',
      error: 'red',
    };
    const color = colors[level] || 'white';
    const levelStr = level.toUpperCase().padEnd(5);
    const prefix = chalk[color](`[${timestamp}] ${levelStr}`);
    const dataStr = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
    console.log(`${prefix} ${message}${dataStr}`);
  }
}

/**
 * Logger interface with methods for each level.
 */
export const logger = {
  debug: (message, data) => log('debug', message, data),
  info: (message, data) => log('info', message, data),
  warn: (message, data) => log('warn', message, data),
  error: (message, data) => log('error', message, data),

  /**
   * Create a child logger with default context data.
   * @param {Object} context - Default context to include in all logs
   * @returns {Object} Child logger
   */
  child: (context) => ({
    debug: (message, data) => log('debug', message, { ...context, ...data }),
    info: (message, data) => log('info', message, { ...context, ...data }),
    warn: (message, data) => log('warn', message, { ...context, ...data }),
    error: (message, data) => log('error', message, { ...context, ...data }),
  }),
};

/**
 * Log timing for async operations.
 * @param {string} label - Operation label
 * @param {Function} fn - Async function to time
 * @returns {Promise<*>} Result of the function
 */
export async function logTiming(label, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    logger.debug(`${label} completed`, { durationMs: duration });
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error(`${label} failed`, { durationMs: duration, error: error.message });
    throw error;
  }
}

export default { logger, log, initLogger, logTiming };
