import { loadConfig } from '../utils/config.js';

/**
 * Estimate token count for a string.
 * Rough estimation: ~4 characters per token for English text.
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a batch of messages.
 * @param {Array} messages - Array of message objects
 * @returns {number} Estimated token count
 */
export function estimateBatchTokens(messages) {
  const json = JSON.stringify(messages);
  return estimateTokens(json);
}

/**
 * Validate that a batch won't exceed token limits.
 * @param {Array} messages - Array of message objects
 * @param {number} maxTokens - Maximum allowed tokens
 * @throws {Error} If batch is too large
 * @returns {number} Estimated token count
 */
export function validateBatchSize(messages, maxTokens = null) {
  const config = loadConfig();
  const limit = maxTokens || config.ai.maxTokensPerBatch;
  const estimated = estimateBatchTokens(messages);

  if (estimated > limit) {
    throw new Error(`Batch too large: ~${estimated} tokens (max: ${limit})`);
  }

  return estimated;
}

/**
 * Split messages into batches that fit within token limits.
 * @param {Array} messages - Array of message objects
 * @param {Object} options - Batching options
 * @returns {Array<Array>} Array of message batches
 */
export function createBatches(messages, options = {}) {
  const config = loadConfig();
  const {
    maxTokens = config.ai.maxTokensPerBatch,
    maxMessages = config.ai.batchSize,
  } = options;

  const batches = [];
  let currentBatch = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateTokens(JSON.stringify(message));

    // Start new batch if limits would be exceeded
    if (
      (currentTokens + messageTokens > maxTokens && currentBatch.length > 0) ||
      currentBatch.length >= maxMessages
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(message);
    currentTokens += messageTokens;
  }

  // Add remaining messages
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Estimate cost for processing a batch.
 * Based on OpenRouter pricing for Kimi K2.
 * @param {Object} usage - Token usage stats
 * @returns {number} Estimated cost in USD
 */
export function estimateCost(usage) {
  // Kimi K2 pricing (approximate): $0.15/$0.55 per 1M tokens
  const inputCostPerMillion = 0.15;
  const outputCostPerMillion = 0.55;

  const inputCost = (usage.inputTokens / 1_000_000) * inputCostPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * outputCostPerMillion;

  return inputCost + outputCost;
}

export default {
  estimateTokens,
  estimateBatchTokens,
  validateBatchSize,
  createBatches,
  estimateCost,
};
