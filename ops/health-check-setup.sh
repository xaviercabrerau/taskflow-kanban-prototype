#!/bin/bash

################################################################################
# TaskFlow Health Check - Setup & Validation
#
# Validates environment, installs dependencies, and configures health checks
# for production deployment of TaskFlow Notification System
#
# Usage:
#   ./health-check-setup.sh validate          # Validate environment only
#   ./health-check-setup.sh install-deps      # Install required tools
#   ./health-check-setup.sh configure         # Configure for production
#   ./health-check-setup.sh setup-cron         # Setup automated checks
#
################################################################################

set -euo pipefail

# Color codes
readonly GREEN='\033[0;32m'
readonly RED='\033[0;31m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

# Log functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
    return 1
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

################################################################################
# DEPENDENCY CHECKS
################################################################################

check_dependencies() {
    echo -e "\n${BLUE}━━━ Checking Dependencies ━━━${NC}\n"

    local missing_deps=()

    # Required commands
    local required_commands=("redis-cli" "curl" "jq")
    for cmd in "${required_commands[@]}"; do
        if command -v "$cmd" >/dev/null 2>&1; then
            log_success "$cmd installed"
        else
            log_warning "$cmd not found"
            missing_deps+=("$cmd")
        fi
    done

    # Optional but recommended
    local optional_commands=("gcloud" "psql" "nc")
    for cmd in "${optional_commands[@]}"; do
        if command -v "$cmd" >/dev/null 2>&1; then
            log_success "$cmd (optional) installed"
        else
            log_warning "$cmd (optional) not found - some checks will be skipped"
        fi
    done

    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        log_info "Install them before running health checks"
        return 1
    fi

    return 0
}

################################################################################
# ENVIRONMENT VALIDATION
################################################################################

validate_environment() {
    echo -e "\n${BLUE}━━━ Validating Environment ━━━${NC}\n"

    local missing_vars=()
    local config_file="${1:-.env.local}"

    # Load environment if file exists
    if [[ -f "$config_file" ]]; then
        log_info "Loading config from $config_file"
        set -a
        # shellcheck disable=SC1090
        source "$config_file"
        set +a
    fi

    # Required environment variables
    local required_vars=(
        "REDIS_URL"
        "SUPABASE_URL"
        "SUPABASE_ANON_KEY"
        "GMAIL_SERVICE_ACCOUNT"
        "GOOGLE_CLOUD_PROJECT"
        "PUBSUB_TOPIC"
    )

    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            log_error "Missing: $var"
            missing_vars+=("$var")
        else
            log_success "$var is set"
        fi
    done

    # Validate specific variables
    if [[ -n "${GMAIL_SERVICE_ACCOUNT:-}" ]] && [[ ! -f "$GMAIL_SERVICE_ACCOUNT" ]]; then
        log_error "GMAIL_SERVICE_ACCOUNT file not found: $GMAIL_SERVICE_ACCOUNT"
        return 1
    fi

    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_error "Missing required environment variables: ${missing_vars[*]}"
        return 1
    fi

    return 0
}

################################################################################
# DEPENDENCY INSTALLATION
################################################################################

install_redis_cli() {
    log_info "Installing redis-cli..."

    if [[ "$(uname)" == "Darwin" ]]; then
        if command -v brew >/dev/null 2>&1; then
            brew install redis >/dev/null 2>&1 && log_success "redis-cli installed via Homebrew"
        else
            log_error "Homebrew not found. Install redis manually or install Homebrew"
            return 1
        fi
    elif [[ -f /etc/debian_version ]]; then
        sudo apt-get update >/dev/null 2>&1 && \
        sudo apt-get install -y redis-tools >/dev/null 2>&1 && \
        log_success "redis-cli installed via apt"
    elif [[ -f /etc/redhat-release ]]; then
        sudo yum install -y redis >/dev/null 2>&1 && \
        log_success "redis-cli installed via yum"
    else
        log_error "Unsupported OS for automatic redis-cli installation"
        return 1
    fi
}

install_dependencies() {
    echo -e "\n${BLUE}━━━ Installing Dependencies ━━━${NC}\n"

    # Check if already installed
    if ! command -v redis-cli >/dev/null 2>&1; then
        install_redis_cli || return 1
    fi

    if ! command -v jq >/dev/null 2>&1; then
        log_info "Installing jq..."
        if [[ "$(uname)" == "Darwin" ]]; then
            brew install jq >/dev/null 2>&1 && log_success "jq installed"
        elif [[ -f /etc/debian_version ]]; then
            sudo apt-get install -y jq >/dev/null 2>&1 && log_success "jq installed"
        fi
    fi

    if ! command -v gcloud >/dev/null 2>&1; then
        log_warning "Google Cloud SDK not installed - some checks will be skipped"
        log_info "Install from: https://cloud.google.com/sdk/docs/install"
    fi

    log_success "Dependency installation complete"
}

################################################################################
# PRODUCTION CONFIGURATION
################################################################################

