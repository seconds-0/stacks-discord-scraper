# API Reference

This document describes the APIs and integrations used by DigestBot.

## Discord API Integration

### Bot Permissions

Required Discord bot permissions:

- `Send Messages`: Post messages (if needed)
- `Read Message History`: Access message history
- `View Channels`: See channel information
- `Read Messages`: Read message content
- `Use Slash Commands`: For future command support

### Intents

Required Discord intents:

- `message_content`: Access message content
- `guilds`: Access server information
- `members`: Access member information

### Rate Limits

Discord API rate limits:

- **Global**: 50 requests per second
- **Per-channel**: 5 requests per second
- **Message creation**: 5 requests per second

### Error Handling

Common Discord API errors:

- `401 Unauthorized`: Invalid bot token
- `403 Forbidden`: Insufficient permissions
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Discord server error

## Slack API Integration

### Bot Scopes

Required Slack bot scopes:

- `chat:write`: Post messages to channels
- `channels:read`: Read channel information
- `chat:write.public`: Post to public channels
- `files:write`: Upload files (if needed)

### Rate Limits

Slack API rate limits:

- **Tier 1**: 1 request per second
- **Tier 2**: 20 requests per minute
- **Tier 3**: 50 requests per minute
- **Tier 4**: 100 requests per minute

### Message Formatting

Slack Block Kit format for rich messages:

```json
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "Discord Digest - 2024-01-15"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Summary of recent activity"
      }
    }
  ]
}
```

### Error Handling

Common Slack API errors:

- `invalid_auth`: Invalid bot token
- `account_inactive`: Bot account deactivated
- `channel_not_found`: Channel doesn't exist
- `rate_limited`: Rate limit exceeded
- `not_in_channel`: Bot not in channel

## OpenRouter API Integration

### Models

Supported models:

- `openai/gpt-4o-mini`: Fast, cost-effective
- `openai/gpt-4o`: More capable, higher cost
- `anthropic/claude-3-haiku`: Alternative option
- `google/gemini-pro`: Google's model

### Rate Limits

OpenRouter API rate limits:

- **Free tier**: 100 requests per day
- **Paid tier**: Based on subscription
- **Per-model**: Varies by model

### Request Format

```json
{
  "model": "openai/gpt-4o-mini",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant that summarizes Discord conversations."
    },
    {
      "role": "user",
      "content": "Summarize this conversation..."
    }
  ],
  "max_tokens": 2000,
  "temperature": 0.7
}
```

### Error Handling

Common OpenRouter API errors:

- `401 Unauthorized`: Invalid API key
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Service error
- `insufficient_quota`: Quota exceeded

## Database Schema

### Tables

#### `discord_servers`

```sql
CREATE TABLE discord_servers (
    server_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT
);
```

#### `channels`

```sql
CREATE TABLE channels (
    channel_id INTEGER PRIMARY KEY,
    server_id INTEGER NOT NULL REFERENCES discord_servers(server_id),
    name TEXT NOT NULL,
    is_thread INTEGER NOT NULL DEFAULT 0,
    parent_channel_id INTEGER,
    last_seen_message_id INTEGER,
    last_seen_at TEXT
);
```

#### `authors`

```sql
CREATE TABLE authors (
    author_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    is_bot INTEGER NOT NULL DEFAULT 0,
    role_hints TEXT,
    first_seen_at TEXT
);
```

#### `messages`

```sql
CREATE TABLE messages (
    message_id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(channel_id),
    author_id INTEGER NOT NULL REFERENCES authors(author_id),
    content TEXT,
    created_at TEXT NOT NULL,
    is_reply INTEGER NOT NULL DEFAULT 0,
    parent_message_id INTEGER,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT
);
```

#### `batches`

