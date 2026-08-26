# TaskFlow Notification System - Production Configuration Checklist

**Last Updated:** 2026-08-18  
**Status:** DRAFT - Pre-Deployment Review  
**Audience:** DevOps, Platform Engineering, Security Team

---

## Executive Summary

This checklist validates production readiness of configuration files across:
- **Monitoring & Alerting** (ops/1-monitoring-alerts.yaml)
- **Metrics Dashboard** (ops/6-metrics-dashboard.json)
- **Load Testing** (testing/1-load-testing.yaml)
- **Security Testing** (testing/2-security-testing.sh)
- **Error Tracking** (ops/7-error-tracking-config.md)

**Current Status:** ⚠️ **NOT PRODUCTION-READY** - Multiple configuration gaps and missing integrations identified.

---

## SECTION 1: Critical Blockers (MUST FIX BEFORE PRODUCTION)

### 1.1 External Service Credentials & URLs

**Issue:** Multiple placeholder values that block production deployment.

| File | Location | Current Value | Required | Status |
|------|----------|---------------|----------|--------|
| 1-monitoring-alerts.yaml | Line 437 | `${SLACK_WEBHOOK_URL}` | ✓ REQUIRED | ❌ MISSING |
| 1-monitoring-alerts.yaml | Line 450 | `${PAGERDUTY_INTEGRATION_KEY}` | ✓ REQUIRED | ❌ MISSING |
| 1-monitoring-alerts.yaml | Line 478-481 | Twilio credentials | ✓ REQUIRED | ❌ MISSING |
| 1-monitoring-alerts.yaml | Line 552 | `${PRIMARY_ON_CALL_USER_ID}` | ✓ REQUIRED | ❌ MISSING |
| 6-metrics-dashboard.json | Line 124 | `taskflow-kanban-prototype` | ✓ REQUIRED | ❌ NEEDS CHANGE |
| 6-metrics-dashboard.json | Line 125 | `personal` team | ✓ REQUIRED | ❌ NEEDS CHANGE |
| 6-metrics-dashboard.json | Line 126 | `us-east-1` region | ✓ REQUIRED | ❌ NEEDS CHANGE |
| 7-error-tracking-config.md | Section 1.2 | `SENTRY_DSN=https://examplePublicKey@...` | ✓ REQUIRED | ❌ MISSING |
| 7-error-tracking-config.md | Line 145 | `sentry_auth_token` | ✓ REQUIRED | ❌ MISSING |

**Remediation Steps:**
```bash
# 1. Create Slack Webhook (Slack App → Incoming Webhooks)
# Copy URL to .env.production
echo "SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL" >> .env.production

# 2. Create PagerDuty Integration (PagerDuty → Services → Create Integration)
echo "PAGERDUTY_INTEGRATION_KEY=<integration-key>" >> .env.production

# 3. Setup Twilio (Twilio Console → Phone Numbers & Credentials)
echo "TWILIO_ACCOUNT_SID=<sid>" >> .env.production
echo "TWILIO_AUTH_TOKEN=<token>" >> .env.production
echo "TWILIO_FROM_NUMBER=<number>" >> .env.production

# 4. Create Sentry Project (sentry.io → Projects → Create)
echo "SENTRY_DSN=https://<key>@sentry.io/<project-id>" >> .env.production
echo "SENTRY_AUTH_TOKEN=<token>" >> .env.production

# 5. Validate all credentials
npm run validate:config:production
```

**Timeline:** ⏰ **CRITICAL** - Must complete before any production deployment

---

### 1.2 Hardcoded Local References

**Issue:** Multiple references to `localhost`, `example.com`, `taskflow.local` that will fail in production.

| File | Line | Pattern | Issue | Fix |
|------|------|---------|-------|-----|
| 1-monitoring-alerts.yaml | 134 | `taskflow.example.com/runbooks/...` | 21 occurrences | Replace with `${RUNBOOK_BASE_URL}` |
| 6-metrics-dashboard.json | 2 | `taskflow.local/ops/schemas/...` | Schema URL | Use relative or CDN path |
| 6-metrics-dashboard.json | 1349 | `https://api.taskflow.local/metrics` | API base | Use `${METRICS_API_URL}` |
| 7-error-tracking-config.md | 193 | `localhost:3000` (Vercel logs) | Dev reference | Use production URL |
| 2-security-testing.sh | 58 | `http://localhost:3000` | Default test URL | Use `${TEST_BASE_URL}` |

**Action Items:**
- [ ] Replace all runbook URLs with environment variable
- [ ] Replace all local domain references with environment variables
- [ ] Create .env.example with all required variables
- [ ] Add validation to CI/CD to catch hardcoded URLs

**Timeline:** ⏰ **CRITICAL** - Must fix before staging deployment

---

### 1.3 Missing Environment Variable Documentation

**Issue:** No `.env.example` file documenting all required configuration.

**Required .env Variables (not documented):**

