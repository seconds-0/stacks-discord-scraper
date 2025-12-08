# Slack Integration Reference (authoritative)

Source of truth: Slack Web API and Block Kit docs. This page lists the exact methods, scopes, limits, and payload shapes we rely on.

## Overview
- Purpose: post a daily digest message to a specific Slack channel at 5:00 AM PT. Optionally thread follow‑ups for per‑channel deep dives.

## Authentication & Scopes
- Bot token: `SLACK_BOT_TOKEN`.
- Required scopes: `chat:write` (post as bot). Optional: `channels:read` / `groups:read` / `mpim:read` / `im:read` or the unified `conversations:read` to look up channel IDs when not configured explicitly. See method scopes on each page below.

## Web API Methods
- Post message: `chat.postMessage` — https://api.slack.com/methods/chat.postMessage
  - Key fields: `channel` (ID), `text` and/or `blocks`.
  - Returns `ok`, `ts`, and message object on success.
- Schedule message (optional alternative to our cron): `chat.scheduleMessage` — https://api.slack.com/methods/chat.scheduleMessage
- Channel lookup (optional):
  - `conversations.list` — https://api.slack.com/methods/conversations.list
  - `conversations.info` — https://api.slack.com/methods/conversations.info

## Block Kit
- Blocks reference — https://api.slack.com/reference/block-kit/blocks
- Messaging with blocks (limits) — https://api.slack.com/reference/messaging/blocks
  - Up to 50 blocks per message.
  - Text object limits apply (e.g., `mrkdwn`/`plain_text` length constraints). Consult the page for the current maximums.
- Visual builder — https://app.slack.com/block-kit-builder

## Rate Limiting
- Rate limits overview — https://api.slack.com/docs/rate-limits
  - Some methods (including posting messages) effectively limit to ~1 request per second per channel; handle HTTP 429 and respect `Retry-After` header.

## Message Links & Formatting
- Formatting basics (`mrkdwn`, links) — https://api.slack.com/reference/surfaces/formatting#basics
  - Link style: `<https://discord.com/channels/<server>/<channel>/<message>|View in Discord>`.

## Posting Pattern (digest)
1) Build a blocks payload with: header, highlights bullets, sections for Feature Requests/Bugs/Unresolved, context footer.
2) Call `chat.postMessage` with `channel=SLACK_TARGET_CHANNEL` and `blocks=[...]`.
3) On error 429, wait per `Retry-After` seconds and retry with backoff.

