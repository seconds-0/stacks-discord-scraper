import { loadConfig } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { processWithAI, createUsageTracker } from '../client.js';
import { buildPrompt } from '../prompts.js';
import { validateExtractResponse } from '../validation.js';
import { createBatches, estimateBatchTokens } from '../tokens.js';
import { anonymizeMessages } from '../../utils/privacy.js';
import {
  getProcessedMessages,
  getAIProcessing,
  upsertAIProcessing,
  upsertMarketingExtract,
  getUser,
} from '../../storage/repositories/index.js';

/**
 * Extract quotes and testimonials from messages.
 * @param {Object} db - Database connection
 * @param {Array} messages - Messages to extract from
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Extraction results
 */
async function extractQuotes(db, messages, options = {}) {
  const config = loadConfig();
  const { dryRun = false } = options;
  const usageTracker = createUsageTracker();

  if (messages.length === 0) {
    return { extracted: 0, type: 'quote' };
  }

  // Enrich with author info
  const enrichedMessages = messages.map((msg) => ({
    id: msg.id,
    content: msg.content || msg.clean_content || '',
    timestamp: msg.timestamp,
    author: getUser(db, msg.author_id),
    reaction_count: msg.reaction_count,
  }));

  // Anonymize if configured
  let processedMessages = enrichedMessages;
  let usernameMapping = {};
  if (config.privacy.anonymizeInPrompts) {
    const result = anonymizeMessages(enrichedMessages);
    processedMessages = result.messages;
    usernameMapping = result.mapping;
  }

  if (dryRun) {
    const tokens = estimateBatchTokens(processedMessages);
    return {
      dryRun: true,
      type: 'quote',
      messageCount: messages.length,
      estimatedTokens: tokens,
    };
  }

  // Build prompt
  const prompt = buildPrompt('extract-quotes', {
    MESSAGES_JSON: JSON.stringify(processedMessages, null, 2),
  });

  // Call AI
  const response = await processWithAI(prompt, {
    trackUsage: usageTracker.track,
  });

  // Validate
  const validated = validateExtractResponse(response);

  // Store extracts
  let extracted = 0;
  for (const extract of validated.extracts) {
    // Find original message
    const originalMsg = messages.find((m) => m.id === extract.source_message_id);

    upsertMarketingExtract(db, {
      source_type: 'message',
      source_id: extract.source_message_id || extract.id,
      extract_type: 'quote',
      title: extract.context || null,
      content: extract.content,
      formatted_content: extract.formatted_content || null,
      relevance_score: extract.relevance_score || 0.5,
      sentiment: extract.sentiment || 'positive',
      topics: JSON.stringify(extract.topics || []),
      requires_permission: extract.requires_permission ? 1 : 0,
      permission_granted: 0,
    });

    extracted++;
  }

  return {
    type: 'quote',
    extracted,
    usage: usageTracker.getStats(),
  };
}

/**
 * Extract announcements and news from messages.
 * @param {Object} db - Database connection
 * @param {Array} messages - Messages to extract from
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Extraction results
 */
async function extractAnnouncements(db, messages, options = {}) {
  const config = loadConfig();
  const { dryRun = false } = options;
  const usageTracker = createUsageTracker();

  if (messages.length === 0) {
    return { extracted: 0, type: 'announcement' };
  }

  // Enrich with author info
  const enrichedMessages = messages.map((msg) => ({
    id: msg.id,
    content: msg.content || msg.clean_content || '',
    timestamp: msg.timestamp,
    author: getUser(db, msg.author_id),
    reaction_count: msg.reaction_count,
    has_embeds: msg.has_embeds,
  }));

  if (dryRun) {
    const tokens = estimateBatchTokens(enrichedMessages);
    return {
      dryRun: true,
      type: 'announcement',
      messageCount: messages.length,
      estimatedTokens: tokens,
    };
  }

  // Build prompt
  const prompt = buildPrompt('extract-announcements', {
    MESSAGES_JSON: JSON.stringify(enrichedMessages, null, 2),
  });

  // Call AI
  const response = await processWithAI(prompt, {
    trackUsage: usageTracker.track,
  });

  // Validate
  const validated = validateExtractResponse(response);

  // Store extracts
  let extracted = 0;
  for (const extract of validated.extracts) {
    upsertMarketingExtract(db, {
      source_type: 'message',
      source_id: extract.source_message_id || extract.id,
      extract_type: 'announcement',
      title: extract.title || null,
      content: extract.content,
      formatted_content: extract.formatted_content || null,
      relevance_score: extract.relevance_score || 0.7,
      sentiment: extract.sentiment || 'neutral',
      topics: JSON.stringify(extract.topics || []),
      requires_permission: 0, // Announcements typically don't need permission
      permission_granted: 0,
    });

    extracted++;
  }

  return {
    type: 'announcement',
    extracted,
    usage: usageTracker.getStats(),
  };
}

/**
 * Extract FAQs (question-answer pairs) from messages.
 * @param {Object} db - Database connection
 * @param {Array} messages - Messages to extract from
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Extraction results
 */
