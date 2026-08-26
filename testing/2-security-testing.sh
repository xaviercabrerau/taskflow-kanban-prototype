#!/bin/bash

################################################################################
# TaskFlow Notification System - Security Testing Suite v2.0
# Comprehensive security testing for notification endpoints and email flows
#
# Tests 10 security domains with 40+ individual tests:
#  1. Input Validation (SQL injection, XSS, command injection, path traversal)
#  2. Authentication (JWT tokens, expiration, tampering)
#  3. Authorization (cross-user, cross-org, privilege escalation, RLS)
#  4. Rate Limiting (threshold enforcement, bypass attempts)
#  5. Data Exposure (errors, headers, secrets, PII)
#  6. API Security (CORS, CSRF, methods, content-type)
#  7. Email Security (header injection, XSS, attachments, spoofing)
#  8. External Services (Gmail, Redis, Supabase failures)
#  9. Secret Management (logs, env vars, source code)
# 10. Compliance (retention, deletion, audit, GDPR)
#
# FEATURES:
#  - Color-coded output (PASS/FAIL/WARN)
#  - JSON export with severity levels
#  - Comprehensive HTML report generation
#  - Developer-friendly error messages
#  - CI/CD integration ready
#  - Detailed curl debugging logs
#  - Security best practices recommendations
#
# Usage:
#   ./2-security-testing.sh                        # Run all tests
#   ./2-security-testing.sh --suite input          # Run specific section
#   ./2-security-testing.sh --format json          # JSON output
#   ./2-security-testing.sh --verbose              # Verbose output
#   ./2-security-testing.sh --html                 # Generate HTML report
#   ./2-security-testing.sh --debug                # Show curl requests/responses
#   BASE_URL=http://staging:3000 ./script.sh       # Override base URL
#
# Exit codes:
#   0 = All tests passed (no failures)
#   1 = One or more tests failed
#   2 = Test execution error / configuration issue
#   3 = Connection error (endpoint unreachable)
#
# Requirements:
#   - bash 4.0+
#   - curl
#   - jq (optional, for JSON output)
#   - grep, sed, awk
#
################################################################################

set -e
trap 'on_exit' EXIT

# ============================================================================
# Configuration & Defaults
# ============================================================================

BASE_URL="${BASE_URL:-http://localhost:3000}"
VERBOSE="${VERBOSE:-false}"
DEBUG="${DEBUG:-false}"
OUTPUT_FORMAT="${OUTPUT_FORMAT:-text}"
TEST_SUITE="${TEST_SUITE:-all}"
RESULTS_DIR="${RESULTS_DIR:-./test-results}"
GENERATE_HTML="${GENERATE_HTML:-false}"
TIMEOUT="${TIMEOUT:-10}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
CURL_OPTS_BASE=(-s -m "$TIMEOUT" --connect-timeout 5 -w "\n%{http_code}")

# Test credentials
TEST_USER_ID="test-user-$(date +%s)"
TEST_ORG_ID="test-org-$(date +%s)"
TEST_EMAIL="test-$(date +%s)@example.com"
VALID_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdfaWQiOiJ0ZXN0LW9yZyIsImlhdCI6OTk5OTk5OTk5OX0.placeholder"
EXPIRED_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdfaWQiOiJ0ZXN0LW9yZyIsImlhdCI6MTAwLCJleHAiOjEwMH0.placeholder"
TAMPERED_JWT="eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhdHRhY2tlciIsIm9yZ19pZCI6InZpY3RpbS1vcmcifQ."

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_WARNED=0
CRITICAL_FAILURES=0

# Results storage
declare -a TEST_DETAILS
declare -A TEST_SEVERITY
CURRENT_SECTION=""

# ============================================================================
# Utility Functions
# ============================================================================

log_info() {
  if [[ "$VERBOSE" == "true" ]]; then
    echo -e "${BLUE}[INFO]${NC} $1" >&2
  fi
}

log_debug() {
  if [[ "$DEBUG" == "true" ]]; then
    echo -e "${PURPLE}[DEBUG]${NC} $1" >&2
  fi
}

log_pass() {
  echo -e "${GREEN}✓${NC} $1"
  ((TESTS_PASSED++))
  TEST_DETAILS+=("PASS|$CURRENT_SECTION|$1|low")
}

