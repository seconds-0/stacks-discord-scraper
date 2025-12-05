import { loadConfig } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { processWithAI, createUsageTracker } from '../client.js';
import { buildPrompt } from '../prompts.js';
import { validateFilterResponse } from '../validation.js';
import { createBatches, estimateBatchTokens } from '../tokens.js';
import { anonymizeMessages } from '../../utils/privacy.js';
import {
  getUnprocessedMessages,
  upsertAIProcessing,
  getUser,
} from '../../storage/repositories/index.js';

/**
 * Run the filter stage on messages.
 * @param {Object} db - Database connection
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing results
 */
export async function runFilterStage(db, options = {}) {
  const config = loadConfig();
  const {
    channelId,
    startDate,
    endDate,
    limit,
    force = false,
    dryRun = false,
  } = options;

  const stageLogger = logger.child({ stage: 'filter' });
  const usageTracker = createUsageTracker();

  // Get unprocessed messages
  stageLogger.info('Fetching unprocessed messages');
  const messages = getUnprocessedMessages(db, 'filter', {
    channelId,
    startDate,
    endDate,
    limit,
  });

  if (messages.length === 0) {
    stageLogger.info('No unprocessed messages found');
    return {
      processed: 0,
      kept: 0,
      discarded: 0,
      usage: usageTracker.getStats(),
    };
  }

  stageLogger.info(`Found ${messages.length} messages to process`);

  // Enrich messages with author info
  const enrichedMessages = messages.map((msg) => ({
    id: msg.id,
    content: msg.content || msg.clean_content || '',
    timestamp: msg.timestamp,
    author: getUser(db, msg.author_id),
    has_embeds: msg.has_embeds,
    has_attachments: msg.has_attachments,
    reaction_count: msg.reaction_count,
  }));

  // Create batches
  const batches = createBatches(enrichedMessages, {
    maxTokens: config.ai.maxTokensPerBatch,
    maxMessages: config.ai.batchSize,
  });

  stageLogger.info(`Split into ${batches.length} batches`);

  // Dry run - just estimate
  if (dryRun) {
    const totalTokens = batches.reduce(
      (sum, batch) => sum + estimateBatchTokens(batch),
      0
    );
    stageLogger.info(`DRY RUN: Would process ~${totalTokens} tokens in ${batches.length} batches`);
    return {
      dryRun: true,
      messageCount: messages.length,
      batchCount: batches.length,
      estimatedTokens: totalTokens,
    };
  }

  // Process batches
  const results = {
    processed: 0,
    kept: 0,
    discarded: 0,
    errors: [],
  };

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    stageLogger.debug(`Processing batch ${i + 1}/${batches.length} (${batch.length} messages)`);

    try {
      // Anonymize if configured
      let processedBatch = batch;
      if (config.privacy.anonymizeInPrompts) {
        const { messages: anonMessages } = anonymizeMessages(batch);
        processedBatch = anonMessages;
      }

      // Build prompt
      const prompt = buildPrompt('filter', {
        MESSAGES_JSON: JSON.stringify(processedBatch, null, 2),
      });

      // Call AI
      const response = await processWithAI(prompt, {
        trackUsage: usageTracker.track,
      });

      // Validate response
      const validated = validateFilterResponse(response);

      // Store results
      for (const decision of validated.decisions) {
        // Find original message ID (may be different if anonymized)
        const originalMsg = batch.find((m) => m.id === decision.id);
        if (!originalMsg) {
          stageLogger.warn(`Decision for unknown message: ${decision.id}`);
          continue;
        }

        upsertAIProcessing(db, {
          entity_type: 'message',
          entity_id: originalMsg.id,
          stage: 'filter',
          result_json: JSON.stringify(decision),
          model_used: config.ai.model,
          tokens_in: null,
          tokens_out: null,
        });

        results.processed++;
        if (decision.keep) {
          results.kept++;
        } else {
          results.discarded++;
        }
      }

      stageLogger.debug(`Batch ${i + 1} complete: ${validated.decisions.length} decisions`);
    } catch (error) {
      stageLogger.error(`Batch ${i + 1} failed`, { error: error.message });
      results.errors.push({
        batch: i + 1,
        error: error.message,
        messageIds: batch.map((m) => m.id),
      });
    }
  }

  results.usage = usageTracker.getStats();

  stageLogger.info('Filter stage complete', {
    processed: results.processed,
    kept: results.kept,
    discarded: results.discarded,
    errors: results.errors.length,
  });

  return results;
}

export default { runFilterStage };
