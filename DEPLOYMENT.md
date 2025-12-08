# Deployment Guide

This guide covers deploying DigestBot in production environments.

## Prerequisites

- Docker and Docker Compose installed
- Access to Discord and Slack APIs
- OpenRouter API access
- Basic knowledge of containerization and environment management

## Production Deployment

### 1. Environment Setup

Create production environment file:

```bash
cp env.example .env.production
```

Configure production settings:

```bash
# Production environment
ENVIRONMENT=production
LOG_LEVEL=INFO

# Database configuration
DATABASE_PATH=/app/data/app.db

# Discord configuration
DISCORD_BOT_TOKEN=your_production_discord_token
DISCORD_CHANNEL_ALLOWLIST=123456789,987654321

# Slack configuration
SLACK_BOT_TOKEN=xoxb-your-production-slack-token
SLACK_TARGET_CHANNEL=#engineering-digest

# LLM configuration
OPENROUTER_API_KEY=sk-or-your-production-api-key
LLM_MODEL=openai/gpt-4o-mini

# Scheduling
TIMEZONE=America/Los_Angeles
DIGEST_CRON=0 5 * * *
DIGEST_RUN_ON_START=true
DIGEST_WINDOW_HOURS=24
```

### 2. Security Configuration

#### Token Management

- Use environment variables for all sensitive data
- Never commit tokens to version control
- Rotate tokens regularly
- Use different tokens for different environments

#### Container Security

- Run containers as non-root user
- Use read-only filesystems where possible
- Limit container capabilities
- Use secrets management for sensitive data

### 3. Infrastructure Requirements

#### Minimum Requirements

- **CPU**: 1 vCPU
- **Memory**: 512MB RAM
- **Storage**: 10GB disk space
- **Network**: Internet access for APIs

#### Recommended Requirements

- **CPU**: 2 vCPUs
- **Memory**: 1GB RAM
- **Storage**: 50GB disk space
- **Network**: Stable internet connection

### 4. Deployment Steps

#### Using Deployment Script

```bash
# Deploy to production
./scripts/deploy.sh production

# Deploy to development
./scripts/deploy.sh development
```

#### Manual Deployment

```bash
# Build and deploy
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### 5. Post-Deployment Verification

#### Health Checks

```bash
# Run health check
./scripts/monitor.sh quick

# Full system check
./scripts/monitor.sh

# Check application health
docker exec digestbot python -m digestbot health-check
```

#### Verify Functionality

```bash
# Test digest generation
docker exec digestbot python -m digestbot digest-once

# Check recent activity
./scripts/monitor.sh logs
```

## Environment-Specific Configurations

### Development Environment

```bash
# Development settings
ENVIRONMENT=development
LOG_LEVEL=DEBUG
DIGEST_RUN_ON_START=true

# Use development Docker Compose
docker-compose -f docker-compose.dev.yml up
```

### Staging Environment

```bash
# Staging settings
ENVIRONMENT=staging
LOG_LEVEL=INFO
DIGEST_CRON=0 */6 * * *  # Every 6 hours

# Use production Docker Compose with staging config
docker-compose up -d
```

### Production Environment

```bash
# Production settings
ENVIRONMENT=production
LOG_LEVEL=INFO
DIGEST_CRON=0 5 * * *  # Daily at 5 AM

# Use production Docker Compose
docker-compose up -d
```

## Monitoring and Alerting

### Health Monitoring

The service includes built-in health checks:

- Database connectivity and performance
- API connectivity (Discord, Slack, LLM)
- Recent activity monitoring
- System resource usage

### Log Monitoring

```bash
# View application logs
docker logs digestbot

# Monitor live logs
docker logs -f digestbot

# Check error logs
grep "ERROR" logs/digestbot.log
```

### System Monitoring

```bash
# Check system resources
./scripts/monitor.sh resources

# Check container status
./scripts/monitor.sh containers

# Full monitoring report
./scripts/monitor.sh
```

### Alerting Integration

Configure alerts for:

- Container failures
- Health check failures
- High error rates
- Resource usage thresholds
- API rate limit warnings

## Backup and Recovery

### Automated Backups

```bash
# Create backup
./scripts/backup.sh

# Schedule regular backups (cron example)
0 2 * * * /path/to/digestbot/scripts/backup.sh
```

### Manual Backups

```bash
# Backup database only
cp data/app.db backups/database_$(date +%Y%m%d_%H%M%S).db