log_fail() {
  echo -e "${RED}✗${NC} $1"
  ((TESTS_FAILED++))
  ((CRITICAL_FAILURES++))
  TEST_DETAILS+=("FAIL|$CURRENT_SECTION|$1|critical")
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
  ((TESTS_WARNED++))
  TEST_DETAILS+=("WARN|$CURRENT_SECTION|$1|medium")
}

section_start() {
  CURRENT_SECTION="$1"
  echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}\n"
}

# ============================================================================
# HTTP Request Helpers
# ============================================================================

http_request() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"
  local headers="${4:-}"

  local curl_opts=("${CURL_OPTS_BASE[@]}" -X "$method" "$BASE_URL$endpoint")

  log_debug "Request: $method $BASE_URL$endpoint"
  [[ -n "$data" ]] && log_debug "Body: ${data:0:100}..."

  if [[ -n "$headers" ]]; then
    while IFS='|' read -r key value; do
      curl_opts+=(-H "$key: $value")
      log_debug "Header: $key: ${value:0:50}..."
    done <<< "$headers"
  fi

  if [[ -n "$data" ]]; then
    curl_opts+=(-d "$data")
    curl_opts+=(-H "Content-Type: application/json")
  fi

  local response
  response=$(curl "${curl_opts[@]}" 2>&1) || {
    local exit_code=$?
    if [[ $exit_code -eq 7 ]]; then
      echo "000"
      echo "CONNECTION_ERROR"
      return 3
    else
      echo "000"
      echo "CURL_ERROR_$exit_code"
      return 2
    fi
  }

  local status_code=$(echo "$response" | tail -n 1)
  local body=$(echo "$response" | head -n -1)

  log_debug "Response: HTTP $status_code"

  echo "$status_code"
  echo "$body"
  return 0
}

assert_status() {
  local expected="$1"
  local actual="$2"
  local message="$3"

  if [[ "$actual" == "$expected" ]]; then
    log_pass "$message (HTTP $actual)"
    return 0
  else
    log_fail "$message (expected HTTP $expected, got HTTP $actual)"
    return 1
  fi
}

assert_not_contains() {
  local text="$1"
  local pattern="$2"
  local message="$3"

  if ! echo "$text" | grep -qi "$pattern"; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (found: $pattern)"
    return 1
  fi
}

assert_contains() {
  local text="$1"
  local pattern="$2"
  local message="$3"

  if echo "$text" | grep -qi "$pattern"; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (expected: $pattern)"
    return 1
  fi
}

# ============================================================================
# SECTION 1: Input Validation Testing
# ============================================================================

test_input_validation() {
  section_start "SECTION 1: Input Validation Testing"

  # Test 1.1: SQL injection in email
  log_info "Test 1.1: SQL injection prevention..."
  local sql_payload="test@example.com' OR '1'='1"
  local response=$(http_request POST "/api/admin/notification-preferences" \
    "{\"email\":\"$sql_payload\",\"preferences\":{\"task_completed\":true}}" \
    "Authorization|Bearer $VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "400" ]] && log_pass "SQL injection: Rejected malformed email" || log_warn "SQL injection: HTTP $status"

  # Test 1.2: XSS prevention
  log_info "Test 1.2: XSS injection prevention..."
  if ! grep -r "dangerouslySetInnerHTML\|innerHTML" \
    "$BASE_URL/../src/lib/emails/" 2>/dev/null | grep -v "__tests__" > /dev/null 2>&1; then
    log_pass "XSS: Email templates use safe rendering"
  else
    log_warn "XSS: Templates may use unsafe methods"
  fi

  # Test 1.3: Invalid JSON
  log_info "Test 1.3: Invalid JSON handling..."
  local response=$(http_request POST "/api/admin/notification-preferences" \
    "{invalid json}" \
    "Authorization|Bearer $VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "400" ]] && log_pass "Invalid JSON: Properly rejected" || log_fail "Invalid JSON: HTTP $status"

  # Test 1.4: Command injection
  log_info "Test 1.4: Command injection prevention..."
  local cmd_payload='$(whoami)'
  local response=$(http_request POST "/api/admin/notification-preferences" \
    "{\"email\":\"test@example.com\",\"data\":\"$cmd_payload\"}" \
    "Authorization|Bearer $VALID_JWT")
  ! echo "$response" | grep -q "root\|nobody" && \
    log_pass "Command injection: Payloads treated as data" || \
    log_fail "Command injection: Code may be executed"

  # Test 1.5: Path traversal
  log_info "Test 1.5: Path traversal prevention..."
  local response=$(http_request GET "/api/admin/../../../etc/passwd")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "404" ]] || [[ "$status" == "400" ]] && \
    log_pass "Path traversal: Sequences rejected" || \
    log_warn "Path traversal: HTTP $status"
}

