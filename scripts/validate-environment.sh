#!/bin/bash

# ============================================================================
# TaskFlow - Environment Validation Script
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

# Variables the code actually reads (verified via
# `grep -rhoE "process\.env\.[A-Z_0-9]+" src`)
REQUIRED_VARS=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
    "JWT_SECRET"
    "NEXT_PUBLIC_APP_URL"
)

OPTIONAL_VARS=(
    "CRON_SECRET"
    "INTERNAL_NOTIFY_SECRET"
    "ALERT_WEBHOOK_URL"
    "RESEND_API_KEY"
    "NOTIFICATION_FROM_EMAIL"
    "UPSTASH_REDIS_REST_URL"
    "UPSTASH_REDIS_REST_TOKEN"
    "KV_REST_API_URL"
    "KV_REST_API_TOKEN"
    "GOOGLE_CLIENT_ID"
    "NEXT_PUBLIC_GOOGLE_CLIENT_ID"
    "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY"
    "GOOGLE_OAUTH_REDIRECT_URI"
)

# ============================================================================
# FUNCTIONS
# ============================================================================

log_header() {
    echo -e "\n${BLUE}=== $* ===${NC}\n"
}

log_pass() {
    echo -e "${GREEN}✓${NC} $*"
    VALID=$((VALID + 1))
    CHECKED=$((CHECKED + 1))
}

log_fail() {
    echo -e "${RED}✗${NC} $*"
    INVALID=$((INVALID + 1))
    CHECKED=$((CHECKED + 1))
}

log_missing() {
    echo -e "${RED}✗${NC} MISSING: $*"
    MISSING=$((MISSING + 1))
    CHECKED=$((CHECKED + 1))
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $*"
    WARNINGS=$((WARNINGS + 1))
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

log_info "Supabase Configuration:"
check_required "NEXT_PUBLIC_SUPABASE_URL" "Supabase project URL"
check_required "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Supabase anonymous key"
check_required "SUPABASE_SERVICE_ROLE_KEY" "Supabase service role key"

log_info "\nSecurity:"
check_required "JWT_SECRET" "JWT signing secret"

log_info "\nApplication URLs:"
check_required "NEXT_PUBLIC_APP_URL" "Public application URL"

log_header "2. OPTIONAL CONFIGURATION"

echo ""
echo "Variables opcionales no configuradas (features degradadas, no bloquea el arranque):"
for var in "${OPTIONAL_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        echo -e "  ${YELLOW}⚠${NC} $var"
    else
        log_pass "$var is configured"
    fi
done

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