```bash
# Slack Integration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SLACK_BOT_TOKEN=xoxb-...

# PagerDuty Integration
PAGERDUTY_INTEGRATION_KEY=xxx...
PAGERDUTY_ROUTING_KEY=xxx...
PAGERDUTY_API_TOKEN=xxx...

# Twilio SMS
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...

# On-Call Contacts
PRIMARY_ON_CALL_USER_ID=user_123
SECONDARY_ON_CALL_USER_ID=user_456
ENGINEERING_LEAD_USER_ID=user_789
ON_CALL_PRIMARY_PHONE=+1-555-0123

# Sentry
SENTRY_DSN=https://key@sentry.io/project
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=@taskflow/notifications@1.0.0
SENTRY_AUTH_TOKEN=token...

# Datadog (Optional)
DATADOG_API_KEY=xxx...
DATADOG_APP_KEY=xxx...

# Monitoring & Alerts
RUNBOOK_BASE_URL=https://docs.yourcompany.com/runbooks
METRICS_API_URL=https://api.prod.taskflow.com/metrics
TEST_BASE_URL=https://staging.taskflow.com  # For load tests

# Vercel (if applicable)
VERCEL_TOKEN=xxx...
VERCEL_PROJECT_ID=xxx...

# Redis
REDIS_HOST=redis.prod.internal
REDIS_PORT=6379
REDIS_PASSWORD=secure-password

# Database
SUPABASE_HOST=db.supabase.co
SUPABASE_USER=postgres
SUPABASE_PASSWORD=secure-password

# Email
GMAIL_SERVICE_ACCOUNT={"type":"service_account",...}
```

**Action Item:**
```bash
# Create comprehensive .env.example
cat > .env.example << 'EOF'
# ... (all variables above)
EOF

# Add to .gitignore (ensure secrets are never committed)
echo ".env.production" >> .gitignore
echo ".env.staging" >> .gitignore
echo "*.key" >> .gitignore
```

**Timeline:** ⏰ **CRITICAL** - Blocks secure credential management

---

## SECTION 2: Important Issues (SHOULD FIX BEFORE PRODUCTION)

### 2.1 Monitoring & Alerts Configuration

#### 2.1.1 Missing Threshold Validation Against SLA

**Issue:** KPI thresholds are defined but not validated against actual business SLA contracts.

**Missing Documentation:**
- [ ] SLA contracts with customers defining response time targets
- [ ] Error rate thresholds based on actual capacity
- [ ] Revenue impact of different alert severities
- [ ] Customer escalation requirements

**Action Item:**
```yaml
# Add to ops/1-monitoring-alerts.yaml
sla_contracts:
  # Example - update with actual contracts
  taskflow_standard:
    api_latency_p95: 500ms  # From contract
    uptime_monthly: 99.5%   # From contract
    error_rate_max: 0.1%    # From contract
    
  taskflow_premium:
    api_latency_p95: 300ms
    uptime_monthly: 99.95%
    error_rate_max: 0.05%
```

#### 2.1.2 Unvalidated External Service URLs

**Issue:** Runbook URLs hardcoded but endpoints not verified to exist.

**Verification Checklist:**
- [ ] Visit all 21 runbook URLs and confirm they exist
- [ ] Confirm runbooks have: diagnosis steps, remediation steps, escalation policy
- [ ] Test all Slack webhook URL actually works
- [ ] Confirm PagerDuty integration key is valid
- [ ] Test Twilio SMS delivery

**Suggested Testing:**
```bash
#!/bin/bash
# scripts/validate-external-urls.sh

# Test Slack webhook
curl -X POST "$SLACK_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Webhook test from production config"}'

# Test PagerDuty
curl -X GET "https://api.pagerduty.com/teams" \
  -H "Authorization: Token token=$PAGERDUTY_API_TOKEN" \
  -H "Accept: application/vnd.pagerduty+json;version=2"

# Test Twilio SMS
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages" \
  -d "From=$TWILIO_FROM_NUMBER&To=$ON_CALL_PRIMARY_PHONE&Body=Test"

# Validate all runbook URLs return 200
for url in $(grep -o 'https://taskflow\..*runbooks/[^"]*' ops/1-monitoring-alerts.yaml | sort -u); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$status" != "200" ]; then
    echo "❌ Runbook URL returned $status: $url"
  fi
done
```

---

### 2.2 Metrics Dashboard Configuration

#### 2.2.1 Platform Integration Not Enabled

**Issue:** Datadog integration is marked `enabled: false` but Datadog metrics referenced.

**Current State:**
```json
"datadog": {
  "enabled": false,
  "integrationMethod": "optional",
  ...
}
```

**Decision Required:**
- [ ] Option A: Enable Datadog integration
  - [ ] Create Datadog organization/project
  - [ ] Configure API keys
  - [ ] Setup metric collection
  - [ ] Cost: ~$500-2000/month depending on volume
  
- [ ] Option B: Disable Datadog completely
  - [ ] Remove all Datadog metric references
  - [ ] Remove Datadog from dashboard config
  - [ ] Simplify to Vercel-only monitoring

