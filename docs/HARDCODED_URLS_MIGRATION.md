# Hardcoded URLs Migration

## Overview

This document tracks the migration from hardcoded URLs to environment variable-based configuration for the TaskFlow Notification System.

**Migration Date:** 2026-08-18
**Total URLs Replaced:** 21 references
**Status:** Complete

---

## Changes Summary

### Files Modified

| File | Hardcoded Pattern | Environment Variable | Count |
|------|-------------------|---------------------|-------|
| `ops/1-monitoring-alerts.yaml` | `https://taskflow.example.com/runbooks/*` | `${RUNBOOK_BASE_URL}/*` | 9 |
| `ops/1-monitoring-alerts.yaml` | `https://taskflow.example.com/docs/*` | `${TASKFLOW_URL}/docs/*` | 4 |
| `ops/1-monitoring-alerts.yaml` | `*@taskflow.example.com` | Environment variables | 6 |
| `ops/4-backup-disaster-recovery.md` | `https://status.taskflow.example.com` | `${TASKFLOW_URL}/status` | 1 |
| `dev/2-debug-utils.sh` | `https://taskflow.example.com/*` | `${TASKFLOW_URL}/*` | 1 |
| `dev/2-debug-utils.sh` | `https://taskflow-api.example.com/*` | `${API_BASE_URL}/*` | 1 |

---

## Detailed Replacements

### 1. ops/1-monitoring-alerts.yaml

#### Runbook URLs (9 replacements)

```yaml
# BEFORE
runbook_url: "https://taskflow.example.com/runbooks/email-delivery-latency"
runbook_url: "https://taskflow.example.com/runbooks/queue-backlog-management"
runbook_url: "https://taskflow.example.com/runbooks/api-error-spike"
runbook_url: "https://taskflow.example.com/runbooks/redis-connection-issues"
runbook_url: "https://taskflow.example.com/runbooks/gmail-api-issues"
runbook_url: "https://taskflow.example.com/runbooks/api-performance-degradation"
runbook_url: "https://taskflow.example.com/runbooks/email-delivery-failures"

# AFTER
runbook_url: "${RUNBOOK_BASE_URL}/email-delivery-latency"
runbook_url: "${RUNBOOK_BASE_URL}/queue-backlog-management"
runbook_url: "${RUNBOOK_BASE_URL}/api-error-spike"
runbook_url: "${RUNBOOK_BASE_URL}/redis-connection-issues"
runbook_url: "${RUNBOOK_BASE_URL}/gmail-api-issues"
runbook_url: "${RUNBOOK_BASE_URL}/api-performance-degradation"
runbook_url: "${RUNBOOK_BASE_URL}/email-delivery-failures"
```

**Environment Variable:**
```bash
RUNBOOK_BASE_URL=http://localhost:3000/docs/runbooks
```

#### Documentation URLs (4 replacements)

```yaml
# BEFORE
url: "https://taskflow.example.com/docs/architecture"
url: "https://taskflow.example.com/docs/incident-response"
url: "https://taskflow.example.com/docs/deployment"

# AFTER
url: "${TASKFLOW_URL}/docs/architecture"
url: "${TASKFLOW_URL}/docs/incident-response"
url: "${TASKFLOW_URL}/docs/deployment"
```

**Environment Variable:**
```bash
TASKFLOW_URL=http://localhost:3000
```

#### Email Addresses (6 replacements)

```yaml
# BEFORE
name: "Email - ops-team@taskflow.example.com"
  recipients:
    - "ops-team@taskflow.example.com"
    - "engineering-lead@taskflow.example.com"
  from_address: "alerts@taskflow.example.com"
  
# Email contacts
  - role: "Engineering Manager"
    email: "engineering-lead@taskflow.example.com"
    
  - role: "Infrastructure Team"
    email: "infrastructure@taskflow.example.com"

# AFTER
name: "Email - ${ALERTS_EMAIL_RECIPIENTS}"
  recipients:
    - "${ALERTS_EMAIL_RECIPIENTS}"
    - "${ENGINEERING_LEAD_EMAIL}"
  from_address: "${ALERTS_FROM_ADDRESS}"
  
# Email contacts
  - role: "Engineering Manager"
    email: "${ENGINEERING_LEAD_EMAIL}"
    
  - role: "Infrastructure Team"
    email: "${INFRASTRUCTURE_TEAM_EMAIL}"
```

**Environment Variables:**
```bash
ALERTS_EMAIL_RECIPIENTS=ops-team@company.com,engineering-lead@company.com
ALERTS_FROM_ADDRESS=alerts@company.com
ENGINEERING_LEAD_EMAIL=engineering-lead@company.com
INFRASTRUCTURE_TEAM_EMAIL=infrastructure@company.com
```

### 2. ops/4-backup-disaster-recovery.md

#### Status Page URL (1 replacement)

```markdown
# BEFORE
**Status Page:** https://status.taskflow.example.com

# AFTER
**Status Page:** ${TASKFLOW_URL}/status
```

