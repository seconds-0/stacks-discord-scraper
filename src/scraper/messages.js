import { formatUserData } from './client.js';

const FETCH_LIMIT = 100; // Discord API max per request
const DEFAULT_DELAY = 100; // ms between requests

/**
 * Sleep for a specified number of milliseconds.
 * @param {number} ms - Milliseconds to sleep.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format a Discord message for storage.
 * @param {Message} message - The Discord message.
 * @returns {Object} Message data formatted for database.
 */
export function formatMessageData(message) {
  return {
    id: message.id,
    channel_id: message.channel.id,
    author_id: message.author.id,
    content: message.content,
    clean_content: message.cleanContent,
    timestamp: message.createdAt.toISOString(),
    edited_timestamp: message.editedAt?.toISOString() || null,
    message_type: message.type,
    reference_id: message.reference?.messageId || null,
    thread_id: message.thread?.id || null,
    has_embeds: message.embeds.length > 0 ? 1 : 0,
    has_attachments: message.attachments.size > 0 ? 1 : 0,
    reaction_count: message.reactions.cache.reduce((sum, r) => sum + r.count, 0),
  };
}

/**
 * Format embed data for storage.
 * @param {MessageEmbed} embed - The Discord embed.
 * @param {string} messageId - The parent message ID.
 * @returns {Object} Embed data formatted for database.
 */
export function formatEmbedData(embed, messageId) {
  return {
    message_id: messageId,
    type: embed.data.type || 'rich',
    title: embed.title || null,
    description: embed.description || null,
    url: embed.url || null,
    author_name: embed.author?.name || null,
    author_url: embed.author?.url || null,
    footer_text: embed.footer?.text || null,
    image_url: embed.image?.url || null,
    thumbnail_url: embed.thumbnail?.url || null,
    color: embed.color || null,
    raw_json: JSON.stringify(embed.data),
  };
}

/**
 * Format attachment data for storage.
 * @param {Attachment} attachment - The Discord attachment.
 * @returns {Object} Attachment data formatted for database.
 */
export function formatAttachmentData(attachment) {
  return {
    id: attachment.id,
    message_id: attachment.message?.id || null,
    filename: attachment.name,
    content_type: attachment.contentType || null,
    size: attachment.size,
    url: attachment.url,
    proxy_url: attachment.proxyURL,
    width: attachment.width || null,
    height: attachment.height || null,
  };
}

/**
 * Format reaction data for storage.
 * @param {MessageReaction} reaction - The Discord reaction.
 * @param {string} messageId - The parent message ID.
 * @returns {Object} Reaction data formatted for database.
 */
export function formatReactionData(reaction, messageId) {
  const emoji = reaction.emoji;
  return {
    message_id: messageId,
    emoji: emoji.id || emoji.name, // Custom emoji ID or unicode
    emoji_name: emoji.name,
    is_custom: emoji.id ? 1 : 0,
    count: reaction.count,
  };
}

/**
 * Fetch all messages from a channel with pagination.
 * @param {TextChannel} channel - The Discord channel.
 * @param {Object} options - Fetch options.
 * @param {string} [options.before] - Fetch messages before this ID.
 * @param {string} [options.after] - Fetch messages after this ID.
 * @param {number} [options.limit] - Maximum messages to fetch (null for all).
 * @param {number} [options.delay] - Delay between requests in ms.
 * @param {Function} [options.onBatch] - Callback for each batch of messages.
 * @param {Function} [options.onProgress] - Progress callback (current, total estimate).
 * @returns {AsyncGenerator<Object>} Yields formatted message data with related entities.
 */
export async function* fetchMessages(channel, options = {}) {
  const {
    before = null,
    after = null,
    limit = null,
    delay = DEFAULT_DELAY,
    onBatch = null,
    onProgress = null,
  } = options;

  let fetchedCount = 0;
  let lastId = before;
  let hasMore = true;

  while (hasMore) {
    // Check limit
    if (limit && fetchedCount >= limit) break;

    // Build fetch options
    const fetchOptions = { limit: FETCH_LIMIT };
    if (lastId) {
      fetchOptions.before = lastId;
    } else if (after) {
      fetchOptions.after = after;
    }

    // Fetch batch
    const messages = await channel.messages.fetch(fetchOptions);

    if (messages.size === 0) {
      hasMore = false;
      break;
    }

    // Process messages (convert to array and sort by timestamp descending)
    const messageArray = Array.from(messages.values()).sort(
      (a, b) => b.createdTimestamp - a.createdTimestamp
    );

    // Callback for batch
    if (onBatch) {
      onBatch(messageArray.length, fetchedCount);
    }

    // Yield each message with related data
    for (const message of messageArray) {
      if (limit && fetchedCount >= limit) {
        hasMore = false;
        break;
      }

      const messageData = formatMessageData(message);
      const userData = formatUserData(message.author);

      // Collect embeds
      const embeds = message.embeds.map(embed => formatEmbedData(embed, message.id));

      // Collect attachments
      const attachments = Array.from(message.attachments.values()).map(att => ({
        ...formatAttachmentData(att),
        message_id: message.id,
      }));

      // Collect reactions
      const reactions = Array.from(message.reactions.cache.values()).map(
        reaction => formatReactionData(reaction, message.id)
      );

      yield {
        message: messageData,
        user: userData,
        embeds,
        attachments,
        reactions,
      };

      fetchedCount++;
    }

    // Progress callback
    if (onProgress) {
      onProgress(fetchedCount);
    }

    // Update lastId for pagination
    lastId = messageArray[messageArray.length - 1].id;

    // Check if we got fewer messages than requested (end of channel)
    if (messages.size < FETCH_LIMIT) {
      hasMore = false;
    }

    // Rate limit delay
    if (hasMore && delay > 0) {
      await sleep(delay);
    }
  }
}

/**
 * Count approximate messages in a channel (fast, uses Discord's estimate).
 * Note: This is just an estimate based on the channel's message count if available.
 * @param {TextChannel} channel - The Discord channel.
 * @returns {Promise<number|null>} Estimated message count or null if unavailable.
 */
export async function estimateMessageCount(channel) {
  // Discord doesn't provide a direct message count API
  // We can only estimate by checking if the channel has messages
  try {
    const messages = await channel.messages.fetch({ limit: 1 });
    return messages.size > 0 ? null : 0; // null means "has messages but unknown count"
  } catch {
    return null;
  }
}

/**
 * Get the latest message ID from a channel.
 * @param {TextChannel} channel - The Discord channel.
 * @returns {Promise<string|null>} The latest message ID or null.
 */
export async function getLatestMessageId(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 1 });
    return messages.first()?.id || null;
  } catch {
    return null;
  }
}

export default {
  formatMessageData,
  formatEmbedData,
  formatAttachmentData,
  formatReactionData,
  fetchMessages,
  estimateMessageCount,
  getLatestMessageId,
};