**Recommendation:** Start with Vercel Analytics only (included free), add Datadog if needed later.

#### 2.2.2 Email Recipients Not Updated

**Current:**
```json
"recipients": ["executives@taskflow.local", "ops-team@taskflow.local"]
```

**Should Be:**
```json
"recipients": ["${EXEC_EMAIL_LIST}", "${OPS_EMAIL_LIST}"]
```

**Action Items:**
- [ ] Define distribution lists for each team
- [ ] Add to .env.production:
  ```bash
  EXEC_EMAIL_LIST=execs@company.com
  OPS_EMAIL_LIST=ops@company.com
  ONCALL_EMAIL=oncall@company.com
  ```

---

### 2.3 Load Testing Configuration

#### 2.3.1 Undefined Test Credentials

**Issue:** Load tests reference placeholder credentials that don't exist.

**Current State (Line 388):**
```yaml
environment_variables:
  BASE_URL: "http://localhost:3000 or https://staging.taskflow.app"
  AUTH_TOKEN: "Bearer {valid_jwt_token}"
  TEST_USER_ID: "{user_id_for_testing}"
  ORGANIZATION_ID: "{org_id_for_testing}"
```

**Problem:** These placeholders need actual values to run tests.

**Setup Required:**
```bash
#!/bin/bash
# scripts/setup-load-test-credentials.sh

# 1. Create test user in Supabase
TEST_USER=$(curl -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "loadtest-user-'$(date +%s)'@test.com",
    "password": "'$(openssl rand -hex 16)'"
  }')

TEST_USER_ID=$(echo $TEST_USER | jq -r '.user.id')

# 2. Create test organization
TEST_ORG=$(curl -X POST "$API_URL/api/orgs" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Load Test Org"}')

ORG_ID=$(echo $TEST_ORG | jq -r '.id')

# 3. Generate JWT for test user
JWT=$(node -e "
const jwt = require('jsonwebtoken');
console.log(jwt.sign(
  { sub: '$TEST_USER_ID', org_id: '$ORG_ID' },
  '$JWT_SECRET',
  { expiresIn: '1h' }
))
")

# 4. Export for load tests
export AUTH_TOKEN="Bearer $JWT"
export TEST_USER_ID="$TEST_USER_ID"
export ORGANIZATION_ID="$ORG_ID"
export BASE_URL="${BASE_URL:-https://staging.taskflow.app}"

echo "✓ Load test credentials configured"
echo "  TEST_USER_ID=$TEST_USER_ID"
echo "  ORGANIZATION_ID=$ORG_ID"
```

#### 2.3.2 Missing Load Test Baseline

**Issue:** No baseline performance metrics to compare against.

**Recommendation:**
```bash
# 1. Run baseline test first
k6 run --tag testid=baseline-001 load-test.js -s baseline > baseline-results.json

# 2. Commit baseline to git
git add testing/results/baseline-results.json
git commit -m "docs: Add load test baseline for performance regression detection"

# 3. Future regression detection
# Before each production deployment, run:
k6 run --tag testid=pre-prod-check load-test.js > latest-results.json

# Compare: if p95 latency > 1.1x baseline, fail deployment
python scripts/compare-load-tests.py baseline-results.json latest-results.json --threshold=1.1
```

---

### 2.4 Security Testing Configuration

#### 2.4.1 Tests Assume Non-Existent Endpoints

**Issue:** Security test script tests endpoints that don't exist yet.

| Test | Endpoint | Status | Required |
|------|----------|--------|----------|
| 10.1 | POST /api/admin/delete-user | ❌ Missing | ⚠️ GDPR Required |
| 10.2 | GET /api/admin/audit-logs | ❌ Missing | ✓ Recommended |
| 10.3 | GET /api/user/export-data | ❌ Missing | ⚠️ GDPR Required |

**Action Items:**
- [ ] Implement GDPR compliance endpoints (10.1, 10.3 are GDPR requirements)
- [ ] Implement audit logging endpoint
- [ ] Re-run security tests after implementation

**GDPR Implementation Required:**
```typescript
// app/api/user/export-data.ts - GDPR Data Export
export async function GET(req: Request) {
  const userId = req.user?.id;
  
  return {
    personalData: {
      profile: await getUserProfile(userId),
      preferences: await getNotificationPreferences(userId),
      activityLog: await getActivityLog(userId),
    },
    format: "application/json",
  };
}

// app/api/admin/delete-user.ts - GDPR Right to Deletion
export async function POST(req: Request) {
  const { userId } = req.body;
  
  // 1. Delete all personal data
  // 2. Anonymize records where needed
  // 3. Log deletion request
  // 4. Return confirmation with deletion reference
  
  return { success: true, deletionId: "del_..." };
}
```

#### 2.4.2 Test Rate Limiting Could Cause Issues

**Issue:** Security tests make rapid requests (Section 4.1) which could:
- Trigger DDoS protection
- Exhaust rate limits prematurely
- Fail tests on production-like environments

