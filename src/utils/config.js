import fs from 'fs';
import path from 'path';

let cachedConfig = null;

/**
 * Load configuration from config/default.json merged with environment variables.
 * Environment variables take precedence over config file values.
 * @returns {Object} Merged configuration object
 */
export function loadConfig() {
  if (cachedConfig) return cachedConfig;

  const configPath = path.join(process.cwd(), 'config', 'default.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Merge with environment variables
  cachedConfig = {
    discord: {
      ...fileConfig.discord,
      token: process.env.DISCORD_BOT_TOKEN,
      guildId: process.env.DISCORD_GUILD_ID,
    },
    scraper: {
      ...fileConfig.scraper,
      delayBetweenRequests: parseInt(process.env.SCRAPE_DELAY_MS) || fileConfig.scraper.delayBetweenRequests,
      maxAgeDays: parseInt(process.env.SCRAPE_MAX_AGE_DAYS) || fileConfig.discord.maxAgeDays,
      maxPerChannel: parseInt(process.env.SCRAPE_MAX_PER_CHANNEL) || fileConfig.discord.maxMessagesPerChannel,
    },
    ai: {
      ...fileConfig.ai,
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.AI_MODEL || fileConfig.ai.model,
      batchSize: parseInt(process.env.AI_BATCH_SIZE) || fileConfig.ai.batchSize,
      maxTokensPerBatch: parseInt(process.env.AI_MAX_TOKENS_PER_BATCH) || fileConfig.ai.maxTokensPerBatch,
      retryAttempts: parseInt(process.env.AI_MAX_RETRIES) || fileConfig.ai.retryAttempts,
      retryDelayMs: parseInt(process.env.AI_RETRY_DELAY_MS) || fileConfig.ai.retryDelayMs,
    },
    privacy: {
      ...fileConfig.privacy,
    },
    database: {
      ...fileConfig.database,
      path: process.env.DATABASE_PATH || fileConfig.database.path,
    },
    export: {
      ...fileConfig.export,
    },
    logging: {
      level: process.env.LOG_LEVEL || fileConfig.logging.level,
      format: process.env.LOG_FORMAT || fileConfig.logging.format,
    },
  };

  return cachedConfig;
}

/**
 * Clear the cached config (useful for testing).
 */
export function clearConfigCache() {
  cachedConfig = null;
}

/**
 * Get a specific config value by dot-notation path.
 * @param {string} path - Dot-separated path (e.g., 'ai.model')
 * @param {*} defaultValue - Default if path not found
 * @returns {*} Config value
 */
export function getConfigValue(path, defaultValue = undefined) {
  const config = loadConfig();
  const keys = path.split('.');
  let value = config;

  for (const key of keys) {
    if (value === undefined || value === null) return defaultValue;
    value = value[key];
  }

  return value !== undefined ? value : defaultValue;
}

export default { loadConfig, clearConfigCache, getConfigValue };