configure_production() {
    echo -e "\n${BLUE}━━━ Production Configuration ━━━${NC}\n"

    local config_dir="${1:-.}"
    local health_check_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/2-health-check-utils.sh"

    # Create systemd service file for continuous monitoring
    if [[ "$(uname)" != "Darwin" ]] && [[ -d /etc/systemd/system ]]; then
        log_info "Creating systemd service for health monitoring..."

        local service_file="/tmp/taskflow-health-check.service"

        cat > "$service_file" << 'EOF'
[Unit]
Description=TaskFlow Notification System Health Check
After=network.target
Wants=taskflow-health-check.timer

[Service]
Type=oneshot
ExecStart=HEALTH_CHECK_SCRIPT watch
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

        log_success "Service file created at $service_file"
        log_info "To install: sudo cp $service_file /etc/systemd/system/"
        log_info "Then: sudo systemctl daemon-reload && sudo systemctl enable taskflow-health-check"
    fi

    # Create Prometheus exporter format output wrapper
    local exporter_script="$config_dir/health-check-prometheus.sh"
    cat > "$exporter_script" << 'EOF'
#!/bin/bash
# Prometheus health check exporter
# Converts health check output to Prometheus metrics

HEALTH_SCRIPT="$(dirname "$0")/2-health-check-utils.sh"

echo "# HELP taskflow_notifications_health_status Component health status (0=healthy, 1=warning, 2=critical)"
echo "# TYPE taskflow_notifications_health_status gauge"

# Run health checks and parse JSON output
if command -v jq >/dev/null 2>&1; then
    RESULT=$("$HEALTH_SCRIPT" json)

    # Extract metrics from JSON
    echo "taskflow_notifications_health_status{service=\"redis\"} $(echo "$RESULT" | jq '.services.redis.status // 0')"
    echo "taskflow_notifications_health_status{service=\"supabase\"} $(echo "$RESULT" | jq '.services.supabase.status // 0')"
    echo "taskflow_notifications_health_status{service=\"gmail\"} $(echo "$RESULT" | jq '.services.gmail.status // 0')"
    echo "taskflow_notifications_health_status{service=\"pubsub\"} $(echo "$RESULT" | jq '.services.pubsub.status // 0')"
    echo "taskflow_notifications_health_status{service=\"bullmq\"} $(echo "$RESULT" | jq '.services.bullmq.status // 0')"
fi
EOF

    chmod +x "$exporter_script"
    log_success "Prometheus exporter created at $exporter_script"

    # Create monitoring dashboard template
    local dashboard_template="$config_dir/health-check-dashboard-template.json"
    cat > "$dashboard_template" << 'EOF'
{
  "dashboard": {
    "title": "TaskFlow Notification System Health",
    "panels": [
      {
        "title": "Redis Status",
        "targets": [{"expr": "taskflow_notifications_health_status{service='redis'}"}]
      },
      {
        "title": "Supabase Status",
        "targets": [{"expr": "taskflow_notifications_health_status{service='supabase'}"}]
      },
      {
        "title": "Gmail API Status",
        "targets": [{"expr": "taskflow_notifications_health_status{service='gmail'}"}]
      },
      {
        "title": "BullMQ Queue Depth",
        "targets": [{"expr": "taskflow_notifications_queue_depth"}]
      },
      {
        "title": "Failed Jobs Count",
        "targets": [{"expr": "taskflow_notifications_failed_jobs"}]
      }
    ]
  }
}
EOF

    log_success "Dashboard template created at $dashboard_template"

    return 0
}

################################################################################
# CRON SETUP
################################################################################

setup_cron() {
    echo -e "\n${BLUE}━━━ Setting Up Automated Checks ━━━${NC}\n"

    local health_check_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/2-health-check-utils.sh"
    local log_dir="/var/log/taskflow"
    local cron_entry=""

    # Create log directory
    if [[ ! -d "$log_dir" ]]; then
        sudo mkdir -p "$log_dir"
        sudo chmod 755 "$log_dir"
        log_success "Created log directory: $log_dir"
    fi

    # Generate cron entry
    read -p "Check interval (minutes) [5]: " interval
    interval=${interval:-5}

    cron_entry="*/$interval * * * * $health_check_script >> $log_dir/health-check.log 2>&1"

    # Check if cron entry already exists
    if crontab -l 2>/dev/null | grep -q "health-check-utils.sh"; then
        log_warning "Cron entry for health checks already exists"
        return 0
    fi

    # Add cron entry
    (crontab -l 2>/dev/null || true; echo "$cron_entry") | crontab -
    log_success "Added cron job: Every $interval minutes"
    log_info "Logs will be written to: $log_dir/health-check.log"

    # Show current cron jobs
    log_info "Current cron jobs:"
    crontab -l | grep "health-check" || true

    return 0
}

################################################################################
# ALERTING SETUP
################################################################################

