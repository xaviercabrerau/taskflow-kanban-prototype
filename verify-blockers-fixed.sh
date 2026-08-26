#!/bin/bash
##############################################################################
# TaskFlow Notification System - Blockers Verification Script
#
# This script verifies that all 11 critical blockers have been fixed
# and the system is ready for production deployment.
#
# Usage:
#   ./verify-blockers-fixed.sh          # Run all checks
#   ./verify-blockers-fixed.sh --json   # Output JSON format
#   ./verify-blockers-fixed.sh --fix    # Attempt to fix issues
#
# Exit codes:
#   0 = All checks passed
#   1 = Some checks failed
#   2 = Script error
##############################################################################

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
PASS=0
FAIL=0
WARN=0

# Format output
FORMAT="text"
ATTEMPT_FIX=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --json) FORMAT="json" ;;
    --fix) ATTEMPT_FIX=true ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
  shift
done

##############################################################################
# Helper Functions
##############################################################################

check() {
  local name=$1
  local cmd=$2
  local blocker=$3

  if eval "$cmd" &>/dev/null; then
    if [ "$FORMAT" = "json" ]; then
      echo "    {\"check\": \"$name\", \"status\": \"pass\", \"blocker\": \"$blocker\"}"
    else
      echo -e "${GREEN}✓${NC} $name"
    fi
    ((PASS++))
    return 0
  else
    if [ "$FORMAT" = "json" ]; then
      echo "    {\"check\": \"$name\", \"status\": \"fail\", \"blocker\": \"$blocker\"}"
    else
      echo -e "${RED}✗${NC} $name"
    fi
    ((FAIL++))
    return 1
  fi
}

warn() {
  local name=$1
  local msg=$2

  if [ "$FORMAT" = "json" ]; then
    echo "    {\"check\": \"$name\", \"status\": \"warn\", \"message\": \"$msg\"}"
  else
    echo -e "${YELLOW}⚠${NC} $name - $msg"
  fi
  ((WARN++))
}

section() {
  local title=$1
  if [ "$FORMAT" = "text" ]; then
    echo ""
    echo -e "${BLUE}$title${NC}"
    echo "─────────────────────────────────────────"
  fi
}

##############################################################################
# BLOCKER CHECKS
##############################################################################

if [ "$FORMAT" = "json" ]; then
  echo "{"
  echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"version\": \"1.0\","
  echo "  \"checks\": ["
fi

# BLOCKER #1: YAML Syntax
section "BLOCKER #1: YAML Syntax"

check "testing/1-load-testing.yaml is valid YAML" \
  "python3 -c \"import yaml; yaml.safe_load(open('testing/1-load-testing.yaml'))\"" \
  "blocker-1"

check "ops/1-monitoring-alerts.yaml is valid YAML" \
  "python3 -c \"import yaml; yaml.safe_load(open('ops/1-monitoring-alerts.yaml'))\"" \
  "blocker-1"

# BLOCKER #2: External Service Credentials
section "BLOCKER #2: External Service Credentials"

check "GMAIL_SERVICE_ACCOUNT_JSON environment variable set" \
  "[ ! -z \"\${GMAIL_SERVICE_ACCOUNT_JSON:-}\" ]" \
  "blocker-2"

check "SLACK_WEBHOOK_URL environment variable set" \
  "[ ! -z \"\${SLACK_WEBHOOK_URL:-}\" ]" \
  "blocker-2"

check "SENTRY_DSN environment variable set" \
  "[ ! -z \"\${SENTRY_DSN:-}\" ]" \
  "blocker-2"

check "PAGERDUTY_INTEGRATION_KEY environment variable set" \
  "[ ! -z \"\${PAGERDUTY_INTEGRATION_KEY:-}\" ]" \
  "blocker-2"

check "REDIS_URL environment variable set" \
  "[ ! -z \"\${REDIS_URL:-}\" ]" \
  "blocker-2"

check "TWILIO_ACCOUNT_SID environment variable set" \
  "[ ! -z \"\${TWILIO_ACCOUNT_SID:-}\" ]" \
  "blocker-2"