**Recommendation:**
```bash
# In 2-security-testing.sh, add rate limiting protection
RATE_LIMIT_DELAY=1  # seconds between requests to same endpoint

# Modify all loops to respect rate limiting:
for i in {1..10}; do
  local response=$(http_request POST "/api/webhooks/gmail-reply" "${data}")
  sleep "$RATE_LIMIT_DELAY"  # Add delay between requests
done
```

#### 2.4.3 Missing Production Safety Guardrails

**Issue:** Security tests could be run against production and cause issues.

**Recommendation:**
```bash
# Add safety checks to 2-security-testing.sh
if [[ "$BASE_URL" == *"production"* ]] || [[ "$BASE_URL" == *"prod"* ]]; then
  echo "❌ ERROR: Security tests cannot run against production"
  echo "   Use staging environment: BASE_URL=https://staging.taskflow.app"
  exit 1
fi

# Only allow specific safe environments
ALLOWED_ENVIRONMENTS=("localhost" "staging" "test")
for env in "${ALLOWED_ENVIRONMENTS[@]}"; do
  if [[ "$BASE_URL" == *"$env"* ]]; then
    SAFE=true
    break
  fi
done

if [ "$SAFE" != "true" ]; then
  echo "⚠️  WARNING: Unrecognized environment: $BASE_URL"
  echo "   Please use one of: ${ALLOWED_ENVIRONMENTS[@]}"
  read -p "Continue? (yes/no): " confirm
  [[ "$confirm" != "yes" ]] && exit 1
fi
```

---

### 2.5 Error Tracking Configuration

#### 2.5.1 Sentry Project Not Created

**Issue:** Config references Sentry project but doesn't document how to create it.

**Setup Steps:**
```bash
# 1. Create Sentry account (sentry.io)
# 2. Create organization
# 3. Create projects for each environment
curl -X POST https://sentry.io/api/0/organizations/YOUR_ORG/projects/ \
  -H "Authorization: Bearer $SENTRY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "taskflow-notifications-production",
    "platform": "node",
    "teams": ["YOUR_TEAM_ID"]
  }'

# 4. Get project ID and DSN
# 5. Add to .env.production:
echo "SENTRY_DSN=https://<key>@sentry.io/<project-id>" >> .env.production
echo "SENTRY_AUTH_TOKEN=<token>" >> .env.production
```

#### 2.5.2 PII Scrubbing Rules Incomplete

**Current Pattern Examples:**
```regex
email: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi
```

**Missing Patterns:**
- [ ] Supabase API keys: `sbp_`, `sba_`
- [ ] JWT tokens in logs
- [ ] Datadog API keys
- [ ] Google OAuth tokens
- [ ] Internal user IDs in error messages

**Enhanced PII Patterns:**
```typescript
const PII_PATTERNS = {
  email: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi,
  phone: /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/g,
  creditCard: /(\d{4}[\s-]?){3}\d{4}/g,
  ssn: /\d{3}-\d{2}-\d{4}/g,
  apiKey: /(api[_-]?key|secret|token)\s*[:=]\s*([a-zA-Z0-9_-]+)/gi,
  supabaseKey: /(sbp_|sba_)[a-zA-Z0-9_-]+/g,
  jwtToken: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[\w-]+/g,
  googleToken: /ya29\.[A-Za-z0-9_-]+/g,
  userId: /user[_-]?id["\s:=]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi,
};
```

#### 2.5.3 Insufficient Logging for Compliance

**Issue:** Audit logging not fully configured for compliance (GDPR, SOC2).

**Missing Audit Logs:**
- [ ] User access to personal data (who, when, why)
- [ ] Configuration changes (who, what, when)
- [ ] Deletion requests and completion
- [ ] Security incidents and response actions
- [ ] Admin actions and overrides

**SQL Schema Needed:**
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP DEFAULT NOW(),
  user_id UUID REFERENCES auth.users,
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(100),
  changes JSONB,  -- What changed
  ip_address INET,
  user_agent TEXT,
  reason VARCHAR(255),  -- Why was action taken
  status VARCHAR(20),   -- success/failed
  error_details TEXT,   -- If failed
  
  INDEX (timestamp),
  INDEX (user_id),
  INDEX (resource_type, resource_id)
);
```

---

## SECTION 3: Configuration Validation Commands

### 3.1 Pre-Deployment Validation Script

Create `scripts/validate-production-config.sh`:

```bash
#!/bin/bash
set -e

echo "════════════════════════════════════════════════════════════"
echo "Production Configuration Validation"
echo "════════════════════════════════════════════════════════════"
echo ""

ERRORS=0
WARNINGS=0

# Color codes
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

check_var() {
  local name=$1
  local value=${!name}
  
  if [ -z "$value" ]; then
    echo -e "${RED}✗${NC} Missing required: $name"
    ((ERRORS++))
  else
    echo -e "${GREEN}✓${NC} $name is set"
  fi
}

