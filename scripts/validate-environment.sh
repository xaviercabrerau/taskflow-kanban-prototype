#!/bin/bash

# ============================================================================
# TaskFlow Notification System - Environment Validation Script
# ============================================================================
# Validates that all required environment variables are configured
# Usage: ./scripts/validate-environment.sh [--strict] [--json]
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Flags
STRICT_MODE=false
JSON_OUTPUT=false

# Color codes
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Counters
CHECKED=0
VALID=0
MISSING=0
INVALID=0
WARNINGS=0

# ============================================================================
# FUNCTIONS
# ============================================================================

log_header() {
    echo -e "\n${BLUE}=== $* ===${NC}\n"
}

log_pass() {
    echo -e "${GREEN}✓${NC} $*"
    ((VALID++))
    ((CHECKED++))
}

log_fail() {
    echo -e "${RED}✗${NC} $*"
    ((INVALID++))
    ((CHECKED++))
}

log_missing() {
    echo -e "${RED}✗${NC} MISSING: $*"
    ((MISSING++))
    ((CHECKED++))
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $*"
    ((WARNINGS++))
}

log_info() {
    echo -e "${BLUE}ℹ${NC} $*"
}

# Check if variable is set and non-empty
check_required() {
    local var_name="$1"
    local description="${2:-}"

    if [[ -z "${!var_name:-}" ]]; then
        log_missing "$var_name${description:+ - $description}"
        return 1
    else
        # Mask sensitive values for display
        local value="${!var_name}"
        if [[ ${#value} -gt 20 ]]; then
            value="${value:0:10}...${value: -10}"
        fi
        log_pass "$var_name = $value"
        return 0
    fi
}

# Check if variable is valid format
check_format() {
    local var_name="$1"
    local pattern="$2"
    local description="${3:-}"

    if [[ -z "${!var_name:-}" ]]; then
        log_missing "$var_name${description:+ - $description}"
        return 1
    fi

    if [[ "${!var_name}" =~ $pattern ]]; then
        log_pass "$var_name format is valid"
        return 0
    else
        log_fail "$var_name format invalid (expected: $description)"
        return 1
    fi
}

# Check if URL is reachable
check_url() {
    local var_name="$1"
    local url_value="${!var_name:-}"

    if [[ -z "$url_value" ]]; then
        log_missing "$var_name"
        return 1
    fi

    # Don't check localhost URLs or placeholder URLs
    if [[ "$url_value" =~ ^http://localhost ]]; then
        log_pass "$var_name is configured (localhost)"
        return 0
    fi

    if [[ "$url_value" =~ example.com ]] || [[ "$url_value" =~ placeholder ]]; then
        log_warn "$var_name looks like a placeholder value"
        return 0
    fi

    if curl -s -o /dev/null -w "%{http_code}" "$url_value" >/dev/null 2>&1; then
        log_pass "$var_name is reachable"
        return 0
    else
        log_warn "$var_name URL not reachable (might be behind auth)"
        return 0
    fi
}

# Show usage
show_help() {
    cat << 'EOF'
TaskFlow Environment Validation

USAGE:
    ./scripts/validate-environment.sh [OPTIONS]

OPTIONS:
    --strict    Fail if any warnings are found
    --json      Output results in JSON format
    --help      Show this help message

EXAMPLE:
    # Standard validation
    ./scripts/validate-environment.sh

    # Strict mode (fail on warnings)
    ./scripts/validate-environment.sh --strict

    # JSON output for automation
    ./scripts/validate-environment.sh --json

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --strict)
            STRICT_MODE=true
            shift
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Load environment
if [[ -f "$PROJECT_ROOT/.env.local" ]]; then
    source "$PROJECT_ROOT/.env.local" 2>/dev/null || true
fi

# ============================================================================
# VALIDATION SECTIONS
# ============================================================================

log_header "1. REQUIRED CONFIGURATION"

# Supabase (Required)
log_info "Supabase Configuration:"
check_required "NEXT_PUBLIC_SUPABASE_URL" "Supabase project URL"
check_required "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Supabase anonymous key"
check_required "SUPABASE_SERVICE_ROLE_KEY" "Supabase service role key"

log_info "\nApplication URLs:"
check_required "TASKFLOW_URL" "Primary application URL"
check_required "API_BASE_URL" "API base URL"

log_header "2. NOTIFICATION SERVICES"

# Slack
log_info "Slack Configuration:"
if check_required "SLACK_WEBHOOK_URL" "Slack webhook URL"; then
    if [[ "$SLACK_WEBHOOK_URL" =~ ^https://hooks\.slack\.com/services/ ]]; then
        log_pass "SLACK_WEBHOOK_URL format is valid"
    else
        log_fail "SLACK_WEBHOOK_URL format invalid"
    fi
fi

# PagerDuty
log_info "\nPagerDuty Configuration:"
check_required "PAGERDUTY_INTEGRATION_KEY" "PagerDuty integration key"
if check_required "PAGERDUTY_BASE_URL" "PagerDuty base URL"; then
    if [[ "$PAGERDUTY_BASE_URL" =~ ^https://events ]] || [[ "$PAGERDUTY_BASE_URL" =~ pagerduty\.com ]]; then
        log_pass "PAGERDUTY_BASE_URL format is valid"
    else
        log_fail "PAGERDUTY_BASE_URL format invalid"
    fi
fi

# Twilio
log_info "\nTwilio Configuration:"
check_required "TWILIO_ACCOUNT_SID" "Twilio account SID"
check_required "TWILIO_AUTH_TOKEN" "Twilio auth token"
check_required "TWILIO_FROM_NUMBER" "Twilio from number"
if [[ -n "${TWILIO_FROM_NUMBER:-}" ]] && [[ "$TWILIO_FROM_NUMBER" =~ ^\+[0-9]{10,15}$ ]]; then
    log_pass "TWILIO_FROM_NUMBER format is valid (international format)"
elif [[ -n "${TWILIO_FROM_NUMBER:-}" ]]; then
    log_warn "TWILIO_FROM_NUMBER should be in international format (+1234567890)"
fi

log_info "\nGmail Configuration:"
check_required "GMAIL_CLIENT_ID" "Gmail client ID"
check_required "GMAIL_CLIENT_SECRET" "Gmail client secret"
if [[ -z "${GMAIL_REFRESH_TOKEN:-}" ]] && [[ -z "${GMAIL_SERVICE_ACCOUNT_JSON:-}" ]]; then
    log_missing "GMAIL_REFRESH_TOKEN or GMAIL_SERVICE_ACCOUNT_JSON"
else
    log_pass "Gmail authentication credentials are configured"
fi

log_header "3. MONITORING & ERROR TRACKING"

log_info "Sentry Configuration:"
if [[ -n "${NEXT_PUBLIC_SENTRY_DSN:-}" ]]; then
    if [[ "$NEXT_PUBLIC_SENTRY_DSN" =~ ^https://.+@.+\.ingest\.sentry\.io ]]; then
        log_pass "NEXT_PUBLIC_SENTRY_DSN format is valid"
    else
        log_warn "NEXT_PUBLIC_SENTRY_DSN format looks unusual"
    fi
else
    log_warn "NEXT_PUBLIC_SENTRY_DSN not configured (error tracking disabled)"
fi

if [[ -n "${SENTRY_DSN:-}" ]]; then
    log_pass "SENTRY_DSN is configured (server-side)"
else
    log_warn "SENTRY_DSN not configured (server-side error tracking disabled)"
fi

log_info "\nDatadog Configuration:"
if [[ -n "${DD_API_KEY:-}" && -n "${DD_APP_KEY:-}" ]]; then
    log_pass "Datadog API key and app key configured"
else
    log_warn "Datadog not configured (monitoring disabled)"
fi

log_header "4. EMAIL CONFIGURATION"

log_info "Email Recipients:"
if [[ -n "${ALERTS_EMAIL_RECIPIENTS:-}" ]]; then
    # Count commas to estimate number of recipients
    local count=$(echo "${ALERTS_EMAIL_RECIPIENTS}" | tr ',' '\n' | wc -l)
    log_pass "ALERTS_EMAIL_RECIPIENTS configured ($count recipients)"
else
    log_warn "ALERTS_EMAIL_RECIPIENTS not configured"
fi

check_required "ALERTS_FROM_ADDRESS" "Alert sender email address"
check_required "ENGINEERING_LEAD_EMAIL" "Engineering lead email"
check_required "INFRASTRUCTURE_TEAM_EMAIL" "Infrastructure team email"
check_required "ON_CALL_EMAIL" "On-call contact email"

log_header "5. REDIS & CACHE"

log_info "Redis Configuration:"
if [[ -n "${REDIS_URL:-}" ]]; then
    if [[ "$REDIS_URL" =~ ^redis://.+ ]]; then
        log_pass "REDIS_URL format is valid"
    else
        log_fail "REDIS_URL format invalid"
    fi
else
    log_warn "REDIS_URL not configured (caching disabled)"
fi

log_info "\nRedis Connection Details:"
check_required "REDIS_HOST" "Redis host (backup to REDIS_URL)"
check_required "REDIS_PORT" "Redis port"

log_header "6. DATABASE CONFIGURATION"

log_info "Database:"
if [[ -n "${DATABASE_URL:-}" ]]; then
    if [[ "$DATABASE_URL" =~ ^postgresql://.+ ]]; then
        log_pass "DATABASE_URL format is valid"
    else
        log_fail "DATABASE_URL format invalid"
    fi
elif [[ -n "${SUPABASE_HOST:-}" ]]; then
    log_pass "Supabase database connection info provided"
else
    log_warn "DATABASE_URL not configured"
fi

log_header "7. OPTIONAL FEATURES"

log_info "Feature Flags:"
[[ -n "${ENABLE_EMAIL_NOTIFICATIONS:-}" ]] && log_pass "Email notifications: ${ENABLE_EMAIL_NOTIFICATIONS}"
[[ -n "${ENABLE_SLACK_NOTIFICATIONS:-}" ]] && log_pass "Slack notifications: ${ENABLE_SLACK_NOTIFICATIONS}"
[[ -n "${ENABLE_PAGERDUTY_NOTIFICATIONS:-}" ]] && log_pass "PagerDuty notifications: ${ENABLE_PAGERDUTY_NOTIFICATIONS}"

log_header "8. SECURITY"

log_info "JWT & Authentication:"
check_required "JWT_SECRET" "JWT signing secret"
check_required "API_ADMIN_TOKEN" "API admin token"

log_header "9. DEVELOPMENT"

log_info "Environment:"
check_required "NODE_ENV" "Node environment"
[[ -n "${LOG_LEVEL:-}" ]] && log_pass "LOG_LEVEL = ${LOG_LEVEL}"
[[ -n "${DEBUG_JWT:-}" ]] && log_pass "DEBUG_JWT configured (for testing)"

# ============================================================================
# SUMMARY
# ============================================================================

log_header "VALIDATION SUMMARY"

echo -e "Total Checked:  ${CHECKED}"
echo -e "${GREEN}Valid:${NC}       ${VALID}"
echo -e "${RED}Missing:${NC}      ${MISSING}"
echo -e "${RED}Invalid:${NC}      ${INVALID}"
echo -e "${YELLOW}Warnings:${NC}     ${WARNINGS}"

log_header "RECOMMENDATIONS"

if [[ $MISSING -gt 0 ]]; then
    log_warn "Missing $MISSING required variables"
    echo "  See .env.example for configuration template"
    echo "  Run: cp .env.example .env.local"
fi

if [[ $INVALID -gt 0 ]]; then
    log_warn "Fix $INVALID configuration errors before deployment"
fi

if [[ $WARNINGS -gt 0 ]]; then
    log_warn "$WARNINGS warnings found (non-critical)"
    if [[ "$STRICT_MODE" == true ]]; then
        echo -e "${RED}STRICT MODE: Failing due to warnings${NC}"
        exit 1
    fi
fi

# ============================================================================
# EXIT STATUS
# ============================================================================

if [[ $MISSING -eq 0 && $INVALID -eq 0 ]]; then
    echo ""
    echo -e "${GREEN}✓ Environment validation PASSED${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}✗ Environment validation FAILED${NC}"
    exit 1
fi
