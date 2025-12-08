-- Migration 001: Add message metadata fields
-- This migration adds additional metadata fields to messages table

ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'text';
ALTER TABLE messages ADD COLUMN edited_at TEXT;
ALTER TABLE messages ADD COLUMN deleted_at TEXT;
ALTER TABLE messages ADD COLUMN reaction_count INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN reply_count INTEGER DEFAULT 0;

-- Add indexes for new fields
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
CREATE INDEX IF NOT EXISTS idx_messages_edited ON messages(edited_at);
CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(deleted_at);
