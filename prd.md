# Discord → LLM → Slack Daily Digest (PRD)

Owner: alexa • Status: Draft • Last updated: 2025-10-03

## 1) Product Overview

Build a service that ingests new messages across an external, very active Discord server, batches and analyzes them with an LLM, and posts a single daily highlights digest to a Slack channel at 5:00 AM PT with links and actionable callouts (feature requests, bugs, unresolved problems). Per‑channel deep dives are produced when needed (e.g., large volume or high signal).

### Goals
- Provide a concise daily Slack digest that captures the prior 24 hours of activity across all Discord channels.
- Identify and highlight concrete feature requests, bug reports, and unresolved support threads, with links back to messages and confidence scores.
- Keep costs predictable via token budgeting and batching, while maintaining high signal quality.

### Non‑Goals (MVP)
- Full archival or export of Discord content beyond configured retention.
- Downloading or analyzing binary attachments (images, videos) beyond light captions/filenames.
- Real‑time Slack updates; cadence is one daily post at 5:00 AM PT.

### Success Metrics
- Digest usefulness (qualitative feedback + Slack emoji reactions / replies within 24h).
- Actionability: number of triage actions created from digest items (tickets, follow‑ups).
- Coverage & accuracy: proportion of significant issues captured, low false positives.
- Cost: average tokens/day under budget; stable latency (<10 min to produce digest).

### Users & Personas
- Product/Eng: scans highlights; clicks through to Discord for context; creates/links tickets.
- Support/Community: monitors unresolved items; replies in Discord; updates statuses.

### Naming Clarification
- “Guild” in earlier notes refers to a Discord server (Discord term). Slack uses “workspace”. Ingestion source is Discord; output target is Slack. The data model below uses `discord_server` (not Slack workspace) to avoid confusion.

## 2) Feature Scope

- Daily global Highlights message in Slack summarizing prior 24h across all Discord channels.
- Optional per‑channel deep‑dives for channels that exceed volume or contain high‑confidence findings.
- Findings are grouped into: `feature_requests`, `bugs`, `unresolved` with confidence and links.
- Links use Discord permalink format: `https://discord.com/channels/<server_id>/<channel_id>/<message_id>`.
- Configurable channel allowlist/denylist for ingestion.
- Redaction of obvious secrets/PII before LLM calls (emails, tokens, phone numbers, URLs if desired).

## 3) Constraints & Assumptions

- Schedule: run once per day at 5:00 AM America/Los_Angeles (PT), DST‑aware.
- Permissions: Discord bot requires Message Content intent and “Read Message History”.
- Slack app requires `chat:write` (and optionally `links:read` for unfurl policy if needed).
- MVP language: Python.
- Database: SQLite for MVP; path to Postgres for scale.
- LLM provider is pluggable; JSON‑structured outputs are required.

## 4) System Architecture

Components:
- Discord Ingestor: gateway listener + limited REST backfill for gaps; persists minimal message records and cursors.
- Store: SQLite tables for servers, channels, authors, messages, batches, summaries, findings.
- Batch Orchestrator: groups messages into time‑bounded windows and token‑bounded chunks.
- Summarizer: prompt+schema, map/reduce passes, JSON validation, conservative confidence scoring.
- Classifier: heuristics to boost signals (e.g., “feature”, “bug”, “crash”), dedupe clustering later.
- Slack Notifier: Block Kit message with Highlights and actionable sections.
- Scheduler: cron at 5:00 AM PT; replays last 24h window.
- Observability: structured logging and counters for rate, tokens, costs, errors.

### Data Model (MVP)

- `discord_servers(server_id, name, created_at)`
- `channels(channel_id, server_id, name, is_thread, parent_channel_id, last_seen_message_id, last_seen_at)`
- `authors(author_id, username, bot, role_hints, first_seen_at)`
- `messages(message_id, channel_id, author_id, content, created_at, is_reply, parent_message_id, has_attachments, raw_json)`
- `batches(batch_id, window_start, window_end, token_estimate, status)`
- `batch_messages(batch_id, message_id)`
- `summaries(batch_id, json_result, highlights_text, posted_to_slack_at)`
- `findings(finding_id, batch_id, type, title, description, severity, confidence, first_message_id, message_ids_json, status, tags_json)`

Notes:
- Primary key for `messages` is the Discord `message_id` to guarantee idempotency.
- Indexes: `(channel_id, created_at)` and `(channel_id, message_id)`.
- Consider FTS for `content` later; embeddings optional for duplicate clustering.

### Ingestion Flow

- Real‑time via gateway: `on_message` events, ignore bots/self; persist minimal fields.
- Backfill on startup: for each channel, fetch messages after `last_seen_message_id` to cover downtime, within rate limits.
- Dedup via `INSERT OR IGNORE` on `message_id`.
- Record `has_attachments` and simple attachment metadata (no binary downloads).

### Batching & Summarization

- Window: previous 24h [05:00 PT - 05:00 PT). Adjustable.
- Token budgeting: estimate tokens by char length; split high‑volume channels into micro‑batches (map phase), then reduce per channel and finally into a global Highlights set.
- JSON Schema (conceptual):
  ```json
  {
    "summary": ["<=6 bullets"],
    "feature_requests": [{"title":"","description":"","message_ids":[],"channel":"","tags":[],"confidence":0.0}],
    "bugs": [{"title":"","repro_hint":"","environment_hint":"","message_ids":[],"severity":"low|med|high|critical","confidence":0.0}],
    "unresolved": [{"problem":"","missing_info":"","message_ids":[],"channel":"","suggested_followup":"","confidence":0.0}]
  }
  ```
