import { loadConfig } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { processWithAI, createUsageTracker } from '../client.js';
import { buildPrompt } from '../prompts.js';
import { validateSummarizeResponse } from '../validation.js';
import { estimateBatchTokens } from '../tokens.js';
import { anonymizeMessages } from '../../utils/privacy.js';
import {
  getProcessedMessages,
  getAIProcessing,
  upsertAIProcessing,
  getChannel,
  getChannelsByGuild,
  getUser,
} from '../../storage/repositories/index.js';

/**
 * Get messages for a specific date range from a channel.
 * @param {Object} db - Database connection
 * @param {string} channelId - Channel ID
 * @param {string} startDate - Start date (ISO 8601)
 * @param {string} endDate - End date (ISO 8601)
 * @returns {Array} Messages in date range
 */
function getMessagesForDateRange(db, channelId, startDate, endDate) {
  return db
    .prepare(
      `
      SELECT m.*, ap.result_json as filter_result
      FROM messages m
      JOIN ai_processing ap ON ap.entity_type = 'message' AND ap.entity_id = m.id AND ap.stage = 'filter'
      WHERE m.channel_id = ?
        AND m.timestamp >= ?
        AND m.timestamp < ?
        AND json_extract(ap.result_json, '$.keep') = 1
      ORDER BY m.timestamp
    `
    )
    .all(channelId, startDate, endDate);
}

/**
 * Generate a daily summary for a channel.
 * @param {Object} db - Database connection
 * @param {string} channelId - Channel ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Summary result
 */
export async function summarizeDaily(db, channelId, date, options = {}) {
  const config = loadConfig();
  const { force = false, dryRun = false } = options;

  const stageLogger = logger.child({ stage: 'summarize', type: 'daily' });
  const usageTracker = createUsageTracker();

  const entityId = `${channelId}:${date}`;

  // Check if already processed
  if (!force) {
    const existing = getAIProcessing(db, 'daily_summary', entityId, 'summarize');
    if (existing) {
      stageLogger.debug(`Daily summary already exists for ${entityId}`);
      return { skipped: true, entityId };
    }
  }

  // Get channel info
  const channel = getChannel(db, channelId);
  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  // Get messages for the date
  const startDate = `${date}T00:00:00.000Z`;
  const endDate = `${date}T23:59:59.999Z`;
  const messages = getMessagesForDateRange(db, channelId, startDate, endDate);

  if (messages.length === 0) {
    stageLogger.debug(`No messages for ${channel.name} on ${date}`);
    return { skipped: true, reason: 'no_messages', entityId };
  }

  stageLogger.info(`Summarizing ${messages.length} messages for #${channel.name} on ${date}`);

  // Enrich with author info
  const enrichedMessages = messages.map((msg) => ({
    id: msg.id,
    content: msg.content || msg.clean_content || '',
    timestamp: msg.timestamp,
    author: getUser(db, msg.author_id),
    reaction_count: msg.reaction_count,
  }));

  // Dry run
  if (dryRun) {
    const tokens = estimateBatchTokens(enrichedMessages);
    return {
      dryRun: true,
      entityId,
      messageCount: messages.length,
      estimatedTokens: tokens,
    };
  }

  // Anonymize if configured
  let processedMessages = enrichedMessages;
  if (config.privacy.anonymizeInPrompts) {
    const { messages: anonMessages } = anonymizeMessages(enrichedMessages);
    processedMessages = anonMessages;
  }

  // Build prompt
  const prompt = buildPrompt('summarize-daily', {
    CHANNEL_NAME: channel.name,
    DATE: date,
    COUNT: messages.length,
    MESSAGES_JSON: JSON.stringify(processedMessages, null, 2),
  });

  // Call AI
  const response = await processWithAI(prompt, {
    trackUsage: usageTracker.track,
  });

  // Validate
  const validated = validateSummarizeResponse(response);

  // Store result
  upsertAIProcessing(db, {
    entity_type: 'daily_summary',
    entity_id: entityId,
    stage: 'summarize',
    result_json: JSON.stringify(validated.summary),
    model_used: config.ai.model,
    tokens_in: null,
    tokens_out: null,
  });

  return {
    entityId,
    channelName: channel.name,
    date,
    messageCount: messages.length,
    summary: validated.summary,
    usage: usageTracker.getStats(),
  };
}

/**
 * Generate a weekly summary aggregating daily summaries.
 * @param {Object} db - Database connection
 * @param {string} guildId - Guild ID
 * @param {string} weekStart - Start of week (YYYY-MM-DD, Monday)
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Weekly summary result
 */