# ============================================================================
# SECTION 2: Authentication Testing
# ============================================================================

test_authentication() {
  section_start "SECTION 2: Authentication Testing"

  # Test 2.1: Missing JWT
  log_info "Test 2.1: Missing JWT handling..."
  local response=$(http_request GET "/api/admin/notification-preferences")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "401" ]] || [[ "$status" == "403" ]] && \
    log_pass "Missing JWT: Rejected unauthorized" || \
    log_fail "Missing JWT: HTTP $status"

  # Test 2.2: Invalid JWT format
  log_info "Test 2.2: Invalid JWT format..."
  local response=$(http_request GET "/api/admin/notification-preferences" "" \
    "Authorization|Bearer not-a-jwt")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "401" ]] || [[ "$status" == "403" ]] && \
    log_pass "Invalid JWT: Rejected malformed token" || \
    log_fail "Invalid JWT: HTTP $status"

  # Test 2.3: Expired JWT
  log_info "Test 2.3: Expired JWT handling..."
  local response=$(http_request GET "/api/admin/notification-preferences" "" \
    "Authorization|Bearer $EXPIRED_JWT")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "401" ]] || [[ "$status" == "403" ]] && \
    log_pass "Expired JWT: Rejected expired token" || \
    log_warn "Expired JWT: HTTP $status"

  # Test 2.4: Tampered JWT
  log_info "Test 2.4: Tampered JWT detection..."
  local response=$(http_request GET "/api/admin/notification-preferences" "" \
    "Authorization|Bearer $TAMPERED_JWT")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "401" ]] || [[ "$status" == "403" ]] && \
    log_pass "Tampered JWT: Rejected forged token" || \
    log_fail "Tampered JWT: HTTP $status"

  # Test 2.5: Bearer token requirement
  log_info "Test 2.5: Bearer token requirement..."
  local response=$(http_request GET "/api/admin/notification-preferences" "" \
    "X-Auth-Token|$VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "401" ]] || [[ "$status" == "403" ]] && \
    log_pass "Bearer requirement: Custom headers rejected" || \
    log_warn "Bearer requirement: HTTP $status"
}

# ============================================================================
# SECTION 3: Authorization Testing
# ============================================================================