setup_alerting() {
    echo -e "\n${BLUE}━━━ Setting Up Alerting ━━━${NC}\n"

    local alert_script="$(dirname "${BASH_SOURCE[0]}")/health-check-alerts.sh"

    cat > "$alert_script" << 'EOF'
#!/bin/bash
# Health check alerting script
# Sends alerts when health checks fail

HEALTH_SCRIPT="$(dirname "$0")/2-health-check-utils.sh"
WEBHOOK_URL="${HEALTH_CHECK_WEBHOOK_URL:-}"
EMAIL="${HEALTH_CHECK_EMAIL:-}"

# Run health check
"$HEALTH_SCRIPT" json > /tmp/health-check-result.json

# Parse result
OVERALL_STATUS=$(jq -r '.overall_status' /tmp/health-check-result.json)

if [[ $OVERALL_STATUS -gt 1 ]]; then
    # Send alert
    RESULT=$(cat /tmp/health-check-result.json)

    # Webhook alert (e.g., Slack)
    if [[ -n "$WEBHOOK_URL" ]]; then
        curl -X POST "$WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -d "{\"text\": \"TaskFlow Health Check CRITICAL: $RESULT\"}"
    fi

    # Email alert
    if [[ -n "$EMAIL" ]] && command -v mail >/dev/null 2>&1; then
        echo "Health check failed: $RESULT" | mail -s "TaskFlow Health Alert" "$EMAIL"
    fi
fi
EOF

    chmod +x "$alert_script"
    log_success "Alerting script created at $alert_script"
    log_info "Configure webhook: export HEALTH_CHECK_WEBHOOK_URL='<slack-webhook>'"
    log_info "Configure email: export HEALTH_CHECK_EMAIL='<email@domain.com>'"

    return 0
}

################################################################################
# TESTING
################################################################################

test_health_checks() {
    echo -e "\n${BLUE}━━━ Running Health Checks Test ━━━${NC}\n"

    local health_check_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/2-health-check-utils.sh"

    if [[ ! -x "$health_check_script" ]]; then
        log_error "Health check script not found or not executable"
        return 1
    fi

    log_info "Running health checks..."
    if "$health_check_script"; then
        log_success "Health checks passed!"
    else
        log_warning "Health checks reported issues (this might be expected)"
    fi

    return 0
}

################################################################################
# MAIN
################################################################################

main() {
    local command="${1:-setup}"

    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║   TaskFlow Health Check - Setup & Validation              ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

    case "$command" in
        validate)
            validate_environment "${2:-.env.local}" || exit 1
            check_dependencies || exit 1
            log_success "All validations passed!"
            ;;
        install-deps)
            install_dependencies || exit 1
            ;;
        configure)
            configure_production "${2:-.}" || exit 1
            ;;
        setup-cron)
            setup_cron || exit 1
            ;;
        setup-alerts)
            setup_alerting || exit 1
            ;;
        test)
            test_health_checks || exit 1
            ;;
        full-setup)
            check_dependencies || install_dependencies || true
            validate_environment "${2:-.env.local}" || exit 1
            configure_production "${2:-.}" || true
            setup_alerting || true
            read -p "Setup cron job? (y/n) [n]: " setup_cron_resp
            [[ "$setup_cron_resp" == "y" ]] && setup_cron
            test_health_checks || exit 1
            log_success "Full setup complete!"
            ;;
        --help|-h)
            cat << EOF
${BLUE}TaskFlow Health Check - Setup & Validation${NC}

${YELLOW}Usage:${NC}
  ./health-check-setup.sh validate          # Validate environment
  ./health-check-setup.sh install-deps      # Install dependencies
  ./health-check-setup.sh configure         # Configure for production
  ./health-check-setup.sh setup-cron        # Setup automated cron jobs
  ./health-check-setup.sh setup-alerts      # Setup alerting
  ./health-check-setup.sh test              # Run health checks
  ./health-check-setup.sh full-setup        # Complete setup flow
  ./health-check-setup.sh --help            # Show this help

${YELLOW}Environment Variables:${NC}
  REDIS_URL                 - Redis connection string
  SUPABASE_URL              - Supabase project URL
  SUPABASE_ANON_KEY         - Supabase anonymous key
  GMAIL_SERVICE_ACCOUNT     - Path to Gmail service account JSON
  GOOGLE_CLOUD_PROJECT      - Google Cloud project ID
  PUBSUB_TOPIC              - Google Cloud Pub/Sub topic name
  HEALTH_CHECK_WEBHOOK_URL  - Slack/Discord webhook for alerts (optional)
  HEALTH_CHECK_EMAIL        - Email for alerts (optional)

${YELLOW}Examples:${NC}
  # Complete setup for production
  ./health-check-setup.sh full-setup

  # Validate existing environment
  ./health-check-setup.sh validate .env.production

  # Just check dependencies
  ./health-check-setup.sh install-deps
EOF
            ;;
        *)
            log_error "Unknown command: $command"
            log_info "Run with --help for usage information"
            exit 1
            ;;
    esac
}

main "$@"
