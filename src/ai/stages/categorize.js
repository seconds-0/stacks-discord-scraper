import { loadConfig } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { processWithAI, createUsageTracker } from '../client.js';
import { buildPrompt } from '../prompts.js';
import { validateCategorizeResponse } from '../validation.js';
import { createBatches, estimateBatchTokens } from '../tokens.js';
import { anonymizeMessages } from '../../utils/privacy.js';
import {
  getProcessedMessages,
  getAIProcessing,
  upsertAIProcessing,
  getUser,
} from '../../storage/repositories/index.js';

/**
 * Run the categorize stage on filtered messages.
 * Only processes messages that passed the filter stage (keep=true).
 * @param {Object} db - Database connection
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing results
 */
export async function runCategorizeStage(db, options = {}) {
  const config = loadConfig();
  const { limit, force = false, dryRun = false } = options;

  const stageLogger = logger.child({ stage: 'categorize' });
  const usageTracker = createUsageTracker();

  // Get messages that passed filter but haven't been categorized
  stageLogger.info('Fetching messages for categorization');

  const filteredMessages = getProcessedMessages(db, 'filter', {
    keepOnly: true,
    limit: limit || 1000,
  });

  // Filter to only those not yet categorized
  const toCategorize = filteredMessages.filter((msg) => {
    if (force) return true;
    const existing = getAIProcessing(db, 'message', msg.id, 'categorize');
    return !existing;
  });

  if (toCategorize.length === 0) {
    stageLogger.info('No messages need categorization');
    return {
      processed: 0,
      usage: usageTracker.getStats(),
    };
  }

  stageLogger.info(`Found ${toCategorize.length} messages to categorize`);

  // Enrich with author info
  const enrichedMessages = toCategorize.map((msg) => ({
    id: msg.id,
    content: msg.content || msg.clean_content || '',
    timestamp: msg.timestamp,
    author: getUser(db, msg.author_id),
    has_embeds: msg.has_embeds,
    reaction_count: msg.reaction_count,
  }));

  // Create batches
  const batches = createBatches(enrichedMessages, {
    maxTokens: config.ai.maxTokensPerBatch,
    maxMessages: config.ai.batchSize,
  });

  stageLogger.info(`Split into ${batches.length} batches`);

  // Dry run
  if (dryRun) {
    const totalTokens = batches.reduce(
      (sum, batch) => sum + estimateBatchTokens(batch),
      0
    );
    stageLogger.info(`DRY RUN: Would process ~${totalTokens} tokens`);
    return {
      dryRun: true,
      messageCount: toCategorize.length,
      batchCount: batches.length,
      estimatedTokens: totalTokens,
    };
  }

  // Process batches
  const results = {
    processed: 0,
    byTopic: {},
    bySentiment: {},
    byRelevance: {},
    errors: [],
  };

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    stageLogger.debug(`Processing batch ${i + 1}/${batches.length}`);

    try {
      // Anonymize if configured
      let processedBatch = batch;
      if (config.privacy.anonymizeInPrompts) {
        const { messages: anonMessages } = anonymizeMessages(batch);
        processedBatch = anonMessages;
      }

      // Build prompt
      const prompt = buildPrompt('categorize', {
        MESSAGES_JSON: JSON.stringify(processedBatch, null, 2),
      });

      // Call AI
      const response = await processWithAI(prompt, {
        trackUsage: usageTracker.track,
      });

      // Validate
      const validated = validateCategorizeResponse(response);

      // Store results
      for (const cat of validated.categorizations) {
        const originalMsg = batch.find((m) => m.id === cat.id);
        if (!originalMsg) continue;

        upsertAIProcessing(db, {
          entity_type: 'message',
          entity_id: originalMsg.id,
          stage: 'categorize',
          result_json: JSON.stringify(cat),
          model_used: config.ai.model,
          tokens_in: null,
          tokens_out: null,
        });

        results.processed++;

        // Track statistics
        results.byTopic[cat.primary_topic] = (results.byTopic[cat.primary_topic] || 0) + 1;
        results.bySentiment[cat.sentiment] = (results.bySentiment[cat.sentiment] || 0) + 1;
        results.byRelevance[cat.marketing_relevance] =
          (results.byRelevance[cat.marketing_relevance] || 0) + 1;
      }

      stageLogger.debug(`Batch ${i + 1} complete`);
    } catch (error) {
      stageLogger.error(`Batch ${i + 1} failed`, { error: error.message });
      results.errors.push({
        batch: i + 1,
        error: error.message,
      });
    }
  }

  results.usage = usageTracker.getStats();

  stageLogger.info('Categorize stage complete', {
    processed: results.processed,
    errors: results.errors.length,
  });

  return results;
}

export default { runCategorizeStage };