export async function summarizeWeekly(db, guildId, weekStart, options = {}) {
  const config = loadConfig();
  const { force = false, dryRun = false } = options;

  const stageLogger = logger.child({ stage: 'summarize', type: 'weekly' });
  const usageTracker = createUsageTracker();

  const entityId = `${guildId}:week:${weekStart}`;

  // Check if already processed
  if (!force) {
    const existing = getAIProcessing(db, 'weekly_summary', entityId, 'summarize');
    if (existing) {
      stageLogger.debug(`Weekly summary already exists for ${entityId}`);
      return { skipped: true, entityId };
    }
  }

  // Get all daily summaries for the week
  const weekEnd = getWeekEnd(weekStart);
  const dailySummaries = db
    .prepare(
      `
      SELECT entity_id, result_json
      FROM ai_processing
      WHERE entity_type = 'daily_summary'
        AND stage = 'summarize'
        AND entity_id LIKE ?
        AND substr(entity_id, instr(entity_id, ':') + 1) >= ?
        AND substr(entity_id, instr(entity_id, ':') + 1) <= ?
    `
    )
    .all(`%`, weekStart, weekEnd);

  if (dailySummaries.length === 0) {
    stageLogger.debug(`No daily summaries for week starting ${weekStart}`);
    return { skipped: true, reason: 'no_daily_summaries', entityId };
  }

  stageLogger.info(`Creating weekly summary from ${dailySummaries.length} daily summaries`);

  // Parse daily summaries
  const summaries = dailySummaries.map((row) => {
    const [channelId, date] = row.entity_id.split(':');
    const channel = getChannel(db, channelId);
    return {
      channel: channel?.name || channelId,
      date,
      summary: JSON.parse(row.result_json),
    };
  });

  // Dry run
  if (dryRun) {
    const tokens = estimateBatchTokens(summaries);
    return {
      dryRun: true,
      entityId,
      dailySummaryCount: summaries.length,
      estimatedTokens: tokens,
    };
  }

  // Build prompt
  const prompt = buildPrompt('summarize-weekly', {
    WEEK_START: weekStart,
    WEEK_END: weekEnd,
    SUMMARY_COUNT: summaries.length,
    SUMMARIES_JSON: JSON.stringify(summaries, null, 2),
  });

  // Call AI
  const response = await processWithAI(prompt, {
    trackUsage: usageTracker.track,
  });

  // Validate (uses same schema as daily)
  const validated = validateSummarizeResponse(response);

  // Store result
  upsertAIProcessing(db, {
    entity_type: 'weekly_summary',
    entity_id: entityId,
    stage: 'summarize',
    result_json: JSON.stringify(validated.summary),
    model_used: config.ai.model,
    tokens_in: null,
    tokens_out: null,
  });

  return {
    entityId,
    weekStart,
    weekEnd,
    dailySummaryCount: summaries.length,
    summary: validated.summary,
    usage: usageTracker.getStats(),
  };
}

/**
 * Run the summarize stage.
 * @param {Object} db - Database connection
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing results
 */
export async function runSummarizeStage(db, options = {}) {
  const config = loadConfig();
  const {
    channelId,
    date,
    weekly = false,
    force = false,
    dryRun = false,
  } = options;

  const stageLogger = logger.child({ stage: 'summarize' });

  if (weekly) {
    // Weekly summary mode
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      throw new Error('DISCORD_GUILD_ID required for weekly summaries');
    }

    const weekStart = date || getMondayOfCurrentWeek();
    return summarizeWeekly(db, guildId, weekStart, { force, dryRun });
  }

  // Daily summary mode
  if (!channelId) {
    // Summarize all channels for the given date
    const guildId = process.env.DISCORD_GUILD_ID;
    const channels = getChannelsByGuild(db, guildId);
    const targetDate = date || getYesterday();

    stageLogger.info(`Summarizing ${channels.length} channels for ${targetDate}`);

    const results = {
      date: targetDate,
      processed: 0,
      skipped: 0,
      summaries: [],
      errors: [],
    };

    for (const channel of channels) {
      try {
        const result = await summarizeDaily(db, channel.id, targetDate, { force, dryRun });
        if (result.skipped) {
          results.skipped++;
        } else {
          results.processed++;
          results.summaries.push(result);
        }
      } catch (error) {
        stageLogger.error(`Failed to summarize ${channel.name}`, { error: error.message });
        results.errors.push({ channel: channel.name, error: error.message });
      }
    }

    return results;
  }

  // Single channel daily summary
  const targetDate = date || getYesterday();
  return summarizeDaily(db, channelId, targetDate, { force, dryRun });
}

// Helper functions
function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getMondayOfCurrentWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

export default { runSummarizeStage, summarizeDaily, summarizeWeekly };