check_url() {
  local name=$1
  local url=$2
  local status=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")
  
  if [ "$status" = "200" ] || [ "$status" = "301" ] || [ "$status" = "302" ]; then
    echo -e "${GREEN}✓${NC} $name responds with HTTP $status"
  else
    echo -e "${YELLOW}⚠${NC} $name returned HTTP $status"
    ((WARNINGS++))
  fi
}

check_file() {
  local path=$1
  
  if [ -f "$path" ]; then
    echo -e "${GREEN}✓${NC} File exists: $path"
  else
    echo -e "${RED}✗${NC} Missing file: $path"
    ((ERRORS++))
  fi
}

echo "1. ENVIRONMENT VARIABLES"
echo "========================"
check_var SLACK_WEBHOOK_URL
check_var PAGERDUTY_INTEGRATION_KEY
check_var SENTRY_DSN
check_var TWILIO_ACCOUNT_SID
check_var REDIS_HOST
echo ""

echo "2. CONFIGURATION FILES"
echo "====================="
check_file "ops/1-monitoring-alerts.yaml"
check_file "ops/6-metrics-dashboard.json"
check_file "ops/7-error-tracking-config.md"
check_file ".env.production"
echo ""

echo "3. EXTERNAL SERVICES"
echo "===================="
check_url "Slack Webhook" "$SLACK_WEBHOOK_URL"
check_url "Sentry" "https://sentry.io"
echo ""

echo "4. FILE CONTENT VALIDATION"
echo "=========================="
if grep -q "localhost" ops/1-monitoring-alerts.yaml; then
  echo -e "${YELLOW}⚠${NC} Found localhost references in ops/1-monitoring-alerts.yaml"
  ((WARNINGS++))
else
  echo -e "${GREEN}✓${NC} No localhost references found"
fi

if grep -q "example.com" ops/1-monitoring-alerts.yaml; then
  echo -e "${RED}✗${NC} Found example.com references (not production-ready)"
  ((ERRORS++))
else
  echo -e "${GREEN}✓${NC} No example.com references"
fi

if grep -q "taskflow.local" ops/6-metrics-dashboard.json; then
  echo -e "${RED}✗${NC} Found taskflow.local in metrics config"
  ((ERRORS++))
else
  echo -e "${GREEN}✓${NC} No taskflow.local references"
fi
echo ""

echo "════════════════════════════════════════════════════════════"
echo "SUMMARY"
echo "════════════════════════════════════════════════════════════"
echo -e "Errors:   ${RED}$ERRORS${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ Configuration is production-ready${NC}"
  exit 0
else
  echo -e "${RED}✗ Configuration has blocking errors${NC}"
  exit 1
fi
```

### 3.2 Pre-Deployment Checklist

```bash
# Run before any production deployment
chmod +x scripts/validate-production-config.sh
./scripts/validate-production-config.sh

# Validate load test can run
k6 run testing/1-load-testing.yaml -s baseline --dry-run

# Validate security tests
BASE_URL=https://staging.taskflow.app bash testing/2-security-testing.sh --suite compliance

# Validate Sentry configuration
npm run sentry:health-check

# Validate alert routing
npm run validate:alerts:routing
```

---

## SECTION 4: Environment-Specific Overrides

### 4.1 Development Environment

**File:** `.env.development`

```bash
# LOCAL DEVELOPMENT
BASE_URL=http://localhost:3000
NODE_ENV=development

# Slack (optional for dev, can use test webhook)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/WEBHOOK_FOR_DEV

# Sentry (optional, can disable)
SENTRY_DSN=
SENTRY_ENVIRONMENT=development

# Redis (local)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# No rate limiting in dev
RATE_LIMIT_ENABLED=false
```

### 4.2 Staging Environment

**File:** `.env.staging`

```bash
# STAGING
BASE_URL=https://staging.taskflow.app
NODE_ENV=staging

# Full monitoring
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/STAGING_WEBHOOK
PAGERDUTY_INTEGRATION_KEY=staging_key_xxx

# Sentry staging project
SENTRY_DSN=https://key@sentry.io/staging_project_id
SENTRY_ENVIRONMENT=staging

# Datadog (if enabled)
DATADOG_ENABLED=false

# Production-like settings
RATE_LIMIT_ENABLED=true
ERROR_SAMPLING_RATE=0.5
```

### 4.3 Production Environment

**File:** `.env.production` (NOT checked into git)

```bash
# PRODUCTION
BASE_URL=https://taskflow.app
NODE_ENV=production

# Production Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/PROD_WEBHOOK

# Production PagerDuty
PAGERDUTY_INTEGRATION_KEY=prod_key_xxx

# Production Sentry
SENTRY_DSN=https://key@sentry.io/prod_project_id
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# Error sampling for cost control
ERROR_SAMPLING_RATE=0.1

# Production rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=1000
```

### 4.4 Load Testing Environment

**File:** `.env.load-test`

```bash
BASE_URL=https://staging.taskflow.app  # MUST be staging, never production
TEST_USER_ID=user-load-test-xxx
ORGANIZATION_ID=org-load-test-xxx
AUTH_TOKEN=Bearer eyJhbGc...

