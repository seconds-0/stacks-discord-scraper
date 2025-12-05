/**
 * Database repository functions for Discord data storage.
 */

// =============================================================================
// GUILDS
// =============================================================================

export function upsertGuild(db, guild) {
  const stmt = db.prepare(`
    INSERT INTO guilds (id, name, icon_url, member_count, updated_at)
    VALUES (@id, @name, @icon_url, @member_count, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      icon_url = excluded.icon_url,
      member_count = excluded.member_count,
      updated_at = datetime('now')
  `);
  return stmt.run(guild);
}

export function getGuild(db, guildId) {
  return db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
}

// =============================================================================
// CHANNELS
// =============================================================================

export function upsertChannel(db, channel) {
  const stmt = db.prepare(`
    INSERT INTO channels (id, guild_id, name, type, parent_id, position, topic, updated_at)
    VALUES (@id, @guild_id, @name, @type, @parent_id, @position, @topic, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      parent_id = excluded.parent_id,
      position = excluded.position,
      topic = excluded.topic,
      updated_at = datetime('now')
  `);
  return stmt.run(channel);
}

export function getChannel(db, channelId) {
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
}

export function getChannelsByGuild(db, guildId) {
  return db.prepare('SELECT * FROM channels WHERE guild_id = ? ORDER BY position').all(guildId);
}

export function getChannelLastScrapedId(db, channelId) {
  const row = db.prepare('SELECT last_scraped_message_id FROM channels WHERE id = ?').get(channelId);
  return row?.last_scraped_message_id || null;
}

