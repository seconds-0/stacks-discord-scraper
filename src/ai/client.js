import OpenAI from 'openai';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

let client = null;

/**
 * Get or create the OpenRouter client.
 * @returns {OpenAI} OpenAI-compatible client for OpenRouter
 */
export function getAIClient() {
  if (!client) {
    const config = loadConfig();
    const apiKey = config.ai.apiKey;

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is required');
    }

    client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/stacks-discord-scraper',
        'X-Title': 'Stacks Discord Scraper',
      },
    });
  }
  return client;
}

/**
 * Process with exponential backoff retry.
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise<*>} Result of the function
 */
export async function processWithRetry(fn, options = {}) {
  const config = loadConfig();
  const {
    maxRetries = config.ai.retryAttempts,
    baseDelay = config.ai.retryDelayMs,
    backoffMultiplier = config.scraper.backoffMultiplier,
    maxDelay = 30000,
  } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable =
        error.status === 429 ||
        error.status === 500 ||
        error.status === 503 ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT';

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(baseDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);
      const jitter = delay * 0.1 * Math.random();
      const totalDelay = Math.round(delay + jitter);

      logger.warn(`Retry ${attempt}/${maxRetries} after ${totalDelay}ms`, {
        error: error.message,
        status: error.status,
      });

      await new Promise((r) => setTimeout(r, totalDelay));
    }
  }
}

/**
 * Process messages through the AI model.
 * @param {string} prompt - The prompt to send
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Parsed JSON response
 */
export async function processWithAI(prompt, options = {}) {
  const config = loadConfig();
  const {
    model = config.ai.model,
    maxTokens = config.ai.maxTokens,
    trackUsage,
  } = options;

  return processWithRetry(async () => {
    const response = await getAIClient().chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const text = response.choices[0].message.content;

    // Track token usage if callback provided
    if (trackUsage) {
      trackUsage({
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        model: response.model,
      });
    }

    // Parse JSON response
    try {
      return JSON.parse(text);
    } catch (parseError) {
      logger.error('Failed to parse AI response as JSON', {
        error: parseError.message,
        response: text.slice(0, 500),
      });
      throw new Error(`Invalid JSON response from AI: ${parseError.message}`);
    }
  }, options);
}

/**
 * Create a usage tracker for aggregating token usage.
 * @returns {Object} Usage tracker with track() and getStats() methods
 */
export function createUsageTracker() {
  const stats = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  return {
    track: (usage) => {
      stats.calls++;
      stats.inputTokens += usage.inputTokens || 0;
      stats.outputTokens += usage.outputTokens || 0;
    },
    getStats: () => ({ ...stats }),
    reset: () => {
      stats.calls = 0;
      stats.inputTokens = 0;
      stats.outputTokens = 0;
    },
  };
}

export default {
  getAIClient,
  processWithRetry,
  processWithAI,
  createUsageTracker,
};