# Backup configuration
tar -czf backups/config_$(date +%Y%m%d_%H%M%S).tar.gz .env docker-compose.yml
```

### Recovery Procedures

#### Database Recovery

```bash
# Stop service
docker-compose down

# Restore database
cp backups/database_YYYYMMDD_HHMMSS.db data/app.db

# Start service
docker-compose up -d
```

#### Full System Recovery

```bash
# Stop service
docker-compose down

# Restore configuration
tar -xzf backups/config_YYYYMMDD_HHMMSS.tar.gz

# Restore database
cp backups/database_YYYYMMDD_HHMMSS.db data/app.db

# Start service
docker-compose up -d
```

## Scaling and Performance

### Horizontal Scaling

For high-volume environments:

1. **Load Balancing**: Use multiple instances with shared database
2. **Database Scaling**: Consider PostgreSQL for large datasets
3. **Caching**: Implement Redis for frequently accessed data
4. **Message Queues**: Use message queues for async processing

### Vertical Scaling

For performance optimization:

1. **Resource Allocation**: Increase CPU and memory limits
2. **Database Optimization**: Optimize queries and indexes
3. **Caching**: Implement application-level caching
4. **Connection Pooling**: Optimize database connections

### Performance Monitoring

```bash
# Monitor resource usage
docker stats

# Check database performance
docker exec digestbot sqlite3 /app/data/app.db "EXPLAIN QUERY PLAN SELECT * FROM messages WHERE created_at >= datetime('now', '-1 hour');"

# Monitor API usage
grep "API" logs/digestbot.log | tail -20
```

## Security Hardening

### Container Security

```bash
# Run with security options
docker run --security-opt=no-new-privileges \
           --read-only \
           --tmpfs /tmp \
           --user 1000:1000 \
           digestbot
```

### Network Security

- Use internal networks for container communication
- Implement firewall rules
- Use TLS for external communications
- Monitor network traffic

### Access Control

- Implement proper authentication
- Use role-based access control
- Monitor access logs
- Regular security audits

## Troubleshooting

### Common Deployment Issues

1. **Container Won't Start**

   - Check Docker logs: `docker logs digestbot`
   - Verify environment variables
   - Check resource availability

2. **Health Checks Failing**

   - Run manual health check: `docker exec digestbot python -m digestbot health-check`
   - Check API connectivity
   - Verify database access

3. **Performance Issues**

   - Monitor resource usage: `docker stats`
   - Check database performance
   - Review application logs

4. **API Errors**
   - Verify token validity
   - Check rate limits
   - Review API documentation

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=DEBUG
docker-compose up -d

# View debug logs
docker logs digestbot | grep DEBUG
```

### Emergency Procedures

#### Service Recovery

```bash
# Quick restart
docker-compose restart

# Full restart
docker-compose down && docker-compose up -d

# Reset to last known good state
docker-compose down
docker-compose up -d
```

#### Data Recovery

```bash
# Stop service
docker-compose down

# Restore from backup
./scripts/backup.sh

# Start service
docker-compose up -d
```

## Maintenance

### Regular Maintenance Tasks

1. **Weekly**: Review logs and health checks
2. **Monthly**: Update dependencies and security patches
3. **Quarterly**: Review and rotate API tokens
4. **Annually**: Security audit and penetration testing

### Update Procedures

```bash
# Update application
git pull
docker-compose build
docker-compose up -d

# Update dependencies
pip install -r requirements.txt
docker-compose build
```

### Cleanup Tasks

```bash
# Clean old logs
find logs/ -name "*.log" -mtime +30 -delete

# Clean old backups
./scripts/backup.sh cleanup 30

# Clean Docker images
docker system prune -a
```

## Support and Maintenance

### Monitoring Checklist

- [ ] Health checks passing
- [ ] Recent activity detected
- [ ] No critical errors in logs
- [ ] Resource usage within limits
- [ ] API connectivity verified

### Maintenance Checklist

- [ ] Regular backups completed
- [ ] Dependencies updated
- [ ] Security patches applied
- [ ] Performance metrics reviewed
- [ ] Documentation updated

### Emergency Contacts

- **Primary**: [Your contact information]
- **Secondary**: [Backup contact information]
- **Escalation**: [Management contact information]
