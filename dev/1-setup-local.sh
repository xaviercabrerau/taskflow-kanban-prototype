#!/bin/bash

################################################################################
# TaskFlow Notification System - Local Development Setup
#
# This script automates the complete local development environment setup.
# It's safe to re-run and will skip already-completed steps.
#
# Usage: ./dev/1-setup-local.sh [--skip-docker] [--skip-redis] [--headless]
#
# Options:
#   --skip-docker    Skip Docker/Supabase setup (if already running)
#   --skip-redis     Skip Redis setup
#   --headless       Don't open browser at end
################################################################################

set -euo pipefail

# ============================================================================
# Color Codes & Formatting
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Status symbols
CHECK_MARK="✓"
CROSS_MARK="✗"
WARNING_MARK="⚠"
ARROW_MARK="→"

# ============================================================================
# Logging Functions
# ============================================================================

log_info() {
  echo -e "${BLUE}${ARROW_MARK}${NC} $1"
}

log_success() {
  echo -e "${GREEN}${CHECK_MARK}${NC} $1"
}

log_error() {
  echo -e "${RED}${CROSS_MARK}${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}${WARNING_MARK}${NC} $1"
}

log_header() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}${1}${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_section() {
  echo ""
  echo -e "${CYAN}[${1}]${NC}"
}

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_LOCAL_FILE="${PROJECT_ROOT}/.env.local"
ENV_EXAMPLE_FILE="${PROJECT_ROOT}/.env.example"

# Parse command line arguments
SKIP_DOCKER=false
SKIP_REDIS=false
HEADLESS=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-docker) SKIP_DOCKER=true; shift ;;
    --skip-redis) SKIP_REDIS=true; shift ;;
    --headless) HEADLESS=true; shift ;;
    *) log_error "Unknown option: $1"; exit 1 ;;
  esac
done

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
  OS_TYPE="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  OS_TYPE="linux"
else
  OS_TYPE="unknown"
fi

# ============================================================================
# Utility Functions
# ============================================================================

