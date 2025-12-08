#!/bin/bash

# DigestBot Monitoring Script
set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# Check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running"
        return 1
    fi
    return 0
}

# Check container status
check_containers() {
    log_info "Checking container status..."
    
    local containers=("digestbot" "digestbot-redis")
    local all_healthy=true
    
    for container in "${containers[@]}"; do
        if docker ps --filter "name=$container" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -q "$container"; then
            local status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")
            case "$status" in
                "healthy")
                    log_info "✅ $container: $status"
                    ;;
                "unhealthy")
                    log_error "❌ $container: $status"
                    all_healthy=false
                    ;;
                "starting")
                    log_warn "🔄 $container: $status"
                    ;;
                *)
                    log_warn "❓ $container: $status"
                    ;;
            esac
        else
            log_error "❌ $container: not running"
            all_healthy=false
        fi
    done
    
    if $all_healthy; then
        log_info "All containers are healthy"
        return 0
    else
        log_error "Some containers are not healthy"
        return 1
    fi
}

# Check application health
check_app_health() {
    log_info "Checking application health..."
    
    if docker exec digestbot python -m digestbot health-check >/dev/null 2>&1; then
        log_info "✅ Application health check passed"
        return 0
    else
        log_error "❌ Application health check failed"
        return 1
    fi
}

# Check disk usage
check_disk_usage() {
    log_info "Checking disk usage..."
    
    local data_dir="$PROJECT_DIR/data"
    local logs_dir="$PROJECT_DIR/logs"
    
    if [[ -d "$data_dir" ]]; then
        local db_size=$(du -sh "$data_dir" 2>/dev/null | cut -f1)
        log_info "Database size: $db_size"
        
        # Check if database is getting too large (> 1GB)
        local db_size_bytes=$(du -s "$data_dir" 2>/dev/null | cut -f1)
        if [[ $db_size_bytes -gt 1048576 ]]; then  # 1GB in KB
            log_warn "⚠️ Database is getting large (> 1GB)"
        fi
    fi
    
    if [[ -d "$logs_dir" ]]; then
        local logs_size=$(du -sh "$logs_dir" 2>/dev/null | cut -f1)
        log_info "Logs size: $logs_size"
    fi
}

# Check recent activity
check_recent_activity() {
    log_info "Checking recent activity..."
    
    # Check for recent log entries
    local log_file="$PROJECT_DIR/logs/digestbot.log"
    if [[ -f "$log_file" ]]; then
        local recent_errors=$(tail -n 100 "$log_file" | grep -c "ERROR" || echo "0")
        local recent_warnings=$(tail -n 100 "$log_file" | grep -c "WARNING" || echo "0")
        
        log_info "Recent errors: $recent_errors"
        log_info "Recent warnings: $recent_warnings"
        
        if [[ $recent_errors -gt 5 ]]; then
            log_warn "⚠️ High number of recent errors detected"
        fi
    fi
    
    # Check for recent database activity
    if docker exec digestbot sqlite3 /app/data/app.db "SELECT COUNT(*) FROM messages WHERE created_at >= datetime('now', '-1 hour');" 2>/dev/null | grep -q "[0-9]"; then
        local recent_messages=$(docker exec digestbot sqlite3 /app/data/app.db "SELECT COUNT(*) FROM messages WHERE created_at >= datetime('now', '-1 hour');" 2>/dev/null)
        log_info "Recent messages (last hour): $recent_messages"
    fi
}

# Show system resources
show_system_resources() {
    log_info "System resources:"
    
    # Docker stats
    echo "Docker container stats:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" | head -10
    
    echo ""
    echo "System memory:"
    free -h
    
    echo ""
    echo "Disk usage:"
    df -h | grep -E "(Filesystem|/dev/)"
}

# Show recent logs
show_recent_logs() {
    log_info "Recent logs (last 20 lines):"
    echo "================================"
    
    if docker logs --tail 20 digestbot 2>/dev/null; then
        echo ""
    else
        log_error "Failed to retrieve logs"
    fi
}

# Send alert (placeholder for integration with monitoring systems)
send_alert() {
    local message="$1"
    local severity="${2:-warning}"
    
    log_warn "ALERT [$severity]: $message"
    
    # Here you could integrate with:
    # - Slack webhook
    # - Email notifications
    # - PagerDuty
    # - Custom monitoring system
    
    # Example Slack webhook (uncomment and configure):
    # curl -X POST -H 'Content-type: application/json' \
    #     --data "{\"text\":\"🚨 DigestBot Alert: $message\"}" \
    #     "$SLACK_WEBHOOK_URL"
}

# Main monitoring function
main() {
    log_info "Starting DigestBot monitoring..."
    
    cd "$PROJECT_DIR"
    
    local overall_status="healthy"
    
    # Run checks
    if ! check_docker; then
        overall_status="critical"
        send_alert "Docker is not running" "critical"
    fi
    
    if ! check_containers; then
        overall_status="warning"
        send_alert "Container health issues detected" "warning"
    fi
    
    if ! check_app_health; then
        overall_status="critical"
        send_alert "Application health check failed" "critical"
    fi
    
    check_disk_usage
    check_recent_activity
    
    # Show resources and logs
    show_system_resources
    show_recent_logs
    
    # Summary
    echo ""
    log_info "Monitoring Summary:"
    echo "==================="
    case "$overall_status" in
        "healthy")
            log_info "✅ Overall status: HEALTHY"
            ;;
        "warning")
            log_warn "⚠️ Overall status: WARNING"
            ;;
        "critical")
            log_error "❌ Overall status: CRITICAL"
            ;;
    esac
    
    return 0
}

# Handle command line arguments
case "${1:-}" in
    "containers")
        check_containers
        ;;
    "health")
        check_app_health
        ;;
    "resources")
        show_system_resources
        ;;
    "logs")
        show_recent_logs
        ;;
    "quick")
        check_docker && check_containers && check_app_health
        ;;
    *)
        main
        ;;
esac