```sql
CREATE TABLE batches (
    batch_id INTEGER PRIMARY KEY AUTOINCREMENT,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    token_estimate INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'created',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

#### `summaries`

```sql
CREATE TABLE summaries (
    batch_id INTEGER PRIMARY KEY REFERENCES batches(batch_id),
    json_result TEXT NOT NULL,
    highlights_text TEXT,
    posted_to_slack_at TEXT,
    slack_ts TEXT
);
```

#### `findings`

```sql
CREATE TABLE findings (
    finding_id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(batch_id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT,
    confidence REAL,
    first_message_id INTEGER,
    message_ids_json TEXT,
    channel_id INTEGER,
    channel_name TEXT,
    status TEXT,
    tags_json TEXT
);
```

## Health Check API

### Endpoints

#### `health-check`

```bash
python -m digestbot health-check
```

Returns:

```json
{
  "overall_status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "checks": [
    {
      "name": "database_connectivity",
      "status": "healthy",
      "message": "Database connection successful",
      "duration_ms": 15,
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Health Check Types

1. **database_connectivity**: Database connection test
2. **database_performance**: Database performance metrics
3. **discord_connectivity**: Discord API connectivity
4. **slack_connectivity**: Slack API connectivity
5. **llm_connectivity**: LLM service connectivity
6. **recent_activity**: Recent system activity

### Status Values

- `healthy`: Component is working correctly
- `warning`: Component has issues but is functional
- `critical`: Component has critical issues
- `unknown`: Component status cannot be determined

## Configuration API

### Environment Variables

#### Core Configuration

- `ENVIRONMENT`: Environment (development/staging/production)
- `LOG_LEVEL`: Logging level (DEBUG/INFO/WARNING/ERROR)
- `DATABASE_PATH`: Database file path

#### Discord Configuration

- `DISCORD_BOT_TOKEN`: Discord bot token
- `DISCORD_CHANNEL_ALLOWLIST`: Comma-separated channel IDs
- `DISCORD_CHANNEL_DENYLIST`: Comma-separated channel IDs to exclude
- `DISCORD_INITIAL_BACKFILL_LIMIT`: Initial message backfill limit

#### Slack Configuration

- `SLACK_BOT_TOKEN`: Slack bot token
- `SLACK_TARGET_CHANNEL`: Target Slack channel
- `SLACK_POST_ENABLED`: Enable/disable Slack posting

#### LLM Configuration

- `OPENROUTER_API_KEY`: OpenRouter API key
- `LLM_MODEL`: LLM model to use
- `LLM_ENABLED`: Enable/disable LLM features
- `LLM_MAX_OUTPUT_TOKENS`: Maximum output tokens

#### Scheduling Configuration

- `TIMEZONE`: Timezone for scheduling
- `DIGEST_CRON`: Cron expression for digest scheduling
- `DIGEST_RUN_ON_START`: Run digest on startup
- `DIGEST_WINDOW_HOURS`: Digest window in hours

## Error Codes

### Application Errors

- `CONFIG_ERROR`: Configuration validation error
- `DATABASE_ERROR`: Database operation error
- `DISCORD_ERROR`: Discord API error
- `SLACK_ERROR`: Slack API error
- `LLM_ERROR`: LLM API error
- `SCHEDULER_ERROR`: Scheduler error
- `DIGEST_ERROR`: Digest generation error

### HTTP Status Codes

- `200 OK`: Success
- `400 Bad Request`: Invalid request
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Access denied
- `404 Not Found`: Resource not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

## Rate Limiting

### Implementation

The service implements exponential backoff with jitter:

```python
@retry_async(config=STANDARD_RETRY, exceptions=(SlackApiError,))
async def post_digest(self, digest: DigestResult, findings: List[Finding]):
    # Implementation with retry logic
```

### Retry Configuration

- **Max Attempts**: 3
- **Base Delay**: 1.0 seconds
- **Max Delay**: 30.0 seconds
- **Exponential Base**: 2.0
- **Jitter**: Enabled

## Monitoring and Metrics

### Application Metrics

- Message processing rate
- Digest generation time
- API response times
- Error rates
- Database performance

### System Metrics

- CPU usage
- Memory usage
- Disk usage
- Network I/O
- Container health

### Logging

#### Log Levels

- `DEBUG`: Detailed debugging information
- `INFO`: General information
- `WARNING`: Warning messages
- `ERROR`: Error messages
- `CRITICAL`: Critical errors

#### Log Format

```
2024-01-15 10:30:00 | INFO | digestbot.discord_ingestor | Connected to Discord
```

#### Log Rotation

- **Max File Size**: 10MB
- **Backup Count**: 5 files
- **Rotation**: Automatic

## Security Considerations

### Authentication

- Use environment variables for sensitive data
- Rotate API tokens regularly
- Implement proper access controls
- Monitor for unauthorized access

### Data Protection

- Encrypt sensitive data at rest
- Use TLS for data in transit
- Implement proper backup procedures
- Follow data retention policies

### API Security

- Validate all inputs
- Implement rate limiting
- Use proper error handling
- Monitor for suspicious activity

## Troubleshooting

### Common Issues

1. **API Rate Limits**: Implement exponential backoff
2. **Authentication Errors**: Verify tokens and permissions
3. **Network Issues**: Check connectivity and firewall rules
4. **Database Errors**: Verify database file and permissions
5. **Memory Issues**: Monitor resource usage and limits

### Debug Information

Enable debug logging:

```bash
export LOG_LEVEL=DEBUG
python -m digestbot run
```

### Performance Tuning

- Optimize database queries
- Implement caching
- Use connection pooling
- Monitor resource usage
- Scale horizontally if needed