**Environment Variable:**
```bash
TASKFLOW_URL=http://localhost:3000
```

### 3. dev/2-debug-utils.sh

#### Test Notification URL (1 replacement)

```bash
# BEFORE
"http://localhost:3000/api/debug/trigger-notification"

# AFTER (with env var usage)
"${API_BASE_URL}/debug/trigger-notification"
```

#### Gmail Webhook Logs URL (1 replacement)

```bash
# BEFORE
'https://taskflow-api.example.com/admin/gmail-webhook-logs?limit=20&order=desc'

# AFTER
'${API_BASE_URL}/admin/gmail-webhook-logs?limit=20&order=desc'
```

**Environment Variables:**
```bash
API_BASE_URL=http://localhost:3000/api
```

---

## Environment Variable Mapping

### Core Application URLs

| Variable | Usage | Development | Production |
|----------|-------|-------------|------------|
| `TASKFLOW_URL` | Primary app URL for links | `http://localhost:3000` | `https://taskflow.app` |
| `API_BASE_URL` | API endpoint base | `http://localhost:3000/api` | `https://taskflow.app/api` |
| `RUNBOOK_BASE_URL` | Operational runbooks | `http://localhost:3000/docs/runbooks` | `https://taskflow.app/docs/runbooks` |

### Email Configuration

| Variable | Usage | Example |
|----------|-------|---------|
| `ALERTS_EMAIL_RECIPIENTS` | Alert recipients | `ops@company.com,lead@company.com` |
| `ALERTS_FROM_ADDRESS` | Alert sender | `alerts@company.com` |
| `ENGINEERING_LEAD_EMAIL` | Engineering manager | `manager@company.com` |
| `INFRASTRUCTURE_TEAM_EMAIL` | Infrastructure team | `infrastructure@company.com` |
| `ON_CALL_EMAIL` | On-call contact | `oncall@company.com` |

---

## Implementation Notes

### Bash/Shell Scripts

For shell scripts to use environment variables, ensure they're:
1. Sourced with environment variables loaded
2. Accessible via `${VAR_NAME}` syntax
3. Documented in script comments

Example:
```bash
#!/bin/bash

# Load environment
source .env.local

# Use environment variable
curl "${API_BASE_URL}/endpoint"
```

### YAML Configuration Files

YAML supports environment variable substitution via:
1. **Direct substitution** (at runtime): `${VAR_NAME}`
2. **Pre-processing** (before loading): Replace before parsing

Current implementation uses direct substitution syntax.

### JavaScript/TypeScript Usage

In application code, use `process.env`:
```typescript
const runbookUrl = `${process.env.RUNBOOK_BASE_URL}/email-delivery-latency`;
const apiUrl = process.env.API_BASE_URL;
```

---

## Testing & Verification

### Before Deployment

1. **Verify environment variables are set:**
   ```bash
   printenv | grep -E "TASKFLOW_URL|RUNBOOK_BASE_URL|API_BASE_URL|ALERTS"
   ```

2. **Check file contents for hardcoded URLs:**
   ```bash
   grep -r "taskflow.example.com" .
   grep -r "@taskflow.example.com" .
   ```
   Should return: No matches

3. **Validate YAML syntax:**
   ```bash
   yamllint ops/1-monitoring-alerts.yaml
   ```

4. **Test endpoint accessibility:**
   ```bash
   # Test that constructed URLs are valid
   curl "${TASKFLOW_URL}/docs/runbooks" -I
   curl "${API_BASE_URL}/health" -I
   ```

### During Deployment

1. Ensure all environment variables are configured in deployment target
2. Verify monitoring/alerting uses correct URLs
3. Test alert delivery to Slack/PagerDuty
4. Confirm runbook links resolve correctly

---

## Rollback Plan

If issues arise from URL migration:

1. **Revert changes:**
   ```bash
   git revert <commit-hash>
   ```

2. **Restore hardcoded URLs** (temporary):
   ```bash
   git checkout HEAD~1 ops/1-monitoring-alerts.yaml
   git checkout HEAD~1 ops/4-backup-disaster-recovery.md
   git checkout HEAD~1 dev/2-debug-utils.sh
   ```

3. **Re-investigate root cause** before attempting again

---

## Future Improvements

1. **Configuration Service**: Centralized environment variable management
2. **URL Validation**: Automated checks to prevent hardcoded URLs
3. **Documentation Generation**: Auto-generate docs from configuration
4. **Multi-Environment Support**: Separate configs for dev/staging/production
5. **Secret Rotation**: Automated credential rotation for services

---

## Related Documentation

- [.env.example](.env.example) - Complete environment variable reference
- [CREDENTIALS_SETUP.md](CREDENTIALS_SETUP.md) - Service credential setup guide
- [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) - Deployment instructions
- [OBSERVABILITY.md](../OBSERVABILITY.md) - Monitoring setup

---

Last Updated: 2026-08-18
