# Discord Integration Reference (authoritative)

Source of truth: Discord API docs and Help Center. This page lists the exact events, endpoints, permissions, rate‑limits, and link formats we rely on.

## Overview
- Purpose: ingest new messages across all visible text channels in a specific Discord server, plus safe backfill for downtime.
- Data captured: minimal fields (IDs, timestamps, author, content text, reply/thread relations, attachment presence, raw JSON for audit).

## Authentication, Intents, and Permissions
- Bot token: `DISCORD_BOT_TOKEN` (HTTP `Authorization: Bot <token>`).
- Privileged Message Content intent is required to read `content`, `embeds`, `attachments`, and `components` fields on messages; verified apps in ≥100 servers must apply for access. Enable in Developer Portal (see “What are Privileged Intents?” and Message Content FAQ). Links: https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents and https://support-dev.discord.com/hc/en-us/articles/4404772028055-Message-Content-Privi
- Minimum channel permissions where the bot is added: `VIEW_CHANNEL` and `READ_MESSAGE_HISTORY` to read history (see Messages resource “Get Channel Messages” for permission notes). Link: https://github.com/discord/discord-api-docs/blob/main/docs/resources/Message.md

## Gateway Events (real‑time)
- Message Create: dispatched when a message is created. See Messages resource note and Gateway docs for fields present in `MESSAGE_CREATE`/`MESSAGE_UPDATE`. Message resource link: https://github.com/discord/discord-api-docs/blob/main/docs/resources/Message.md
- Thread Create/Update/Delete: dispatched for thread lifecycle; threads also appear in `GUILD_CREATE`’s `threads` array. Threads topic: https://github.com/discord/discord-api-docs/blob/main/docs/topics/Threads.md
- Opcodes/close codes reference (heartbeats, identify, etc.) for robust gateway handling: https://github.com/discord/discord-api-docs/blob/main/docs/topics/Gateway.md (see opcodes/status codes section).

Notes
- Ignore events from our own bot and from other bots.
- Without the Message Content intent, user‑generated fields may be empty in message events on v10+ (see Messages resource warning).

## REST Endpoints (safe backfill)
Goal: fetch messages newer than `last_seen_message_id` per channel on startup or after downtime; avoid aggressive pagination.

- List channel messages: `GET /channels/{channel.id}/messages` with query params `after`, `before`, `around` (mutually exclusive) and `limit` (1–100, default 50). Requires appropriate channel permissions. Link: https://github.com/discord/discord-api-docs/blob/main/docs/resources/Message.md
- Get a single message: `GET /channels/{channel.id}/messages/{message.id}`. Same link as above.
- List guild channels: `GET /guilds/{guild.id}/channels` (documented across Channel/Guild resources). Channel resource: https://github.com/discord/discord-api-docs/blob/main/docs/resources/Channel.md
- Thread APIs (when needed): start thread from message or without message; list/manage threads. Channel resource (thread endpoints): https://github.com/discord/discord-api-docs/blob/main/docs/resources/Channel.md and Threads topic: https://github.com/discord/discord-api-docs/blob/main/docs/topics/Threads.md

Implementation tips
- Maintain a per‑channel cursor (`last_seen_message_id`) and backfill using `after={last_seen}` to avoid duplicates.
- Use idempotent inserts keyed by `message_id`.

## Rate Limiting
- Discord enforces per‑route and global rate limits; do not hard‑code limits. Parse response headers and respect backoff. Reference: https://github.com/discord/discord-api-docs/blob/main/docs/topics/Rate_Limits.md

## Message Links (Permalinks)
- Format used by Discord: `https://discord.com/channels/<server_id>/<channel_id>/<message_id>`. See Help Center threads on “Copy Message Link” for context: https://support.discord.com/hc/en-us/community/posts/17869660258967-Discord-Web-App-s-Links-In-Message-Copying-Dilemma and Android/iOS discussions.

## Data Model Hints
- Text channel vs. thread: store `is_thread` and `parent_channel_id` for threads; keep per‑channel cursors (`last_seen_message_id`, `last_seen_at`). See Threads topic: https://github.com/discord/discord-api-docs/blob/main/docs/topics/Threads.md

## Safety & Redaction
- Do not download attachments by default. Store presence flags and filenames; keep links as metadata.
- Use allow/deny lists to control which channels are ingested.

## Example: conservative backfill (pseudo‑flow)
1) For each allowed channel, read `last_seen_message_id`.
2) Call `GET /channels/{id}/messages?after=last_seen&limit=100` until empty. See Message list endpoint notes: https://github.com/discord/discord-api-docs/blob/main/docs/resources/Message.md
3) Insert messages idempotently by `message_id`; update channel cursor.

## References
- Messages resource (list/single): https://github.com/discord/discord-api-docs/blob/main/docs/resources/Message.md
- Channel resource (threads, etc.): https://github.com/discord/discord-api-docs/blob/main/docs/resources/Channel.md
- Threads topic: https://github.com/discord/discord-api-docs/blob/main/docs/topics/Threads.md
- Rate limits: https://github.com/discord/discord-api-docs/blob/main/docs/topics/Rate_Limits.md
- Help Center (Privileged Intents, Message Content): https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents and https://support-dev.discord.com/hc/en-us/articles/4404772028055-Message-Content-Privi