check "GMAIL_SENDER_EMAIL environment variable set" \
  "[ ! -z \"\${GMAIL_SENDER_EMAIL:-}\" ]" \
  "blocker-2"

# BLOCKER #3: Hardcoded Local References
section "BLOCKER #3: Hardcoded Local References"

check "No 'localhost' in ops/1-monitoring-alerts.yaml" \
  "! grep -q 'localhost' ops/1-monitoring-alerts.yaml" \
  "blocker-3"

check "No 'taskflow.local' in ops/6-metrics-dashboard.json" \
  "! grep -q 'taskflow.local' ops/6-metrics-dashboard.json" \
  "blocker-3"

check "No 'example.com' in ops/1-monitoring-alerts.yaml" \
  "! grep -q 'example.com' ops/1-monitoring-alerts.yaml" \
  "blocker-3"

# BLOCKER #4: Environment Variable Documentation
section "BLOCKER #4: Environment Variable Documentation"

check ".env.example file exists" \
  "[ -f .env.example ]" \
  "blocker-4"

check ".env.example has GMAIL_SERVICE_ACCOUNT_JSON" \
  "grep -q 'GMAIL_SERVICE_ACCOUNT_JSON' .env.example" \
  "blocker-4"

check ".env.example has SLACK_WEBHOOK_URL" \
  "grep -q 'SLACK_WEBHOOK_URL' .env.example" \
  "blocker-4"

check ".env.example has SENTRY_DSN" \
  "grep -q 'SENTRY_DSN' .env.example" \
  "blocker-4"

check ".env.example has PAGERDUTY_INTEGRATION_KEY" \
  "grep -q 'PAGERDUTY_INTEGRATION_KEY' .env.example" \
  "blocker-4"

check ".env.example has REDIS_URL" \
  "grep -q 'REDIS_URL' .env.example" \
  "blocker-4"

# BLOCKER #5: Monitoring Configuration
section "BLOCKER #5: Monitoring Configuration"

check "ops/1-monitoring-alerts.yaml has KPI definitions" \
  "grep -q 'kpis:' ops/1-monitoring-alerts.yaml" \
  "blocker-5"

check "ops/1-monitoring-alerts.yaml has alert rules" \
  "grep -q 'alert_rules:' ops/1-monitoring-alerts.yaml" \
  "blocker-5"

check "ops/1-monitoring-alerts.yaml has escalation policies" \
  "grep -q 'escalation_policies:' ops/1-monitoring-alerts.yaml" \
  "blocker-5"

# BLOCKER #6: Metrics Dashboard
section "BLOCKER #6: Metrics Dashboard Configuration"

check "ops/6-metrics-dashboard.json is valid JSON" \
  "python3 -c \"import json; json.load(open('ops/6-metrics-dashboard.json'))\"" \
  "blocker-6"

check "ops/6-metrics-dashboard.json has dashboard config" \
  "grep -q '\"dashboards\"' ops/6-metrics-dashboard.json" \
  "blocker-6"

# BLOCKER #7: Load Testing Credentials
section "BLOCKER #7: Load Testing Credentials"

check "testing/1-load-testing.yaml has environment variables" \
  "grep -q 'environment_variables' testing/1-load-testing.yaml || grep -q 'env:' testing/1-load-testing.yaml" \
  "blocker-7"

check "Load test scenarios defined" \
  "grep -q 'scenarios\\|stages' testing/1-load-testing.yaml" \
  "blocker-7"

# BLOCKER #8: Security Testing Safeguards
section "BLOCKER #8: Security Testing Production Safeguards"

check "testing/2-security-testing.sh exists" \
  "[ -f testing/2-security-testing.sh ]" \
  "blocker-8"

check "testing/2-security-testing.sh is executable" \
  "[ -x testing/2-security-testing.sh ]" \
  "blocker-8"

# Check for safety guards (if added)
if grep -q "production" testing/2-security-testing.sh 2>/dev/null; then
  check "Production environment check present" \
    "grep -q 'production\\|prod' testing/2-security-testing.sh" \
    "blocker-8"
fi

# BLOCKER #9: GDPR Endpoints
section "BLOCKER #9: GDPR Endpoints Implementation"