export function updateChannelLastScraped(db, channelId, messageId) {
  const stmt = db.prepare(`
    UPDATE channels
    SET last_scraped_message_id = ?,
        last_scraped_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(messageId, channelId);
}

export function updateChannelMessageCount(db, channelId) {
  const stmt = db.prepare(`
    UPDATE channels
    SET message_count = (SELECT COUNT(*) FROM messages WHERE channel_id = ?),
        updated_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(channelId, channelId);
}

// =============================================================================
// USERS
// =============================================================================

export function upsertUser(db, user) {
  const stmt = db.prepare(`
    INSERT INTO users (id, username, global_name, discriminator, avatar_url, is_bot, updated_at)
    VALUES (@id, @username, @global_name, @discriminator, @avatar_url, @is_bot, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      global_name = excluded.global_name,
      discriminator = excluded.discriminator,
      avatar_url = excluded.avatar_url,
      is_bot = excluded.is_bot,
      updated_at = datetime('now')
  `);
  return stmt.run(user);
}

export function getUser(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// =============================================================================
// MESSAGES
// =============================================================================

export function upsertMessage(db, message) {
  const stmt = db.prepare(`
    INSERT INTO messages (
      id, channel_id, author_id, content, clean_content, timestamp,
      edited_timestamp, message_type, reference_id, thread_id,
      has_embeds, has_attachments, reaction_count
    )
    VALUES (
      @id, @channel_id, @author_id, @content, @clean_content, @timestamp,
      @edited_timestamp, @message_type, @reference_id, @thread_id,
      @has_embeds, @has_attachments, @reaction_count
    )
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      clean_content = excluded.clean_content,
      edited_timestamp = excluded.edited_timestamp,
      has_embeds = excluded.has_embeds,
      has_attachments = excluded.has_attachments,
      reaction_count = excluded.reaction_count
  `);
  return stmt.run(message);
}

export function getMessage(db, messageId) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
}

export function getMessagesByChannel(db, channelId, options = {}) {
  const { limit = 100, offset = 0, orderBy = 'timestamp DESC' } = options;
  return db.prepare(`
    SELECT * FROM messages
    WHERE channel_id = ?
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(channelId, limit, offset);
}

export function getMessagesByDateRange(db, startDate, endDate, channelId = null) {
  if (channelId) {
    return db.prepare(`
      SELECT * FROM messages
      WHERE channel_id = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp
    `).all(channelId, startDate, endDate);
  }
  return db.prepare(`
    SELECT * FROM messages
    WHERE timestamp >= ? AND timestamp < ?
    ORDER BY timestamp
  `).all(startDate, endDate);
}

export function countMessages(db, channelId = null) {
  if (channelId) {
    return db.prepare('SELECT COUNT(*) as count FROM messages WHERE channel_id = ?').get(channelId).count;
  }
  return db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
}

// =============================================================================
// EMBEDS
// =============================================================================

export function upsertEmbed(db, embed) {
  const stmt = db.prepare(`
    INSERT INTO embeds (
      message_id, type, title, description, url, author_name, author_url,
      footer_text, image_url, thumbnail_url, color, raw_json
    )
    VALUES (
      @message_id, @type, @title, @description, @url, @author_name, @author_url,
      @footer_text, @image_url, @thumbnail_url, @color, @raw_json
    )
  `);
  return stmt.run(embed);
}

export function getEmbedsByMessage(db, messageId) {
  return db.prepare('SELECT * FROM embeds WHERE message_id = ?').all(messageId);
}

// =============================================================================
// ATTACHMENTS
// =============================================================================

export function upsertAttachment(db, attachment) {
  const stmt = db.prepare(`
    INSERT INTO attachments (
      id, message_id, filename, content_type, size, url, proxy_url, width, height
    )
    VALUES (
      @id, @message_id, @filename, @content_type, @size, @url, @proxy_url, @width, @height
    )
    ON CONFLICT(id) DO UPDATE SET
      filename = excluded.filename,
      content_type = excluded.content_type,
      size = excluded.size,
      url = excluded.url,
      proxy_url = excluded.proxy_url
  `);
  return stmt.run(attachment);
}

export function getAttachmentsByMessage(db, messageId) {
  return db.prepare('SELECT * FROM attachments WHERE message_id = ?').all(messageId);
}

// =============================================================================
// REACTIONS
// =============================================================================

export function upsertReaction(db, reaction) {
  const stmt = db.prepare(`
    INSERT INTO reactions (message_id, emoji, emoji_name, is_custom, count)
    VALUES (@message_id, @emoji, @emoji_name, @is_custom, @count)
    ON CONFLICT(message_id, emoji) DO UPDATE SET
      count = excluded.count
  `);
  return stmt.run(reaction);
}

export function getReactionsByMessage(db, messageId) {
  return db.prepare('SELECT * FROM reactions WHERE message_id = ?').all(messageId);
}

// =============================================================================
// SYNC STATE
// =============================================================================

export function createSyncState(db, syncType, guildId, channelId = null) {
  const stmt = db.prepare(`
    INSERT INTO sync_state (sync_type, guild_id, channel_id, started_at, status)
    VALUES (?, ?, ?, datetime('now'), 'in_progress')
  `);
  const result = stmt.run(syncType, guildId, channelId);
  return result.lastInsertRowid;
}

export function completeSyncState(db, syncId, messagesProcessed) {
  const stmt = db.prepare(`
    UPDATE sync_state
    SET status = 'completed',
        completed_at = datetime('now'),
        messages_processed = ?
    WHERE id = ?
  `);
  return stmt.run(messagesProcessed, syncId);
}

export function failSyncState(db, syncId, errorMessage) {
  const stmt = db.prepare(`
    UPDATE sync_state
    SET status = 'failed',
        completed_at = datetime('now'),
        error_message = ?
    WHERE id = ?
  `);
  return stmt.run(errorMessage, syncId);
}

export function getLatestSyncState(db, guildId) {
  return db.prepare(`
    SELECT * FROM sync_state
    WHERE guild_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(guildId);
}

// =============================================================================
// BULK EXPORT HELPERS
// =============================================================================

export function getAllMessages(db, options = {}) {
  const { channelId, startDate, endDate, limit, offset = 0 } = options;

  let query = 'SELECT * FROM messages WHERE 1=1';
  const params = [];

  if (channelId) {
    query += ' AND channel_id = ?';
    params.push(channelId);
  }

  if (startDate) {
    query += ' AND timestamp >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND timestamp < ?';
    params.push(endDate);
  }

  query += ' ORDER BY timestamp';

  if (limit) {
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }

  return db.prepare(query).all(...params);
}

export function getFullMessageData(db, messageId) {
  const message = getMessage(db, messageId);
  if (!message) return null;

  return {
    ...message,
    author: getUser(db, message.author_id),
    embeds: getEmbedsByMessage(db, messageId),
    attachments: getAttachmentsByMessage(db, messageId),
    reactions: getReactionsByMessage(db, messageId),
  };
}

export default {
  // Guilds
  upsertGuild,
  getGuild,
  // Channels
  upsertChannel,
  getChannel,
  getChannelsByGuild,
  getChannelLastScrapedId,
  updateChannelLastScraped,
  updateChannelMessageCount,
  // Users
  upsertUser,
  getUser,
  // Messages
  upsertMessage,
  getMessage,
  getMessagesByChannel,
  getMessagesByDateRange,
  countMessages,
  // Embeds
  upsertEmbed,
  getEmbedsByMessage,
  // Attachments
  upsertAttachment,
  getAttachmentsByMessage,
  // Reactions
  upsertReaction,
  getReactionsByMessage,
  // Sync state
  createSyncState,
  completeSyncState,
  failSyncState,
  getLatestSyncState,
  // Export helpers
  getAllMessages,
  getFullMessageData,
};
