#!/bin/bash

# DigestBot Backup Script
set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Create backup directory
create_backup_dir() {
    mkdir -p "$BACKUP_DIR"
    log_info "Backup directory: $BACKUP_DIR"
}

# Backup database
backup_database() {
    local db_file="$PROJECT_DIR/data/app.db"
    local backup_file="$BACKUP_DIR/database_$TIMESTAMP.db"
    
    if [[ -f "$db_file" ]]; then
        log_info "Backing up database..."
        cp "$db_file" "$backup_file"
        log_info "Database backed up to: $backup_file"
        
        # Compress the backup
        gzip "$backup_file"
        log_info "Database backup compressed: ${backup_file}.gz"
    else
        log_warn "Database file not found: $db_file"
    fi
}

# Backup logs
backup_logs() {
    local logs_dir="$PROJECT_DIR/logs"
    local backup_file="$BACKUP_DIR/logs_$TIMESTAMP.tar.gz"
    
    if [[ -d "$logs_dir" && -n "$(ls -A "$logs_dir" 2>/dev/null)" ]]; then
        log_info "Backing up logs..."
        tar -czf "$backup_file" -C "$PROJECT_DIR" logs/
        log_info "Logs backed up to: $backup_file"
    else
        log_warn "Logs directory not found or empty: $logs_dir"
    fi
}

# Backup configuration
backup_config() {
    local backup_file="$BACKUP_DIR/config_$TIMESTAMP.tar.gz"
    local config_files=()
    
    # Add configuration files if they exist
    [[ -f "$PROJECT_DIR/.env" ]] && config_files+=(".env")
    [[ -f "$PROJECT_DIR/docker-compose.yml" ]] && config_files+=("docker-compose.yml")
    [[ -f "$PROJECT_DIR/docker-compose.dev.yml" ]] && config_files+=("docker-compose.dev.yml")
    [[ -f "$PROJECT_DIR/Dockerfile" ]] && config_files+=("Dockerfile")
    
    if [[ ${#config_files[@]} -gt 0 ]]; then
        log_info "Backing up configuration files..."
        tar -czf "$backup_file" -C "$PROJECT_DIR" "${config_files[@]}"
        log_info "Configuration backed up to: $backup_file"
    else
        log_warn "No configuration files found to backup"
    fi
}

# Clean old backups
cleanup_old_backups() {
    local days_to_keep="${1:-30}"
    log_info "Cleaning up backups older than $days_to_keep days..."
    
    find "$BACKUP_DIR" -name "*.gz" -type f -mtime +$days_to_keep -delete
    log_info "Old backups cleaned up"
}

# Show backup summary
show_summary() {
    log_info "Backup Summary:"
    echo "=================="
    echo "Backup directory: $BACKUP_DIR"
    echo "Timestamp: $TIMESTAMP"
    echo ""
    echo "Backed up files:"
    ls -lh "$BACKUP_DIR"/*_$TIMESTAMP* 2>/dev/null || echo "No files found"
    echo ""
    echo "Total backup size:"
    du -sh "$BACKUP_DIR" 2>/dev/null || echo "0B"
}

# Main backup function
main() {
    log_info "Starting backup process..."
    
    cd "$PROJECT_DIR"
    
    create_backup_dir
    backup_database
    backup_logs
    backup_config
    cleanup_old_backups
    show_summary
    
    log_info "Backup completed successfully!"
}

# Handle command line arguments
case "${1:-}" in
    "cleanup")
        cleanup_old_backups "${2:-30}"
        ;;
    "summary")
        show_summary
        ;;
    *)
        main
        ;;
esac