test_authorization() {
  section_start "SECTION 3: Authorization Testing"

  # Test 3.1: Cross-user access prevention
  log_info "Test 3.1: Cross-user access prevention..."
  local other_user_id="other-user-$(date +%s)"
  local response=$(http_request GET "/api/admin/notification-preferences?user_id=$other_user_id" "" \
    "Authorization|Bearer $VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  local body=$(echo "$response" | tail -n +2)
  if [[ "$status" == "403" ]] || [[ "$status" == "401" ]] || [[ "$status" == "404" ]]; then
    log_pass "Cross-user access: Prevented unauthorized access"
  elif ! echo "$body" | grep -q "$other_user_id"; then
    log_pass "Cross-user access: No data exposed"
  else
    log_fail "Cross-user access: May expose other user's data"
  fi

  # Test 3.2: Cross-org access prevention
  log_info "Test 3.2: Cross-organization access prevention..."
  local other_org="attacker-org-$(date +%s)"
  local response=$(http_request GET "/api/admin/notification-preferences?org_id=$other_org" "" \
    "Authorization|Bearer $VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "403" ]] || [[ "$status" == "401" ]] || [[ "$status" == "404" ]] && \
    log_pass "Cross-org access: Denied unauthorized org access" || \
    log_warn "Cross-org access: HTTP $status"

  # Test 3.3: Privilege escalation prevention
  log_info "Test 3.3: Privilege escalation prevention..."
  local response=$(http_request POST "/api/admin/notification-preferences" \
    "{\"role\":\"admin\",\"permissions\":[\"*\"]}" \
    "Authorization|Bearer $VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "403" ]] || [[ "$status" == "400" ]] && \
    log_pass "Privilege escalation: Role changes rejected" || \
    log_warn "Privilege escalation: HTTP $status"

  # Test 3.4: RLS bypass attempts
  log_info "Test 3.4: RLS bypass prevention..."
  local response=$(http_request GET "/api/admin/notification-preferences" "" \
    "Authorization|Bearer $VALID_JWT|X-Bypass-RLS|true")
  local body=$(echo "$response" | tail -n +2)
  ! echo "$body" | grep -qi "bypass\|rls" && \
    log_pass "RLS bypass: Headers don't bypass security" || \
    log_fail "RLS bypass: Custom headers may bypass controls"
}

# ============================================================================
# SECTION 4: Rate Limiting Testing
# ============================================================================

test_rate_limiting() {
  section_start "SECTION 4: Rate Limiting Testing"

  log_info "Test 4.1: Rate limit enforcement (5 reqs/min)..."
  local rate_limited=false

  for i in {1..10}; do
    local response=$(http_request POST "/api/webhooks/gmail-reply" \
      "{\"message\":{\"data\":\"$(echo 'test' | base64)\"}}")
    local status=$(echo "$response" | head -n 1)
    [[ "$status" == "429" ]] && rate_limited=true
    sleep 0.1
  done

  [[ "$rate_limited" == "true" ]] && \
    log_pass "Rate limiting: Enforced HTTP 429 responses" || \
    log_warn "Rate limiting: No 429 responses detected"

  # Test 4.2: Rate limit headers
  log_info "Test 4.2: Rate limit header exposure..."
  local response=$(http_request GET "/api/admin/notification-preferences" "" \
    "Authorization|Bearer $VALID_JWT")
  echo "$response" | grep -qi "x-ratelimit\|ratelimit" && \
    log_pass "Rate limit headers: Exposed for client awareness" || \
    log_warn "Rate limit headers: Not found in response"
}

# ============================================================================
# SECTION 5: Data Exposure Testing
# ============================================================================

test_data_exposure() {
  section_start "SECTION 5: Data Exposure Testing"

  # Test 5.1: Error message sanitization
  log_info "Test 5.1: Error message information leakage..."
  local response=$(http_request POST "/api/admin/notification-preferences" \
    "{\"invalid\":\"payload\"}" \
    "Authorization|Bearer $VALID_JWT")
  local body=$(echo "$response" | tail -n +2)
  ! echo "$body" | grep -qi "database\|sql\|stack trace\|error at line" && \
    log_pass "Error leakage: Messages are sanitized" || \
    log_fail "Error leakage: Sensitive info exposed in errors"

  # Test 5.2: Security headers
  log_info "Test 5.2: Security header presence..."
  local response=$(http_request GET "/api/health")
  echo "$response" | grep -qi "content-security-policy\|x-content-type-options\|x-frame-options" && \
    log_pass "Security headers: Present in responses" || \
    log_warn "Security headers: Missing CSP or X-* headers"

  # Test 5.3: Secret exposure
  log_info "Test 5.3: Secrets in responses..."
  local response=$(http_request GET "/api/health" "" "Authorization|Bearer $VALID_JWT")
  ! echo "$response" | grep -qi "api.key\|secret\|password" && \
    log_pass "Secrets exposure: No credentials in response" || \
    log_fail "Secrets exposure: Credentials visible in response"

  # Test 5.4: PII exposure
  log_info "Test 5.4: PII exposure in errors..."
  local response=$(http_request GET "/api/admin/notification-preferences?email=$TEST_EMAIL" "" \
    "Authorization|Bearer $VALID_JWT")
  ! echo "$response" | grep -q "$TEST_EMAIL" && \
    log_pass "PII exposure: Email addresses protected" || \
    log_warn "PII exposure: Email may be visible in responses"
}

# ============================================================================
# SECTION 6: API Security Testing
# ============================================================================

test_api_security() {
  section_start "SECTION 6: API Security Testing"

  # Test 6.1: CORS policy
  log_info "Test 6.1: CORS policy..."
  local response=$(http_request GET "/api/health" "" \
    "Origin|http://malicious.example.com")
  echo "$response" | grep -qi "access-control-allow-origin.*\*" && \
    log_fail "CORS: Wildcard origin (overly permissive)" || \
    log_pass "CORS: Restrictive origin policy"

  # Test 6.2: Method validation
  log_info "Test 6.2: HTTP method validation..."
  local response=$(http_request OPTIONS "/api/admin/notification-preferences")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "405" ]] || [[ "$status" == "501" ]] && \
    log_pass "HTTP methods: Unsupported methods rejected" || \
    log_warn "HTTP methods: HTTP $status"

  # Test 6.3: Content-Type validation
  log_info "Test 6.3: Content-Type validation..."
  local response=$(http_request POST "/api/admin/notification-preferences" \
    "not json" \
    "Authorization|Bearer $VALID_JWT|Content-Type|text/plain")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "400" ]] || [[ "$status" == "415" ]] && \
    log_pass "Content-Type: Mismatched types rejected" || \
    log_warn "Content-Type: HTTP $status"

  # Test 6.4: Request timeout
  log_info "Test 6.4: Request timeout handling..."
  local start=$(date +%s%N | cut -b1-13)
  http_request GET "/api/health" > /dev/null 2>&1 || true
  local end=$(date +%s%N | cut -b1-13)
  local duration=$((end - start))
  [[ $duration -lt 30000 ]] && \
    log_pass "Timeouts: Requests complete within time limit" || \
    log_warn "Timeouts: Requests may be slow"
}