async function extractFAQs(db, messages, options = {}) {
  const config = loadConfig();
  const { dryRun = false } = options;
  const usageTracker = createUsageTracker();

  if (messages.length === 0) {
    return { extracted: 0, type: 'faq' };
  }

  // Enrich with author info
  const enrichedMessages = messages.map((msg) => ({
    id: msg.id,
    content: msg.content || msg.clean_content || '',
    timestamp: msg.timestamp,
    author: getUser(db, msg.author_id),
    reference_id: msg.reference_id, // Important for Q&A threading
  }));

  // Anonymize
  let processedMessages = enrichedMessages;
  if (config.privacy.anonymizeInPrompts) {
    const { messages: anonMessages } = anonymizeMessages(enrichedMessages);
    processedMessages = anonMessages;
  }

  if (dryRun) {
    const tokens = estimateBatchTokens(processedMessages);
    return {
      dryRun: true,
      type: 'faq',
      messageCount: messages.length,
      estimatedTokens: tokens,
    };
  }

  // Build prompt
  const prompt = buildPrompt('extract-faqs', {
    MESSAGES_JSON: JSON.stringify(processedMessages, null, 2),
  });

  // Call AI
  const response = await processWithAI(prompt, {
    trackUsage: usageTracker.track,
  });

  // Validate
  const validated = validateExtractResponse(response);

  // Store extracts
  let extracted = 0;
  for (const extract of validated.extracts) {
    upsertMarketingExtract(db, {
      source_type: 'message',
      source_id: extract.source_message_id || extract.id,
      extract_type: 'faq',
      title: extract.question || extract.title || null,
      content: extract.answer || extract.content,
      formatted_content: extract.formatted_content || null,
      relevance_score: extract.relevance_score || 0.6,
      sentiment: 'neutral',
      topics: JSON.stringify(extract.topics || []),
      requires_permission: 0,
      permission_granted: 0,
    });

    extracted++;
  }

  return {
    type: 'faq',
    extracted,
    usage: usageTracker.getStats(),
  };
}

/**
 * Run the extract stage.
 * @param {Object} db - Database connection
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing results
 */
export async function runExtractStage(db, options = {}) {
  const config = loadConfig();
  const {
    extractType = 'all', // 'quotes', 'announcements', 'faqs', or 'all'
    limit = 500,
    force = false,
    dryRun = false,
  } = options;

  const stageLogger = logger.child({ stage: 'extract' });

  // Get messages that passed filter and categorization with high marketing relevance
  stageLogger.info('Fetching high-relevance messages for extraction');

  const messages = db
    .prepare(
      `
      SELECT m.*
      FROM messages m
      JOIN ai_processing ap_filter
        ON ap_filter.entity_type = 'message'
        AND ap_filter.entity_id = m.id
        AND ap_filter.stage = 'filter'
        AND json_extract(ap_filter.result_json, '$.keep') = 1
      LEFT JOIN ai_processing ap_cat
        ON ap_cat.entity_type = 'message'
        AND ap_cat.entity_id = m.id
        AND ap_cat.stage = 'categorize'
      WHERE (
        ap_cat.id IS NULL
        OR json_extract(ap_cat.result_json, '$.marketing_relevance') IN ('high', 'medium')
      )
      ORDER BY m.timestamp DESC
      LIMIT ?
    `
    )
    .all(limit);

  if (messages.length === 0) {
    stageLogger.info('No messages available for extraction');
    return { processed: 0, extracts: {} };
  }

  stageLogger.info(`Found ${messages.length} messages for extraction`);

  const results = {
    processed: messages.length,
    extracts: {},
    errors: [],
  };

  const extractors = {
    quotes: extractQuotes,
    announcements: extractAnnouncements,
    faqs: extractFAQs,
  };

  const typesToRun =
    extractType === 'all' ? Object.keys(extractors) : [extractType];

  // Create batches for processing
  const batches = createBatches(messages, {
    maxTokens: config.ai.maxTokensPerBatch,
    maxMessages: config.ai.batchSize,
  });

  for (const type of typesToRun) {
    const extractor = extractors[type];
    if (!extractor) {
      stageLogger.warn(`Unknown extract type: ${type}`);
      continue;
    }

    stageLogger.info(`Running ${type} extraction`);

    let typeResults = { extracted: 0, type };

    for (let i = 0; i < batches.length; i++) {
      try {
        const batchResult = await extractor(db, batches[i], { dryRun });
        typeResults.extracted += batchResult.extracted || 0;

        if (batchResult.usage) {
          typeResults.usage = typeResults.usage || { calls: 0, inputTokens: 0, outputTokens: 0 };
          typeResults.usage.calls += batchResult.usage.calls || 0;
          typeResults.usage.inputTokens += batchResult.usage.inputTokens || 0;
          typeResults.usage.outputTokens += batchResult.usage.outputTokens || 0;
        }
      } catch (error) {
        stageLogger.error(`${type} extraction failed for batch ${i + 1}`, {
          error: error.message,
        });
        results.errors.push({ type, batch: i + 1, error: error.message });
      }
    }

    results.extracts[type] = typeResults;
    stageLogger.info(`${type}: Extracted ${typeResults.extracted} items`);
  }

  return results;
}

export default { runExtractStage, extractQuotes, extractAnnouncements, extractFAQs };