# K6 Configuration
K6_VUS=100
K6_DURATION=5m
K6_RAMP_UP=30s
```

---

## SECTION 5: External Service Integration Steps

### 5.1 Slack Integration

**Pre-Requisites:**
- [ ] Slack workspace with appropriate permissions
- [ ] Access to install apps

**Setup Steps:**
```bash
# 1. Go to https://api.slack.com/apps
# 2. Click "Create New App" → "From scratch"
# 3. Name: "TaskFlow Alerts", Workspace: [select]
# 4. Go to "Incoming Webhooks" → Enable
# 5. Click "Add New Webhook to Workspace"
# 6. Select channel #alerts-taskflow, Authorize
# 7. Copy webhook URL to .env.production:

SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX

# 8. Test webhook
curl -X POST "$SLACK_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Test message from configuration validation"}'
```

### 5.2 PagerDuty Integration

**Pre-Requisites:**
- [ ] PagerDuty account and escalation policy created
- [ ] Admin access to integrations

**Setup Steps:**
```bash
# 1. Go to https://pagerduty.com/app/services
# 2. Create a service: "TaskFlow Notifications"
# 3. Go to Integrations → Add Integration
# 4. Select: "Events API V2"
# 5. Copy Integration Key to .env.production:

PAGERDUTY_INTEGRATION_KEY=xxxxx

# 6. Test integration
curl -X POST https://events.pagerduty.com/v2/enqueue \
  -H 'Content-Type: application/json' \
  -d '{
    "routing_key": "'$PAGERDUTY_INTEGRATION_KEY'",
    "event_action": "trigger",
    "payload": {
      "summary": "Test alert from config validation",
      "severity": "warning",
      "source": "Configuration Validation"
    }
  }'
```

### 5.3 Sentry Integration

**Pre-Requisites:**
- [ ] Sentry account created
- [ ] Organization and team set up

**Setup Steps:**
```bash
# 1. Go to https://sentry.io
# 2. Create project: "TaskFlow Notifications"
# 3. Platform: Node.js
# 4. Copy DSN to .env.production:

SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxxx

# 5. Generate auth token
# Go to Settings → Auth Tokens → Create Token
# Scopes needed: project:read, project:write, org:read

SENTRY_AUTH_TOKEN=sntrys_xxxxx...

# 6. Test connection
curl -X GET https://sentry.io/api/0/organizations/your-org/projects/ \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  -H "Content-Type: application/json"

# 7. Upload source maps (after build)
sentry-cli sourcemaps upload --org your-org --project taskflow-notifications ./dist
```

### 5.4 Datadog Integration (Optional)

**Decision Point:** Only if monitoring Vercel + custom metrics needed.

**Setup Steps (if enabling):**
```bash
# 1. Go to https://app.datadoghq.com (US) or datadoghq.eu (EU)
# 2. Settings → Organization Settings → API Keys
# 3. Create API Key, copy to .env.production:

DATADOG_API_KEY=xxx...
DATADOG_APP_KEY=xxx...

# 4. Update ops/6-metrics-dashboard.json:
"datadog": {
  "enabled": true,
  "integrationMethod": "required",
  ...
}
```

---

## SECTION 6: Deployment Procedures

### 6.1 Pre-Deployment Checklist

**72 Hours Before:**
- [ ] Run configuration validation: `./scripts/validate-production-config.sh`
- [ ] Run security tests against staging: `BASE_URL=https://staging bash testing/2-security-testing.sh`
- [ ] Run load tests: `k6 run testing/1-load-testing.yaml`
- [ ] Review error trends in Sentry (if already running)

**24 Hours Before:**
- [ ] Verify all external services operational:
  - [ ] Slack webhooks working
  - [ ] PagerDuty API accessible
  - [ ] Sentry project receiving events
  - [ ] Twilio SMS endpoints responding
- [ ] Test alert routing in staging environment
- [ ] Confirm on-call contacts are current

**2 Hours Before:**
- [ ] Final configuration audit
- [ ] Notify team of deployment window
- [ ] Ensure incident response procedures documented
- [ ] Have rollback plan documented

### 6.2 Deployment Steps

```bash
#!/bin/bash
set -e

echo "🚀 Starting Production Deployment"

# 1. Validation
echo "1️⃣  Running pre-deployment validation..."
./scripts/validate-production-config.sh || exit 1

# 2. Deploy to production
echo "2️⃣  Deploying to production..."
git tag -a "deploy-$(date +%Y%m%d-%H%M%S)" -m "Production deployment"
git push --tags

# Vercel deployment (assuming Vercel is hosting)
vercel --prod

# 3. Verify deployment
echo "3️⃣  Verifying deployment health..."
sleep 30  # Wait for deployment to stabilize

# Health check
HEALTH=$(curl -s https://taskflow.app/api/health)
if echo "$HEALTH" | grep -q "healthy"; then
  echo "✅ Health check passed"
else
  echo "❌ Health check failed"
  echo "$HEALTH"
  exit 1
fi

# 4. Start monitoring
echo "4️⃣  Configuring production monitoring..."
# Automatically starts collecting metrics once deployed

# 5. Notify stakeholders
echo "5️⃣  Notifying team..."
curl -X POST "$SLACK_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "✅ Production deployment complete",
    "blocks": [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*Production Deployment Successful*\n• API: https://taskflow.app\n• Metrics: https://app.datadoghq.com\n• Errors: https://sentry.io"
        }
      }
    ]
  }'

echo "✅ Deployment complete!"
```