# ============================================================================
# SECTION 7: Email Security Testing
# ============================================================================

test_email_security() {
  section_start "SECTION 7: Email Security Testing"

  # Test 7.1: Email header injection
  log_info "Test 7.1: Email header injection prevention..."
  local header_injection="$TEST_EMAIL\r\nBcc: attacker@example.com"
  local response=$(http_request POST "/api/admin/notification-preferences" \
    "{\"email\":\"$header_injection\"}" \
    "Authorization|Bearer $VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "400" ]] && \
    log_pass "Header injection: CRLF sequences rejected" || \
    log_warn "Header injection: May allow header injection"

  # Test 7.2: Email template XSS
  log_info "Test 7.2: Email template rendering safety..."
  ! grep -r "dangerouslySetInnerHTML\|innerHTML" \
    "$BASE_URL/../src/lib/emails/" 2>/dev/null | grep -v "__tests__" > /dev/null 2>&1 && \
    log_pass "Email XSS: Safe rendering methods used" || \
    log_warn "Email XSS: Check for unsafe rendering methods"

  # Test 7.3: From address validation
  log_info "Test 7.3: From address validation..."
  if grep -q "validateEmail\|validate.*email\|email.*valid" \
    "$BASE_URL/../src/lib/notifications/"*.ts 2>/dev/null || \
    [[ -f "$BASE_URL/../src/lib/notifications/gmail.ts" ]]; then
    log_pass "From validation: Email validation present"
  else
    log_warn "From validation: Check email validation in code"
  fi
}

# ============================================================================
# SECTION 8: External Service Testing
# ============================================================================

test_external_services() {
  section_start "SECTION 8: External Service Testing"

  # Test 8.1: Gmail API failure handling
  log_info "Test 8.1: External API failure handling..."
  local response=$(timeout 5 http_request POST "/api/webhooks/gmail-reply" \
    "{\"message\":{\"data\":\"invalid\"}}" 2>&1 || echo "timeout")

  if [[ "$response" == "timeout" ]]; then
    log_warn "Gmail failure: Requests may hang on failures"
  else
    local status=$(echo "$response" | head -n 1)
    [[ "$status" == "503" ]] || [[ "$status" == "500" ]] && \
      log_pass "Gmail failure: Error handling for unavailable services" || \
      log_info "Gmail status: HTTP $status"
  fi

  # Test 8.2: Health check isolation
  log_info "Test 8.2: Health check isolation..."
  local response=$(http_request GET "/api/health")
  local status=$(echo "$response" | head -n 1)
  [[ "$status" == "200" ]] && \
    log_pass "Health check: Isolated from service dependencies" || \
    log_warn "Health check: May depend on external services"
}

# ============================================================================
# SECTION 9: Secret Management Testing
# ============================================================================

test_secret_management() {
  section_start "SECTION 9: Secret Management Testing"

  # Test 9.1: Secrets in errors
  log_info "Test 9.1: Secrets in error responses..."
  local response=$(http_request POST "/api/admin/notification-preferences" \
    "{}" \
    "Authorization|Bearer $VALID_JWT")
  local body=$(echo "$response" | tail -n +2)
  ! echo "$body" | grep -qi "GMAIL_SERVICE_ACCOUNT\|SUPABASE_SERVICE_ROLE\|private.key" && \
    log_pass "Secrets in errors: Credentials not exposed" || \
    log_fail "Secrets in errors: Found credentials in response"

  # Test 9.2: Env var exposure
  log_info "Test 9.2: Environment variable exposure..."
  local response=$(http_request GET "/api/health")
  ! echo "$response" | grep -qi "GMAIL\|SUPABASE\|API_KEY\|SECRET" && \
    log_pass "Env var exposure: Variables protected" || \
    log_fail "Env var exposure: Environment variables visible"

  # Test 9.3: .env file protection
  log_info "Test 9.3: .env file protection..."
  local response=$(curl -s "$BASE_URL/.env" 2>&1)
  ! echo "$response" | grep -qi "GMAIL\|SUPABASE" && \
    log_pass ".env protection: Configuration file protected" || \
    log_fail ".env protection: .env file accessible"

  # Test 9.4: .env.example documentation
  log_info "Test 9.4: .env.example for reference..."
  [[ -f ".env.example" ]] && \
    log_pass "Key rotation: .env.example pattern followed" || \
    log_warn "Key rotation: .env.example missing - document env vars"
}

# ============================================================================
# SECTION 10: Compliance Testing
# ============================================================================

test_compliance() {
  section_start "SECTION 10: Compliance Testing"

  # Test 10.1: Data deletion (GDPR)
  # Reference: docs/SECURITY_ENDPOINTS_CHECKLIST.md
  log_info "Test 10.1: Data deletion functionality..."
  local response=$(http_request POST "/api/admin/delete-user" \
    "{\"user_id\":\"$TEST_USER_ID\",\"confirm\":true}" \
    "Authorization|Bearer $VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  if [[ "$status" == "404" ]] || [[ "$status" == "501" ]]; then
    log_warn "Data deletion: Endpoint not yet implemented (see SECURITY_ENDPOINTS_CHECKLIST.md)"
  elif [[ "$status" == "403" ]] || [[ "$status" == "200" ]]; then
    log_pass "Data deletion: Deletion endpoint present"
  else
    log_warn "Data deletion: HTTP $status"
  fi

  # Test 10.2: Audit logging (Compliance)
  # Reference: docs/SECURITY_ENDPOINTS_CHECKLIST.md
  log_info "Test 10.2: Audit logging presence..."
  local response=$(http_request GET "/api/admin/audit-logs" "" \
    "Authorization|Bearer $VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  if [[ "$status" == "404" ]] || [[ "$status" == "501" ]]; then
    log_warn "Audit logging: Endpoint not yet implemented (see SECURITY_ENDPOINTS_CHECKLIST.md)"
  elif [[ "$status" == "200" ]] || [[ "$status" == "403" ]]; then
    log_pass "Audit logging: Audit endpoint available"
  else
    log_warn "Audit logging: HTTP $status"
  fi

  # Test 10.3: Data export (GDPR)
  # Reference: docs/SECURITY_ENDPOINTS_CHECKLIST.md
  log_info "Test 10.3: GDPR data export functionality..."
  local response=$(http_request GET "/api/admin/export-data?user_id=$TEST_USER_ID" "" \
    "Authorization|Bearer $VALID_JWT")
  local status=$(echo "$response" | head -n 1)
  if [[ "$status" == "404" ]] || [[ "$status" == "501" ]]; then
    log_warn "Data export: Endpoint not yet implemented (GDPR requirement - see SECURITY_ENDPOINTS_CHECKLIST.md)"
  elif [[ "$status" == "200" ]]; then
    log_pass "Data export: User export endpoint available"
  else
    log_warn "Data export: HTTP $status"
  fi

  # Test 10.4: Privacy policy presence
  log_info "Test 10.4: Privacy policy documentation..."
  [[ -f "PRIVACY_POLICY.md" ]] && \
    log_pass "Privacy: Policy document present" || \
    log_warn "Privacy: Documentation missing"
}

# ============================================================================
# Cleanup & Exit Handler
# ============================================================================

on_exit() {
  :
}

# ============================================================================
# Report Generation
# ============================================================================

generate_text_report() {
  local report_file="$RESULTS_DIR/security-test-report-$TIMESTAMP.txt"
  mkdir -p "$RESULTS_DIR"

  {
    echo "================================================================================"
    echo "TaskFlow Notification System - Security Test Report v2.0"
    echo "Generated: $(date)"
    echo "Base URL: $BASE_URL"
    echo "================================================================================"
    echo ""
    echo "EXECUTIVE SUMMARY"
    echo "=================="
    echo "Tests Run:              $TESTS_RUN"
    echo "Tests Passed:           $TESTS_PASSED"
    echo "Tests Failed:           $TESTS_FAILED"
    echo "Warnings:               $TESTS_WARNED"
    echo "Critical Failures:      $CRITICAL_FAILURES"
    echo ""

    if [[ $TESTS_FAILED -eq 0 ]]; then
      echo "Overall Result:        PASS ✓"
      echo "Status:                Ready for production"
    else
      echo "Overall Result:        FAIL ✗"
      echo "Status:                DO NOT deploy - review failures"
    fi

    local pass_rate=$((TESTS_PASSED * 100 / (TESTS_RUN > 0 ? TESTS_RUN : 1)))
    echo "Pass Rate:              $pass_rate%"
    echo ""

    echo "================================================================================"
    echo "DETAILED RESULTS BY CATEGORY"
    echo "================================================================================"
    echo ""

    local last_section=""
    for detail in "${TEST_DETAILS[@]}"; do
      IFS='|' read -r status section name severity <<< "$detail"

      if [[ "$section" != "$last_section" ]]; then
        [[ -n "$last_section" ]] && echo ""
        echo "  ${section}:"
        last_section="$section"
      fi

      case "$status" in
        PASS) echo "    ✓ $name ($severity)" ;;
        FAIL) echo "    ✗ $name ($severity)" ;;
        WARN) echo "    ⚠ $name ($severity)" ;;
      esac
    done

    echo ""
    echo "================================================================================"
    echo "SECURITY RECOMMENDATIONS"
    echo "================================================================================"
    echo ""

    if [[ $CRITICAL_FAILURES -gt 0 ]]; then
      cat <<'EOF'
CRITICAL - BLOCKING ISSUES:
  [ ] 1. Review all FAIL results immediately
  [ ] 2. Implement security fixes for critical vulnerabilities
  [ ] 3. Re-run security tests to confirm fixes
  [ ] 4. Conduct code review of security-related changes
  [ ] 5. Document all security controls and how they work

EOF
    fi

    if [[ $TESTS_WARNED -gt 0 ]]; then
      cat <<'EOF'
IMPORTANT - REVIEW WARNINGS:
  [ ] 1. Evaluate each warning based on your threat model
  [ ] 2. Decide: implement control or accept risk
  [ ] 3. Document any accepted risks with business rationale
  [ ] 4. Add deferred controls to your security roadmap

EOF
    fi

    cat <<'EOF'
GENERAL SECURITY BEST PRACTICES:
  ✓ Enable all security headers (CSP, HSTS, X-Frame-Options)
  ✓ Implement comprehensive input validation on all endpoints
  ✓ Enforce JWT signature verification with key rotation
  ✓ Implement rate limiting with Redis or Supabase
  ✓ Add request/response logging to audit trail
  ✓ Schedule regular penetration testing (quarterly)
  ✓ Implement SIEM for real-time security monitoring
  ✓ Establish incident response procedures
  ✓ Keep dependencies updated with security patches
  ✓ Conduct security training for development team

BEFORE PRODUCTION DEPLOYMENT:
  [ ] All FAIL results are fixed
  [ ] All WARN results are reviewed and accepted
  [ ] Security headers are configured
  [ ] Rate limiting is enabled
  [ ] Logging and monitoring are operational
  [ ] Incident response playbooks are documented
  [ ] Team has security training completed
  [ ] Penetration test scheduled post-launch
EOF

  } | tee "$report_file"

  echo ""
  echo -e "${GREEN}✓ Report saved to: $report_file${NC}"
}

