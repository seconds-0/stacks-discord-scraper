-- Initial schema for Stacks Discord Scraper
-- This migration creates the core tables for storing Discord data

-- Guilds (Discord servers)
CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,              -- Discord snowflake ID
    name TEXT NOT NULL,
    icon_url TEXT,
    member_count INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Channels
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,              -- Discord snowflake ID
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type INTEGER NOT NULL,            -- 0=text, 2=voice, 5=announcement, 10=thread, etc.
    parent_id TEXT,                   -- Category or parent channel ID
    position INTEGER,
    topic TEXT,
    last_scraped_message_id TEXT,     -- For incremental sync
    last_scraped_at TEXT,
    message_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Users (message authors)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,              -- Discord snowflake ID
    username TEXT NOT NULL,
    global_name TEXT,                 -- Display name
    discriminator TEXT,               -- Legacy discriminator (may be '0')
    avatar_url TEXT,
    is_bot INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,              -- Discord snowflake ID
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT,
    clean_content TEXT,               -- Mentions resolved to usernames
    timestamp TEXT NOT NULL,          -- ISO 8601 format
    edited_timestamp TEXT,
    message_type INTEGER DEFAULT 0,   -- 0=default, 19=reply, etc.
    reference_id TEXT,                -- Reply-to message ID
    thread_id TEXT,                   -- Thread ID if in a thread
    has_embeds INTEGER DEFAULT 0,
    has_attachments INTEGER DEFAULT 0,
    reaction_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Embeds (rich content in messages)
CREATE TABLE IF NOT EXISTS embeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    type TEXT,                        -- rich, image, video, gifv, article, link
    title TEXT,
    description TEXT,
    url TEXT,
    author_name TEXT,
    author_url TEXT,
    footer_text TEXT,
    image_url TEXT,
    thumbnail_url TEXT,
    color INTEGER,
    raw_json TEXT                     -- Full embed JSON for completeness
);

-- Attachments (files attached to messages)
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,              -- Discord snowflake ID
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_type TEXT,
    size INTEGER,
    url TEXT NOT NULL,
    proxy_url TEXT,
    width INTEGER,
    height INTEGER
);

-- Reactions (aggregated per message)
CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,              -- Unicode emoji or custom emoji ID
    emoji_name TEXT,                  -- Name for custom emojis
    is_custom INTEGER DEFAULT 0,
    count INTEGER DEFAULT 1,
    UNIQUE(message_id, emoji)
);

-- Sync state (track scraping progress)
CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT NOT NULL,          -- 'full', 'incremental', 'channel'
    guild_id TEXT REFERENCES guilds(id),
    channel_id TEXT REFERENCES channels(id),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    messages_processed INTEGER DEFAULT 0,
    status TEXT DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
    error_message TEXT
);

-- AI Processing Results (Phase 2+)
CREATE TABLE IF NOT EXISTS ai_processing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,        -- 'message', 'channel', 'daily_summary', 'weekly_summary'
    entity_id TEXT NOT NULL,          -- Reference ID (message_id, channel_id, or date string)
    stage TEXT NOT NULL,              -- 'filter', 'categorize', 'summarize', 'extract', 'format'
    result_json TEXT NOT NULL,        -- AI output as JSON
    model_used TEXT,
    tokens_in INTEGER,
    tokens_out INTEGER,
    processed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(entity_type, entity_id, stage)
);

-- Marketing Extracts (Phase 4+)
CREATE TABLE IF NOT EXISTS marketing_extracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,        -- 'message', 'summary', 'thread'
    source_id TEXT NOT NULL,
    extract_type TEXT NOT NULL,       -- 'announcement', 'quote', 'faq', 'highlight', 'social_post'
    title TEXT,
    content TEXT NOT NULL,
    formatted_content TEXT,           -- Ready-to-use formatted version
    relevance_score REAL,             -- 0.0-1.0
    sentiment TEXT,                   -- 'positive', 'neutral', 'negative', 'mixed'
    topics TEXT,                      -- JSON array of topic tags
    requires_permission INTEGER DEFAULT 0,
    permission_granted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_channels_guild ON channels(guild_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);
CREATE INDEX IF NOT EXISTS idx_embeds_message ON embeds(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_ai_processing_entity ON ai_processing(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ai_processing_stage ON ai_processing(stage);
CREATE INDEX IF NOT EXISTS idx_marketing_extracts_type ON marketing_extracts(extract_type);
CREATE INDEX IF NOT EXISTS idx_sync_state_status ON sync_state(status);