- Reduce: merge similar items (title+semantic similarity), drop dupes, keep highest confidence.
- Guardrails: schema validation; require evidence `message_ids` for every finding.

### Slack Output (Block Kit)

- Header: date range, total messages processed.
- Highlights: 3–7 bullets with direct Discord links.
- Feature Requests / Bugs / Unresolved sections with top N items and confidence.
- Footer: counts, costs, and a link to “view all” (future internal page).

### Scheduling

- Use `APScheduler` with timezone `America/Los_Angeles`; cron: minute=0, hour=5.
- Job computes the prior 24h window ending at today 05:00 PT, independent of runtime variations.

### Privacy & Compliance

- Scope: ingest only channels explicitly configured.
- Redaction: emails, tokens, phone numbers, URLs (configurable) before LLM.
- Retention: raw `messages` TTL 30–90 days; `summaries`/`findings` longer.
- Opt‑out: channel/regex allow/deny lists.

### Reliability & Cost Controls

- Retries with exponential backoff; dead‑letter batches.
- Daily token/cost budget caps; degrade by sampling if exceeded.
- Caching: if identical message set reprocessed, reuse prior summary by content hash.

## 5) Detailed Technical Design

### Libraries
- Discord: `discord.py` with privileged Message Content intent.
- Slack: `slack_sdk` WebClient for `chat.postMessage` and Block Kit payloads.
- Scheduler: `APScheduler` (cron, timezone aware).
- DB: `sqlite3` or `SQLAlchemy` ORM.
- LLM: provider‑agnostic client behind an interface (`Summarizer`), JSON output and token limits.

### Configuration (.env)
- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNEL_ALLOWLIST` (CSV of channel IDs) or `DISCORD_CHANNEL_DENYLIST`
- `SLACK_BOT_TOKEN`
- `SLACK_TARGET_CHANNEL` (channel ID)
- `TIMEZONE` default `America/Los_Angeles`
- `DIGEST_CRON` default `0 5 * * *`
- `LLM_PROVIDER`, `LLM_MODEL`, `LLM_MAX_TOKENS`, `DAILY_TOKEN_BUDGET`
- `DB_PATH` default `data/app.db`

### Execution Outline
- Process 1 (single binary for MVP):
  - On start: ensure schema, load channel cursors, run fast backfill.
  - Scheduler: at 05:00 PT, load messages from [T−24h, T), group per channel, create map batches.
  - Summarizer map: chunked prompts → partial JSONs.
  - Reducer: per‑channel reduce → global reduce.
  - Slack: post Highlights + optionally attach per‑channel deep dives (threaded or additional messages).
  - Persist `summaries`, `findings`, and Slack message ts.

## 6) Implementation Plan

Phase 0 — Research & References (first) 
1. Gather official API docs and write repo reference pages:
   - Discord: gateway/intents, message create event, REST backfill for channel messages, rate limits, permalinks.
   - Slack: Web API `chat.postMessage`, Block Kit structure/limits, channel ID lookup, message links.
   - LLM: chosen provider’s API (models, JSON mode, rate limits, cost).
2. Record authentication, scopes, rate limits, pagination, and example requests/responses.
3. Capture naming conventions (server vs channel vs thread) and permalink formats.

Phase 1 — Repo & Config
1. Python project scaffold, `.env` loading, dependency pins.
2. DB schema migrations (SQLite) and simple DAL helpers.
3. Typed config and validation (pydantic optional).

Phase 2 — Discord Ingestion
1. Connect gateway with Message Content intent; ignore bots.
2. Upsert channels/authors/messages; idempotent on `message_id`.
3. Backfill worker using `last_seen_message_id` per channel.

Phase 3 — Batching & LLM Interface
1. Token estimator + chunker.
2. `Summarizer` interface with provider adapters; JSON schema validation.
3. Map → Reduce orchestration and caching by content hash.

Phase 4 — Slack Notifier
1. Block templates; highlights + sections.
2. Posting and error handling; links to Discord messages.

Phase 5 — Scheduler & Windowing
1. APScheduler cron @ 05:00 PT.
2. Compute prior 24h window; log coverage counts.

Phase 6 — Quality, Privacy, Cost
1. Heuristics for feature/bug/unresolved.
2. Redaction pass; retention settings.
3. Budget guard + degradation strategy.

Phase 7 — Observability
1. Structured logs; basic counters (messages ingested, tokens used, cost estimate, failures).
2. Optional Slack alert for failures.

Phase 8 — Hardening & Rollout
1. Load test on sample channels; adjust chunk sizes.
2. Run shadow mode for a few days; compare digests to human expectations.
3. Enable posting to production Slack channel.

## 7) Open Questions
- LLM provider preference and budget constraints?
- Any channels to exclude or redact aggressively?
- Should deep dives always post, or only when thresholds are exceeded?

## 8) Appendix
- See `docs/reference/` for API endpoint and integration details (to be populated in Phase 0).