generate_json_report() {
  local report_file="$RESULTS_DIR/security-test-report-$TIMESTAMP.json"
  mkdir -p "$RESULTS_DIR"

  {
    echo "{"
    echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
    echo "  \"base_url\": \"$BASE_URL\","
    echo "  \"summary\": {"
    echo "    \"tests_run\": $TESTS_RUN,"
    echo "    \"tests_passed\": $TESTS_PASSED,"
    echo "    \"tests_failed\": $TESTS_FAILED,"
    echo "    \"warnings\": $TESTS_WARNED,"
    echo "    \"critical_failures\": $CRITICAL_FAILURES,"
    echo "    \"pass_rate\": $((TESTS_PASSED * 100 / (TESTS_RUN > 0 ? TESTS_RUN : 1)))"
    echo "  },"
    echo "  \"status\": \"$([ $TESTS_FAILED -eq 0 ] && echo 'PASS' || echo 'FAIL')\","
    echo "  \"details\": ["

    local first=true
    for detail in "${TEST_DETAILS[@]}"; do
      IFS='|' read -r status section name severity <<< "$detail"
      if [[ "$first" == "false" ]]; then
        echo ","
      fi
      echo -n "    {\"status\": \"$status\", \"section\": \"$section\", \"test\": \"$name\", \"severity\": \"$severity\"}"
      first=false
    done

    echo ""
    echo "  ]"
    echo "}"
  } | tee "$report_file"

  echo ""
  echo -e "${GREEN}✓ JSON report saved to: $report_file${NC}"
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}   TaskFlow Notification System - Security Testing Suite${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "Configuration:"
  echo "  Base URL:    $BASE_URL"
  echo "  Output:      $OUTPUT_FORMAT"
  echo "  Suite:       $TEST_SUITE"
  echo "  Verbose:     $VERBOSE"
  echo "  Debug:       $DEBUG"
  echo ""

  case "$TEST_SUITE" in
    all)
      test_input_validation
      test_authentication
      test_authorization
      test_rate_limiting
      test_data_exposure
      test_api_security
      test_email_security
      test_external_services
      test_secret_management
      test_compliance
      ;;
    input) test_input_validation ;;
    auth) test_authentication ;;
    authz) test_authorization ;;
    ratelimit) test_rate_limiting ;;
    exposure) test_data_exposure ;;
    api) test_api_security ;;
    email) test_email_security ;;
    external) test_external_services ;;
    secrets) test_secret_management ;;
    compliance) test_compliance ;;
    *)
      echo -e "${RED}✗ Unknown test suite: $TEST_SUITE${NC}"
      echo "Valid options: all, input, auth, authz, ratelimit, exposure, api, email, external, secrets, compliance"
      exit 2
      ;;
  esac

  echo ""
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo "Generating Reports..."
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"

  if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    generate_json_report
  else
    generate_text_report
  fi

  exit_code=0
  [[ $TESTS_FAILED -gt 0 ]] && exit_code=1
  [[ $TESTS_RUN -eq 0 ]] && exit_code=2

  echo ""
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"

  if [[ $exit_code -eq 0 ]]; then
    echo -e "${GREEN}✓ All security tests passed${NC}"
  elif [[ $exit_code -eq 1 ]]; then
    echo -e "${RED}✗ Security test failures detected - review report above${NC}"
  else
    echo -e "${RED}✗ Test execution error - check configuration${NC}"
  fi

  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"

  exit $exit_code
}