### 6.3 Rollback Procedures

```bash
#!/bin/bash

echo "🔄 Rolling back production..."

# Get previous stable version
PREVIOUS_VERSION=$(git describe --tags --abbrev=0 HEAD~1)

echo "Rolling back to: $PREVIOUS_VERSION"

# Rollback Vercel deployment
vercel rollback

# Verify rollback
sleep 30
HEALTH=$(curl -s https://taskflow.app/api/health)
if echo "$HEALTH" | grep -q "healthy"; then
  echo "✅ Rollback successful"
  
  # Notify team
  curl -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d '{
      "text": "⚠️ Production rolled back to previous version",
      "attachments": [{
        "color": "warning",
        "text": "Please investigate the deployment issue"
      }]
    }'
else
  echo "❌ Rollback failed - manual intervention needed"
  exit 1
fi
```

---

## SECTION 7: Post-Deployment Validation

### 7.1 Smoke Tests (Run Immediately After Deploy)

```bash
#!/bin/bash
# scripts/smoke-tests.sh

PROD_URL="https://taskflow.app"

echo "Running smoke tests..."

# Test 1: Health endpoint
echo "Testing /api/health..."
HEALTH=$(curl -s "$PROD_URL/api/health")
if echo "$HEALTH" | grep -q "healthy"; then
  echo "✓ Health endpoint OK"
else
  echo "✗ Health endpoint failed"
  exit 1
fi

# Test 2: API endpoint
echo "Testing notification API..."
RESULT=$(curl -s -X GET "$PROD_URL/api/admin/notification-preferences" \
  -H "Authorization: Bearer $PROD_TOKEN" \
  -w "\n%{http_code}")
STATUS=$(echo "$RESULT" | tail -1)
if [ "$STATUS" = "200" ]; then
  echo "✓ Notification API OK"
else
  echo "✗ Notification API returned $STATUS"
  exit 1
fi

# Test 3: Error tracking (Sentry)
echo "Testing Sentry integration..."
if curl -s https://sentry.io/api/0/organizations/your-org/events/ \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" | grep -q "sentry"; then
  echo "✓ Sentry integration OK"
fi

# Test 4: Alerting (Slack)
echo "Testing Slack alerts..."
SLACK_TEST=$(curl -X POST "$SLACK_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Deployment smoke test passed"}')
if [ -z "$SLACK_TEST" ] || echo "$SLACK_TEST" | grep -q "ok"; then
  echo "✓ Slack alerts OK"
fi

echo "✅ All smoke tests passed"
```

### 7.2 24-Hour Post-Deployment Monitoring

**Checklist (run at 24h mark):**
- [ ] Error rate stable and < 0.1%
- [ ] API response times p95 < 500ms
- [ ] Email delivery success rate > 99.5%
- [ ] Job queue depth < 100
- [ ] Redis connection health green
- [ ] No new security vulnerabilities detected
- [ ] Sentry issue count stable (no new error patterns)
- [ ] Customer complaints: 0
- [ ] On-call alerts: monitor for spurious/false positives

---

## SECTION 8: Configuration Management

### 8.1 Change Control Process

**All configuration changes follow this process:**

```
1. PLAN
   - Document reason for change
   - Identify all affected systems
   - Get approval from platform lead
   - Create issue in tracker

2. TEST
   - Apply changes to staging
   - Run full validation suite
   - Run load tests
   - Run security tests

3. REVIEW
   - Code review of changes
   - Security team review
   - Peer approval

4. DEPLOY
   - Deploy to production
   - Run smoke tests
   - Monitor for 24 hours

5. DOCUMENT
   - Update this checklist
   - Update runbooks
   - Announce to team
```

### 8.2 Configuration Versioning

```bash
# Tag each configuration release
git tag -a "config-v1.0.0" -m "Initial production configuration"
git push --tags

# Keep change log
cat > CONFIG_CHANGELOG.md << 'EOF'
# Configuration Changes

## v1.0.0 - 2026-08-18
- Initial production configuration
- Slack webhook integration
- PagerDuty escalation policies
- Sentry error tracking
- Vercel monitoring

## [Future versions...]
EOF

# Before each change: backup current config
cp ops/1-monitoring-alerts.yaml ops/1-monitoring-alerts.yaml.backup.$(date +%s)
```

---

## SECTION 9: Security & Compliance

### 9.1 Secret Rotation Schedule