# Ask user for confirmation
ask_yes_no() {
  local prompt="$1"
  local default="${2:-y}"

  if [[ "$default" == "y" ]]; then
    echo -n -e "${CYAN}${prompt} (Y/n)${NC} "
  else
    echo -n -e "${CYAN}${prompt} (y/N)${NC} "
  fi

  read -r response
  response=${response:-$default}

  [[ "$response" =~ ^[Yy]$ ]]
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check Node.js version
check_node_version() {
  if ! command_exists node; then
    return 1
  fi

  local version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  [[ $version -ge 18 ]]
}

# Generate random string
generate_random_key() {
  local length=${1:-32}
  openssl rand -hex $((length / 2)) 2>/dev/null || head -c $length /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# Check if .env.local exists and has value for key
env_has_value() {
  local key="$1"
  [[ -f "$ENV_LOCAL_FILE" ]] && grep -q "^${key}=" "$ENV_LOCAL_FILE"
}

# Set env value (create or update)
set_env_value() {
  local key="$1"
  local value="$2"

  if [[ -f "$ENV_LOCAL_FILE" ]]; then
    if grep -q "^${key}=" "$ENV_LOCAL_FILE"; then
      # Update existing
      if [[ "$OS_TYPE" == "macos" ]]; then
        sed -i '' "s|^${key}=.*|${key}=${value}|" "$ENV_LOCAL_FILE"
      else
        sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_LOCAL_FILE"
      fi
    else
      # Append new
      echo "${key}=${value}" >> "$ENV_LOCAL_FILE"
    fi
  else
    # Create new file
    echo "${key}=${value}" > "$ENV_LOCAL_FILE"
  fi
}

# ============================================================================
# STEP 1: Check Prerequisites
# ============================================================================

check_prerequisites() {
  log_header "STEP 1: Checking Prerequisites"

  local all_good=true

  # Check Node.js
  log_section "Node.js"
  if command_exists node; then
    local node_version=$(node -v)
    log_success "Found Node.js: ${node_version}"

    if ! check_node_version; then
      log_error "Node.js 18+ required, found $node_version"
      all_good=false
    fi
  else
    log_error "Node.js not found. Please install Node.js 18+ from https://nodejs.org"
    all_good=false
  fi

  # Check npm/pnpm
  log_section "Package Manager"
  if command_exists pnpm; then
    log_success "Found pnpm: $(pnpm -v)"
    PACKAGE_MANAGER="pnpm"
  elif command_exists npm; then
    log_success "Found npm: $(npm -v)"
    PACKAGE_MANAGER="npm"
  else
    log_error "Neither npm nor pnpm found. Please install npm (comes with Node.js)"
    all_good=false
  fi

  # Check Git
  log_section "Git"
  if command_exists git; then
    log_success "Found Git: $(git --version)"
  else
    log_error "Git not found. Please install Git from https://git-scm.com"
    all_good=false
  fi

  # Check Docker (optional)
  log_section "Docker (Optional)"
  if command_exists docker; then
    log_success "Found Docker: $(docker --version)"
  else
    log_warning "Docker not found (optional). Some features may not work."
    if [[ "$SKIP_DOCKER" != "true" ]]; then
      log_info "You can install Docker from https://www.docker.com/products/docker-desktop"
    fi
  fi

  if [[ "$all_good" == "false" ]]; then
    log_error "Please install missing prerequisites above"
    exit 1
  fi
}

# ============================================================================
# STEP 2: Repository Setup
# ============================================================================

setup_repository() {
  log_header "STEP 2: Repository Setup"

  log_section "Checking repository"

  if [[ ! -d "${PROJECT_ROOT}/.git" ]]; then
    log_error "Not a git repository. Please clone the repo first:"
    echo "  git clone <repo-url> taskflow-kanban-prototype"
    exit 1
  fi

  log_success "Repository found at ${PROJECT_ROOT}"

  # Verify on main branch
  cd "$PROJECT_ROOT"
  local current_branch=$(git rev-parse --abbrev-ref HEAD)

  if [[ "$current_branch" != "main" ]]; then
    log_warning "Currently on branch '$current_branch', not 'main'"
    if ask_yes_no "Switch to main branch?"; then
      git checkout main 2>/dev/null || log_warning "Could not checkout main"
    fi
  else
    log_success "On main branch"
  fi

  # Pull latest
  log_section "Pulling latest changes"
  if git pull origin main 2>/dev/null; then
    log_success "Updated from remote"
  else
    log_warning "Could not pull from remote (may be offline)"
  fi

  # Check for submodules
  if [[ -f "${PROJECT_ROOT}/.gitmodules" ]]; then
    log_section "Initializing submodules"
    if git submodule update --init --recursive 2>/dev/null; then
      log_success "Submodules initialized"
    else
      log_warning "Could not initialize submodules"
    fi
  fi
}

# ============================================================================
# STEP 3: Install Dependencies
# ============================================================================

install_dependencies() {
  log_header "STEP 3: Installing Dependencies"

  cd "$PROJECT_ROOT"

  log_section "Node.js packages"
  if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
    log_info "Using pnpm install..."
    pnpm install
  else
    log_info "Using npm install..."
    npm install
  fi
  log_success "Node.js dependencies installed"

  # Install Supabase CLI
  log_section "Supabase CLI"
  if command_exists supabase; then
    log_success "Supabase CLI already installed: $(supabase --version)"
  else
    log_info "Installing Supabase CLI..."
    if [[ "$OS_TYPE" == "macos" ]]; then
      brew install supabase/tap/supabase || npm install -g supabase
    else
      npm install -g supabase
    fi
    log_success "Supabase CLI installed"
  fi

  # Install Redis CLI (optional)
  if [[ "$SKIP_REDIS" != "true" ]]; then
    log_section "Redis CLI"
    if command_exists redis-cli; then
      log_success "Redis CLI already installed"
    else
      log_warning "Redis CLI not found (optional, needed to debug Redis)"
      if ask_yes_no "Install Redis CLI?"; then
        if [[ "$OS_TYPE" == "macos" ]]; then
          brew install redis || log_warning "Could not install redis-cli"
        else
          sudo apt-get install -y redis-tools || log_warning "Could not install redis-cli"
        fi
      fi
    fi
  fi
}

# ============================================================================
# STEP 4: Environment Configuration
# ============================================================================

setup_environment() {
  log_header "STEP 4: Environment Configuration"

  cd "$PROJECT_ROOT"

  log_section "Setting up .env.local"

  # Check if .env.local exists
  if [[ -f "$ENV_LOCAL_FILE" ]]; then
    log_success ".env.local already exists"

    if ask_yes_no "Regenerate environment variables?"; then
      rm "$ENV_LOCAL_FILE"
    else
      log_info "Keeping existing .env.local (you can edit manually later)"
      return
    fi
  fi

  # Start with .env.example if it exists
  if [[ -f "$ENV_EXAMPLE_FILE" ]]; then
    log_info "Copying .env.example to .env.local..."
    cp "$ENV_EXAMPLE_FILE" "$ENV_LOCAL_FILE"
    log_success "Copied .env.example"
  else
    log_info "Creating .env.local..."
    touch "$ENV_LOCAL_FILE"
  fi

  # Generate/set environment variables
  log_section "Generating local values"

  # NEXT_PUBLIC_SUPABASE_URL
  local supabase_url="http://127.0.0.1:54321"
  set_env_value "NEXT_PUBLIC_SUPABASE_URL" "$supabase_url"
  log_success "NEXT_PUBLIC_SUPABASE_URL = $supabase_url"

  # NEXT_PUBLIC_SUPABASE_ANON_KEY
  local anon_key="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ldGUiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYxNzAwNjIwMCwiZXhwIjo5OTk5OTk5OTk5fQ.XXXXXXXXXXXX"
  set_env_value "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$anon_key"
  log_success "NEXT_PUBLIC_SUPABASE_ANON_KEY configured (from Supabase local)"

  # SUPABASE_SERVICE_ROLE_KEY
  local service_key="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ldGUiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjE3MDA2MjAwLCJleHAiOjk5OTk5OTk5OTl9.XXXXXXXXXXXX"
  set_env_value "SUPABASE_SERVICE_ROLE_KEY" "$service_key"
  log_success "SUPABASE_SERVICE_ROLE_KEY configured"

  # REDIS_URL
  local redis_url="redis://localhost:6379"
  set_env_value "REDIS_URL" "$redis_url"
  log_success "REDIS_URL = $redis_url"

  # STAFF_API_KEY
  local staff_api_key=$(generate_random_key 32)
  set_env_value "STAFF_API_KEY" "$staff_api_key"
  log_success "STAFF_API_KEY generated (random)"

  # GMAIL_SERVICE_ACCOUNT_JSON (dummy for dev)
  local gmail_json='{
    "type": "service_account",
    "project_id": "taskflow-dev",
    "private_key_id": "dev-key-id",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCxxxxxxxxxxx\n-----END PRIVATE KEY-----\n",
    "client_email": "taskflow@taskflow-dev.iam.gserviceaccount.com",
    "client_id": "123456789",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/taskflow%40taskflow-dev.iam.gserviceaccount.com"
  }'
  set_env_value "GMAIL_SERVICE_ACCOUNT_JSON" "$gmail_json"
  log_success "GMAIL_SERVICE_ACCOUNT_JSON configured (dummy dev key)"

  # Add any other env vars from .env.example if not already set
  if [[ -f "$ENV_EXAMPLE_FILE" ]]; then
    while IFS='=' read -r key value; do
      # Skip comments and empty lines
      [[ "$key" =~ ^[[:space:]]*# ]] && continue
      [[ -z "$key" ]] && continue

      # If key not in .env.local, add it
      if ! env_has_value "$key"; then
        set_env_value "$key" "$value"
      fi
    done < "$ENV_EXAMPLE_FILE"
  fi

  log_success ".env.local configuration complete"
  log_info "You can edit ${ENV_LOCAL_FILE} to customize values"
}

# ============================================================================
# STEP 5: Database Setup
# ============================================================================

setup_database() {
  if [[ "$SKIP_DOCKER" == "true" ]]; then
    log_header "STEP 5: Database Setup (SKIPPED)"
    log_warning "Skipping database setup. Make sure Supabase is running!"
    return
  fi

  log_header "STEP 5: Database Setup"

  if ! command_exists docker; then
    log_error "Docker not found. Cannot start Supabase."
    log_info "Please install Docker or use --skip-docker if already running"
    return
  fi

  cd "$PROJECT_ROOT"

  log_section "Starting Supabase"

  # Check if already running
  if docker ps 2>/dev/null | grep -q supabase; then
    log_success "Supabase is already running"
  else
    log_info "Starting Supabase local stack..."
    if supabase start 2>&1; then
      log_success "Supabase started"
      sleep 3  # Wait for services to be ready
    else
      log_error "Failed to start Supabase"
      log_info "Troubleshooting: Check Docker is running (docker info)"
      return
    fi
  fi

  # Apply migrations
  log_section "Applying database migrations"
  if [[ -d "${PROJECT_ROOT}/supabase/migrations" ]]; then
    log_info "Found migrations directory"

    if ask_yes_no "Reset database and apply migrations? (This deletes local data)"; then
      if supabase db reset 2>&1; then
        log_success "Database migrations applied"
      else
        log_warning "Database reset had issues (database may still be ready)"
      fi
    fi
  else
    log_warning "No migrations directory found"
  fi

  # Seed test data (if available)
  log_section "Loading test data"
  if [[ -f "${PROJECT_ROOT}/supabase/seed.sql" ]]; then
    if ask_yes_no "Load test data (seed database)?"; then
      if supabase db push < "${PROJECT_ROOT}/supabase/seed.sql" 2>&1; then
        log_success "Test data loaded"
      else
        log_warning "Could not load test data (may not have seed.sql in proper format)"
      fi
    fi
  else
    log_info "No seed.sql file found (skipping test data)"
  fi
}

# ============================================================================
# STEP 6: Redis Setup
# ============================================================================

setup_redis() {
  if [[ "$SKIP_REDIS" == "true" ]]; then
    log_header "STEP 6: Redis Setup (SKIPPED)"
    log_warning "Skipping Redis setup. Make sure Redis is running on localhost:6379!"
    return
  fi

  log_header "STEP 6: Redis Setup"

  # Check if Redis is already running
  log_section "Checking Redis"

  if command_exists redis-cli; then
    if redis-cli ping >/dev/null 2>&1; then
      log_success "Redis is already running on localhost:6379"
      return
    fi
  fi

  log_info "Starting Redis..."

  if command_exists docker; then
    log_section "Using Docker for Redis"

    # Check if Redis container exists and is running
    if docker ps 2>/dev/null | grep -q "redis"; then
      log_success "Redis Docker container already running"
    else
      if docker ps -a 2>/dev/null | grep -q "redis"; then
        log_info "Starting existing Redis container..."
        docker start taskflow-redis 2>/dev/null || log_warning "Could not start container"
      else
        log_info "Creating and starting Redis container..."
        docker run -d --name taskflow-redis -p 6379:6379 redis:7-alpine || log_warning "Could not create Redis container"
      fi
    fi

    # Verify
    sleep 1
    if command_exists redis-cli && redis-cli ping >/dev/null 2>&1; then
      log_success "Redis is running"
    else
      log_warning "Redis may not be ready yet. Try again in a moment."
    fi
  else
    log_section "Using system redis-server"

    if command_exists redis-server; then
      # Check if already running
      if ! pgrep -x "redis-server" > /dev/null 2>&1; then
        log_info "Starting redis-server..."
        redis-server --daemonize yes --loglevel warning || log_warning "Could not start redis-server"
      else
        log_success "redis-server is already running"
      fi
    else
      log_error "Redis not installed and Docker not available"
      log_info "Install with: brew install redis (macOS) or sudo apt-get install redis-server (Linux)"
      return
    fi
  fi

  log_success "Redis setup complete"
}

# ============================================================================
# STEP 7: Verification
# ============================================================================

verify_setup() {
  log_header "STEP 7: Verification"

  cd "$PROJECT_ROOT"

  local all_good=true

  # Check Node.js
  log_section "Node.js"
  if command_exists node; then
    log_success "Node.js $(node -v)"
  else
    log_error "Node.js not found"
    all_good=false
  fi

  # Check npm/pnpm
  log_section "Package Manager"
  if command_exists $PACKAGE_MANAGER; then
    log_success "$PACKAGE_MANAGER ready"
  else
    log_error "$PACKAGE_MANAGER not found"
    all_good=false
  fi

  # Check .env.local
  log_section "Environment"
  if [[ -f "$ENV_LOCAL_FILE" ]]; then
    log_success ".env.local exists"
    local var_count=$(grep -c "^[A-Z_]*=" "$ENV_LOCAL_FILE" 2>/dev/null || echo 0)
    log_info "  → $var_count environment variables configured"
  else
    log_error ".env.local not found"
    all_good=false
  fi

  # Check Supabase
  if [[ "$SKIP_DOCKER" != "true" ]]; then
    log_section "Supabase"
    if docker ps 2>/dev/null | grep -q supabase; then
      log_success "Supabase containers running"
    else
      log_warning "Supabase not running (use: supabase start)"
    fi
  fi

  # Check Redis
  if [[ "$SKIP_REDIS" != "true" ]]; then
    log_section "Redis"
    if command_exists redis-cli && redis-cli ping >/dev/null 2>&1; then
      log_success "Redis is running"
    else
      log_warning "Redis not responding (use: docker start taskflow-redis)"
    fi
  fi

  echo ""

  if [[ "$all_good" == "true" ]]; then
    log_success "All checks passed!"
  else
    log_warning "Some checks failed. Review above."
  fi
}

# ============================================================================
# STEP 8: Quick Test Run (optional)
# ============================================================================

run_quick_tests() {
  if ! ask_yes_no "Run quick tests?"; then
    return
  fi

  log_header "Running Quick Tests"

  cd "$PROJECT_ROOT"

  log_section "Unit tests"
  if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
    pnpm test --run 2>/dev/null || log_warning "Tests had failures"
  else
    npm test -- --watchAll=false 2>/dev/null || log_warning "Tests had failures"
  fi

  log_success "Test run complete"
}

# ============================================================================
# STEP 9: Start Dev Server (optional)
# ============================================================================

start_dev_server() {
  if ! ask_yes_no "Start development server?"; then
    return
  fi

  log_header "Starting Development Server"

  cd "$PROJECT_ROOT"

  log_section "Launching Next.js dev server..."
  log_info "The dev server will run in the background."
  log_info "View logs with: tail -f .dev-server.log"
  log_info "Stop with: pkill -f 'next dev'"

  if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
    pnpm dev > .dev-server.log 2>&1 &
  else
    npm run dev > .dev-server.log 2>&1 &
  fi

  local dev_pid=$!
  sleep 2

  if kill -0 $dev_pid 2>/dev/null; then
    log_success "Dev server started (PID: $dev_pid)"
  else
    log_error "Dev server failed to start. Check .dev-server.log"
    return
  fi

  # Wait a bit for server to be ready
  sleep 3

  log_section "Waiting for server..."
  local max_attempts=15
  local attempt=0

  while [[ $attempt -lt $max_attempts ]]; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
      log_success "Dev server ready at http://localhost:3000"

      if [[ "$HEADLESS" != "true" ]]; then
        if ask_yes_no "Open browser?"; then
          if [[ "$OS_TYPE" == "macos" ]]; then
            open http://localhost:3000
          elif command_exists xdg-open; then
            xdg-open http://localhost:3000
          else
            log_info "Open http://localhost:3000 in your browser"
          fi
        fi
      fi
      return
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  log_warning "Server may still be starting. Check http://localhost:3000 in a moment"
  log_info "View logs with: tail -f .dev-server.log"
}

# ============================================================================
# STEP 10: Post-Setup Information
# ============================================================================

print_post_setup_info() {
  log_header "Setup Complete!"

  cat << 'EOF'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 NEXT STEPS:

  1. Start the dev server (if not already running):
     npm run dev

  2. Open in browser:
     http://localhost:3000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛑 STOPPING SERVICES:

  • Stop dev server:
    pkill -f "next dev"

  • Stop Supabase:
    supabase stop

  • Stop Redis:
    docker stop taskflow-redis
    OR pkill redis-server

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 RESETTING THE DATABASE:

  • Reset database (delete all data, apply migrations):
    supabase db reset

  • View database GUI:
    supabase studio
    Then navigate to http://localhost:54323 in browser

  • Access database directly:
    supabase db shell

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 USEFUL DEVELOPMENT COMMANDS:

  # Run linter
  npm run lint

  # Format code
  npm run format

  # Run tests
  npm test

  # Build for production
  npm run build

  # View dev server logs
  tail -f .dev-server.log

  # Check Redis connection
  redis-cli ping

  # View environment variables
  cat .env.local | sort

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🐛 TROUBLESHOOTING:

  Problem: "Cannot find module" errors
  → Run: npm install (or pnpm install)
  → Clear cache: rm -rf node_modules .next

  Problem: "ECONNREFUSED" on Supabase/Redis
  → Check running services: docker ps
  → Restart: supabase start (or docker start taskflow-redis)

  Problem: Port 3000 already in use
  → Kill process: lsof -ti:3000 | xargs kill -9
  → Or use: npm run dev -- -p 3001

  Problem: Environment variables not loading
  → Verify .env.local exists and has values
  → Restart dev server (kill and run again)
  → Check: cat .env.local

  Problem: Database migrations failed
  → Check Supabase status: supabase status
  → View logs: docker logs supabase_db
  → Reset: supabase db reset

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📖 DOCUMENTATION:

  • Project README: README.md
  • API Documentation: docs/api/
  • Database Schema: supabase/schema.sql
  • Environment Variables: .env.example

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Happy coding! If you need help, check the docs or ask the team.

EOF
}

# ============================================================================
# Main Setup Flow
# ============================================================================

main() {
  clear

  log_header "TaskFlow Notification System - Local Setup"

  echo ""
  echo "This script will set up your development environment with:"
  echo "  • Node.js dependencies"
  echo "  • Supabase (database)"
  echo "  • Redis (caching)"
  echo "  • Environment configuration"
  echo "  • Database migrations & seed data"
  echo ""
  echo "It's safe to run multiple times and will skip completed steps."
  echo ""

  if ! ask_yes_no "Continue with setup?"; then
    log_info "Setup cancelled"
    exit 0
  fi

  # Run all setup steps
  check_prerequisites
  setup_repository
  install_dependencies
  setup_environment
  setup_database
  setup_redis
  verify_setup
  run_quick_tests
  start_dev_server
  print_post_setup_info
}

# ============================================================================
# Entry Point
# ============================================================================

trap 'echo -e "\n${RED}Setup interrupted${NC}"; exit 1' INT TERM

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