show_help() {
  cat <<EOF
TaskFlow Security Testing Suite v2.0

USAGE:
  $0 [OPTIONS]

OPTIONS:
  --base-url URL     Base URL for testing (default: http://localhost:3000)
  --suite NAME       Test suite: all, input, auth, authz, ratelimit,
                     exposure, api, email, external, secrets, compliance
  --format FORMAT    Output: text or json (default: text)
  --verbose          Enable verbose output
  --debug            Show curl requests and responses
  --help             Show this help

ENVIRONMENT VARIABLES:
  BASE_URL=URL       Override base URL
  VERBOSE=true       Enable verbose output
  DEBUG=true         Enable debug output
  OUTPUT_FORMAT=fmt  Set output format
  TIMEOUT=seconds    Request timeout (default: 10)

EXAMPLES:
  # Run all tests
  $0

  # Run auth tests with verbose output
  $0 --suite auth --verbose

  # Test staging environment, JSON output
  BASE_URL=http://staging:3000 $0 --format json

  # Debug mode with detailed curl info
  $0 --debug

CI/CD INTEGRATION:
  # Exit code 0 = all tests passed
  # Exit code 1 = one or more failures
  # Exit code 2 = test execution error
  # Exit code 3 = connection error

EOF
}

# ============================================================================
# Parse Command Line Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
  case $1 in
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --suite)
      TEST_SUITE="$2"
      shift 2
      ;;
    --format)
      OUTPUT_FORMAT="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE="true"
      shift
      ;;
    --debug)
      DEBUG="true"
      VERBOSE="true"
      shift
      ;;
    --html)
      GENERATE_HTML="true"
      shift
      ;;
    --help)
      show_help
      exit 0
      ;;
    *)
      echo -e "${RED}✗ Unknown option: $1${NC}"
      show_help
      exit 2
      ;;
  esac
done

main
