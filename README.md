# DigestBot - Discord to Slack Digest Service

A production-ready service that monitors Discord channels and generates AI-powered digests for Slack, designed for engineering teams to stay informed about important discussions and issues.

## Features

- **Real-time Discord Monitoring**: Continuously monitors specified Discord channels for new messages
- **AI-Powered Summarization**: Uses OpenAI/OpenRouter to generate intelligent summaries and identify key findings
- **Slack Integration**: Posts formatted digests to Slack channels with rich formatting
- **Scheduled Digests**: Configurable cron-based scheduling for regular digest generation
- **Health Monitoring**: Built-in health checks and monitoring capabilities
- **Production Ready**: Docker containerization, logging, error handling, and deployment scripts

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Discord Bot Token
- Slack Bot Token
- OpenRouter API Key (for AI summarization)

### 1. Clone and Setup

```bash
git clone <your-repo-url>
cd digestbot
cp env.example .env
```

### 2. Configure Environment

Edit `.env` file with your tokens and settings:

```bash
# Discord Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CHANNEL_ALLOWLIST=123456789,987654321

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
SLACK_TARGET_CHANNEL=#digest-channel

# LLM Configuration
OPENROUTER_API_KEY=sk-or-your-api-key-here
LLM_MODEL=openai/gpt-4o-mini

# Environment
ENVIRONMENT=production
```

### 3. Deploy

```bash
# Production deployment
./scripts/deploy.sh production

# Development deployment
./scripts/deploy.sh development
```

### 4. Monitor

```bash
# Check system health
./scripts/monitor.sh

# View logs
docker logs digestbot
```

## Configuration

### Environment Variables

| Variable                    | Description                            | Default               |
| --------------------------- | -------------------------------------- | --------------------- |
| `DISCORD_BOT_TOKEN`         | Discord bot token                      | Required              |
| `DISCORD_CHANNEL_ALLOWLIST` | Comma-separated channel IDs to monitor | Empty                 |
| `DISCORD_CHANNEL_DENYLIST`  | Comma-separated channel IDs to exclude | Empty                 |
| `SLACK_BOT_TOKEN`           | Slack bot token                        | Required              |
| `SLACK_TARGET_CHANNEL`      | Slack channel for digests              | Required              |
| `OPENROUTER_API_KEY`        | OpenRouter API key for LLM             | Required              |
| `LLM_MODEL`                 | LLM model to use                       | `openai/gpt-4o-mini`  |
| `DIGEST_CRON`               | Cron expression for scheduling         | `0 5 * * *`           |
| `TIMEZONE`                  | Timezone for scheduling                | `America/Los_Angeles` |
| `ENVIRONMENT`               | Environment (development/production)   | `development`         |

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable required intents:
   - Message Content Intent
   - Server Members Intent
6. Invite bot to your Discord server with appropriate permissions

### Slack Bot Setup

1. Go to [Slack API](https://api.slack.com/apps)
2. Create a new app
3. Go to "OAuth & Permissions"
4. Add bot scopes:
   - `chat:write`
   - `channels:read`
5. Install app to workspace
6. Copy the bot token (starts with `xoxb-`)

## Usage

### Command Line Interface

```bash
# Run the service
python -m digestbot run

# Generate a one-time digest
python -m digestbot digest-once

# Check system health
python -m digestbot health-check

# Use custom environment file
python -m digestbot run --env /path/to/.env
```

### Docker Commands

```bash
# Build image
docker build -t digestbot .

# Run container
docker run -d --name digestbot --env-file .env digestbot

# View logs
docker logs digestbot

# Execute commands in container
docker exec digestbot python -m digestbot health-check
```

## Architecture

### Components

- **Discord Ingestor**: Monitors Discord channels and stores messages
- **Digest Service**: Generates summaries and findings from stored messages
- **Scheduler**: Manages cron-based digest generation
- **Slack Notifier**: Posts formatted digests to Slack
- **Health Monitor**: Provides system health checks and monitoring
- **Database**: SQLite database with migration support

### Data Flow

1. Discord messages are captured and stored in the database
2. Scheduled digest generation processes messages within a time window
3. AI summarization generates channel summaries and identifies findings
4. Formatted digest is posted to Slack
5. Health checks monitor system status

## Monitoring and Maintenance

### Health Checks

The service includes comprehensive health checks:

- Database connectivity and performance
- Discord API connectivity
- Slack API connectivity
- LLM service connectivity
- Recent activity monitoring

### Logging

- Structured logging with configurable levels
- Log rotation in production
- Separate log files for different components
- Integration with monitoring systems

### Backup and Recovery

```bash
# Create backup
./scripts/backup.sh

# Clean old backups
./scripts/backup.sh cleanup 30  # Keep 30 days

# Show backup summary
./scripts/backup.sh summary
```

### Monitoring Scripts

```bash
# Full system check
./scripts/monitor.sh

# Quick health check
./scripts/monitor.sh quick

# Container status only
./scripts/monitor.sh containers

# System resources
./scripts/monitor.sh resources
```

## Development

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run in development mode
python -m digestbot run --env .env

# Run tests
pytest

# Code formatting
black src/
isort src/
```

### Docker Development

```bash
# Development with hot reload
docker-compose -f docker-compose.dev.yml up

# Build development image
docker-compose -f docker-compose.dev.yml build
```

### Database Migrations

The service includes a migration system for database schema updates:

```bash
# Migrations are automatically applied on startup
# Manual migration check
python -c "from src.digestbot.migrations import setup_database; import asyncio; asyncio.run(setup_database('data/app.db'))"
```

## Troubleshooting

### Common Issues

1. **Discord Bot Not Receiving Messages**

   - Check bot permissions and intents
   - Verify channel allowlist/denylist configuration
   - Ensure bot is invited to the server

2. **Slack Posts Failing**

   - Verify bot token and channel permissions
   - Check Slack API rate limits
   - Review error logs for specific issues

3. **LLM Summarization Issues**

   - Verify OpenRouter API key and model availability
   - Check token limits and usage
   - Review summarization logs

4. **Database Issues**
   - Check disk space and permissions
   - Verify database file integrity
   - Review migration logs

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=DEBUG
python -m digestbot run
```

### Log Analysis

```bash
# View recent errors
grep "ERROR" logs/digestbot.log | tail -20

# Monitor live logs
tail -f logs/digestbot.log

# Check specific component logs
docker logs digestbot 2>&1 | grep "discord_ingestor"
```

## Security Considerations

- Store sensitive tokens in environment variables
- Use non-root user in Docker containers
- Regularly rotate API tokens
- Monitor for unauthorized access
- Keep dependencies updated

## Performance Tuning

### Database Optimization

- Monitor database size and performance
- Consider archiving old messages
- Optimize queries for large datasets

### Resource Management

- Adjust memory limits for Docker containers
- Monitor CPU usage during peak times
- Scale horizontally if needed

### API Rate Limits

- Respect Discord and Slack rate limits
- Implement exponential backoff for retries
- Monitor API usage and costs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

[Add your license information here]

## Support

For issues and questions:

- Create an issue in the repository
- Check the troubleshooting section
- Review logs and health checks