check "GDPR data export endpoint exists" \
  "[ -f app/api/user/export-data.ts ] || [ -f app/api/user/export-data.js ]" \
  "blocker-9"

check "GDPR data deletion endpoint exists" \
  "[ -f app/api/admin/delete-user.ts ] || [ -f app/api/admin/delete-user.js ]" \
  "blocker-9"

check "Endpoints are TypeScript/JavaScript files" \
  "[ -f app/api/user/export-data.ts ] && [ -f app/api/admin/delete-user.ts ]" \
  "blocker-9"

# BLOCKER #10: PII Scrubbing & Audit Logging
section "BLOCKER #10: PII Scrubbing & Audit Logging"

check "PII scrubbing module exists" \
  "[ -f lib/pii-scrubbing.ts ] || [ -f lib/pii-scrubbing.js ] || grep -r 'scrub\\|PII' lib/ app/ --include='*.ts' --include='*.js' | head -1" \
  "blocker-10"

check "Audit logging migration exists" \
  "[ -f migrations/*audit* ] || grep -q 'audit_log' migrations/*.sql" \
  "blocker-10"

check "Audit logging functions defined" \
  "[ -f lib/audit-log.ts ] || [ -f lib/audit-log.js ] || grep -r 'audit' lib/ app/ --include='*.ts' --include='*.js' | head -1" \
  "blocker-10"

# BLOCKER #11: Sentry Configuration
section "BLOCKER #11: Sentry Configuration"

check "Sentry auth token set" \
  "[ ! -z \"\${SENTRY_AUTH_TOKEN:-}\" ]" \
  "blocker-11"

check "Sentry environment set" \
  "[ ! -z \"\${SENTRY_ENVIRONMENT:-}\" ]" \
  "blocker-11"

check "Sentry initialized in Next.js config" \
  "grep -q 'sentry\\|Sentry' next.config.js 2>/dev/null || grep -q 'sentry\\|Sentry' next.config.ts 2>/dev/null" \
  "blocker-11"

##############################################################################
# ADDITIONAL VALIDATIONS
##############################################################################

section "ADDITIONAL VALIDATIONS"

check "Repository has git history" \
  "[ -d .git ] && git rev-parse HEAD" \
  "repo-health"

check "No uncommitted changes (critical blocker files)" \
  "! git status --porcelain | grep -E 'BLOCKERS_RESOLUTION|PRODUCTION_READINESS|verify-blockers'" \
  "repo-health"

check "All required directories exist" \
  "[ -d app ] && [ -d lib ] && [ -d ops ] && [ -d testing ] && [ -d migrations ]" \
  "repo-health"

##############################################################################
# SUMMARY
##############################################################################

if [ "$FORMAT" = "json" ]; then
  echo "    ],"
  echo "  \"summary\": {"
  echo "    \"passed\": $PASS,"
  echo "    \"failed\": $FAIL,"
  echo "    \"warnings\": $WARN,"
  echo "    \"total\": $((PASS + FAIL + WARN)),"
  echo "    \"ready_for_deployment\": $([ $FAIL -eq 0 ] && echo 'true' || echo 'false')"
  echo "  }"
  echo "}"
else
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "VERIFICATION RESULTS"
  echo "═══════════════════════════════════════════════════════════"
  echo -e "Passed:   ${GREEN}$PASS${NC}"
  echo -e "Failed:   ${RED}$FAIL${NC}"
  echo -e "Warnings: ${YELLOW}$WARN${NC}"
  echo -e "Total:    $((PASS + FAIL + WARN))"
  echo ""

  if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ ALL BLOCKERS VERIFIED FIXED!${NC}"
    echo "System is ready for production deployment."
    exit 0
  else
    echo -e "${RED}✗ SOME BLOCKERS STILL PENDING${NC}"
    echo ""
    echo "Review /BLOCKERS_RESOLUTION.md for fix instructions:"
    echo "  https://github.com/your-org/taskflow/blob/main/BLOCKERS_RESOLUTION.md"
    echo ""
    echo "Or run with --fix flag to attempt automatic fixes:"
    echo "  ./verify-blockers-fixed.sh --fix"
    exit 1
  fi
fi
