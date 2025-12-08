#!/bin/bash

# DigestBot Deployment Script
set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENVIRONMENT="${1:-production}"
DOCKER_COMPOSE_FILE="docker-compose.yml"

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

# Check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
}

# Check if .env file exists
check_env_file() {
    if [[ ! -f "$PROJECT_DIR/.env" ]]; then
        log_error ".env file not found. Please create it from env.example"
        log_info "cp env.example .env"
        log_info "Then edit .env with your configuration"
        exit 1
    fi
}

# Backup database
backup_database() {
    if [[ -f "$PROJECT_DIR/data/app.db" ]]; then
        log_info "Backing up database..."
        timestamp=$(date +"%Y%m%d_%H%M%S")
        cp "$PROJECT_DIR/data/app.db" "$PROJECT_DIR/data/app.db.backup.$timestamp"
        log_info "Database backed up to data/app.db.backup.$timestamp"
    fi
}

# Pull latest images
pull_images() {
    log_info "Pulling latest Docker images..."
    docker-compose -f "$PROJECT_DIR/$DOCKER_COMPOSE_FILE" pull
}

# Build application
build_app() {
    log_info "Building application..."
    docker-compose -f "$PROJECT_DIR/$DOCKER_COMPOSE_FILE" build --no-cache
}

# Deploy application
deploy_app() {
    log_info "Deploying application..."
    docker-compose -f "$PROJECT_DIR/$DOCKER_COMPOSE_FILE" up -d
}

# Wait for health check
wait_for_health() {
    log_info "Waiting for application to be healthy..."
    timeout=300  # 5 minutes
    elapsed=0
    
    while [[ $elapsed -lt $timeout ]]; do
        if docker-compose -f "$PROJECT_DIR/$DOCKER_COMPOSE_FILE" ps | grep -q "healthy"; then
            log_info "Application is healthy!"
            return 0
        fi
        
        sleep 10
        elapsed=$((elapsed + 10))
        log_info "Still waiting... (${elapsed}s elapsed)"
    done
    
    log_error "Application failed to become healthy within ${timeout}s"
    return 1
}

# Show logs
show_logs() {
    log_info "Showing recent logs..."
    docker-compose -f "$PROJECT_DIR/$DOCKER_COMPOSE_FILE" logs --tail=50
}

# Main deployment function
main() {
    log_info "Starting deployment for environment: $ENVIRONMENT"
    
    cd "$PROJECT_DIR"
    
    # Pre-deployment checks
    check_docker
    check_env_file
    
    # Backup existing database
    backup_database
    
    # Deploy
    pull_images
    build_app
    deploy_app
    
    # Wait for health check
    if wait_for_health; then
        log_info "Deployment completed successfully!"
        show_logs
    else
        log_error "Deployment failed!"
        show_logs
        exit 1
    fi
}

# Handle different environments
case "$ENVIRONMENT" in
    "development"|"dev")
        DOCKER_COMPOSE_FILE="docker-compose.dev.yml"
        main
        ;;
    "production"|"prod")
        main
        ;;
    *)
        log_error "Unknown environment: $ENVIRONMENT"
        log_info "Usage: $0 [development|production]"
        exit 1
        ;;
esac