**Quarterly Rotation (every 3 months):**
- [ ] Slack webhook URLs
- [ ] PagerDuty API keys
- [ ] Sentry auth tokens
- [ ] Twilio credentials
- [ ] Redis passwords
- [ ] Database passwords

```bash
# Rotation checklist template
[ ] Generate new credentials
[ ] Update .env.production
[ ] Deploy updated config
[ ] Verify new credentials work
[ ] Revoke old credentials
[ ] Document rotation date
[ ] Update runbooks with new contact info
```

### 9.2 Audit Trail

**All configuration changes logged to:**
- [ ] Git commit log (for code changes)
- [ ] Slack #changes channel (deployment notifications)
- [ ] Database audit_logs table (for runtime changes)
- [ ] Sentry release tracking

### 9.3 GDPR Compliance

**Required Configuration Validations:**
- [ ] Data deletion endpoint working (/api/admin/delete-user)
- [ ] Data export endpoint working (/api/user/export-data)
- [ ] Audit logging comprehensive (covers all data access)
- [ ] Retention policies enforced (1 year max for audit logs)
- [ ] PII properly scrubbed in Sentry

---

## SECTION 10: Cost Estimation & Capacity Planning

### 10.1 Monthly Service Costs

| Service | Configuration | Estimated Cost | Notes |
|---------|---------------|-----------------|-------|
| Vercel | Hobby (free) or Pro ($20) | $0-20 | Included with Next.js hosting |
| Sentry | 50K errors/month @ $50 | $50-200 | Error sampling controls cost |
| Slack | Free tier | $0 | Limited integrations |
| PagerDuty | Free (max 5 users) | $0-99 | Free tier sufficient for MVP |
| Twilio SMS | $0.0075 per SMS | $5-50 | Depends on alert volume |
| Datadog | (if enabled) | $500-2000 | High cost, optional |
| **TOTAL** | | **$55-2,370/mo** | Varies by choices |

### 10.2 Performance Baselines

From `testing/1-load-testing.yaml`:

**Sustainable Load:** 600 RPS (60% of breaking point)  
**Peak Load:** 1800 RPS (3x baseline)  
**Planned Capacity:** 3600 RPS (2x peak)

**Resource Limits:**
- Max CPU: 80%
- Max Memory: 2048 MB
- Max DB Connections: 100
- Max Queue Depth: 100 jobs

---

## SECTION 11: Sign-Off & Approval

### 11.1 Pre-Production Approval Checklist

| Role | Name | Date | Approved |
|------|------|------|----------|
| DevOps Lead | _________________ | __________ | ☐ |
| Security Lead | _________________ | __________ | ☐ |
| Platform Lead | _________________ | __________ | ☐ |
| Engineering Manager | _________________ | __________ | ☐ |

### 11.2 Sign-Off Statement

> We confirm that the TaskFlow Notification System configuration has been reviewed and validated for production deployment. All critical blockers have been addressed, and we have approval to proceed with production deployment.

**Signature:** _________________________ **Date:** _____________

---

## Appendix A: Complete File Inventory

```
Configuration Files Status:

✓ ops/1-monitoring-alerts.yaml
  - Status: ⚠️ INCOMPLETE (21 runbook URLs unvalidated)
  - Action: Validate all URLs exist and are correct
  - Dependencies: Slack, PagerDuty, Twilio credentials

✓ ops/6-metrics-dashboard.json
  - Status: ⚠️ INCOMPLETE (Datadog disabled, email recipients not set)
  - Action: Enable Datadog or remove references; update emails
  - Dependencies: Vercel analytics (automatic), Datadog (optional)

✓ testing/1-load-testing.yaml
  - Status: ⚠️ INCOMPLETE (test credentials not set up)
  - Action: Create test user, org, and JWT
  - Dependencies: Staging environment access

✓ testing/2-security-testing.sh
  - Status: ⚠️ INCOMPLETE (endpoints don't exist, unsafe for prod)
  - Action: Implement GDPR endpoints, add production guards
  - Dependencies: API implementation

✓ ops/7-error-tracking-config.md
  - Status: ⚠️ INCOMPLETE (Sentry project not created)
  - Action: Create Sentry org/project, upload source maps
  - Dependencies: Sentry account, build artifacts
```

---

## Appendix B: Quick Reference URLs

- Slack: https://api.slack.com/apps
- PagerDuty: https://pagerduty.com/app/services
- Sentry: https://sentry.io
- Vercel: https://vercel.com/dashboard
- Datadog: https://app.datadoghq.com
- Twilio: https://console.twilio.com

---

## Appendix C: Emergency Contacts

| Role | Name | Phone | Email | Slack |
|------|------|-------|-------|-------|
| On-Call Engineer | TBD | TBD | TBD | @oncall |
| On-Call Manager | TBD | TBD | TBD | @manager |
| Engineering Lead | TBD | TBD | TBD | @lead |
| Security Team | TBD | TBD | TBD | @security |

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-18  
**Next Review:** 2026-09-18 (Monthly)  
**Maintained By:** DevOps Team
