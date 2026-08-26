# Credentials & Environment Variables Setup Guide

**Status:** Configuration Guide v1.0  
**Last Updated:** 2026-08-18  
**Maintainer:** DevOps & Security Team

---

## Overview

This guide documents all environment variables required to run the TaskFlow Notification System, including setup instructions for each credential, secure storage practices, and compliance requirements.

---

## SECTION 1: Quick Start

### For Development

1. Copy `.env.example` to `.env.local`
2. Fill in test/sandbox credentials for each service
3. Don't commit `.env.local` to git (already in `.gitignore`)

### For Production

1. Use a secrets management system (Vercel Secrets, AWS Secrets Manager, HashiCorp Vault)
2. Never hardcode credentials in code or config files
3. Rotate credentials every 90 days
4. Use strong, randomly generated passwords/keys

---

## SECTION 2: Email Recipients Configuration (Blocker 9 Fix)

### 2.1 Alert Email Recipients

**Variable:** `ALERTS_EMAIL_RECIPIENTS`  
**Type:** Comma-separated email list  
**Default:** `ops-team@company.com,engineering-lead@company.com`

**Purpose:** Receives monitoring alerts for critical issues

**Setup:**
```bash
# For Vercel
vercel env add ALERTS_EMAIL_RECIPIENTS "ops-team@your-company.com,engineering-lead@your-company.com"

# For local development
ALERTS_EMAIL_RECIPIENTS=dev-team@localhost.test
```

**Testing:**
```bash
# Verify format is comma-separated
curl -X POST http://localhost:3000/api/test/send-alert \
  -H "Content-Type: application/json" \
  -d '{"to": "'$ALERTS_EMAIL_RECIPIENTS'"}'
```

### 2.2 Alert From Address

**Variable:** `ALERTS_FROM_ADDRESS`  
**Type:** Email address  
**Default:** `alerts@company.com`

**Purpose:** Sender email for all alert notifications

**Setup:**
```bash
vercel env add ALERTS_FROM_ADDRESS "alerts@your-company.com"
```

**Verification:** Must be a valid, verified email address in your email provider

### 2.3 Error Digest Recipients

**Variable:** `ERROR_DIGEST_EMAIL_RECIPIENTS`  
**Type:** Comma-separated email list  
**Default:** `engineering-lead@company.com`

**Purpose:** Receives daily/weekly error summaries

**Setup:**
```bash
vercel env add ERROR_DIGEST_EMAIL_RECIPIENTS "engineering-lead@your-company.com"
```

### 2.4 On-Call Engineer Email

**Variable:** `ON_CALL_EMAIL`  
**Type:** Email address  
**Default:** `oncall@company.com`

**Purpose:** Receives urgent P1 alerts during on-call shifts

**Setup:**
```bash
# This should be dynamically updated based on on-call rotation
# See Section 3 for PagerDuty integration

vercel env add ON_CALL_EMAIL "alice@company.com"  # Rotate weekly
```

**Automation:** Use PagerDuty API to auto-update this during schedule rotations

### 2.5 Engineering Manager Email

**Variable:** `ENGINEERING_LEAD_EMAIL`  
**Type:** Email address  
**Default:** `engineering-lead@company.com`

**Purpose:** Escalation contact for critical issues

**Setup:**
```bash
vercel env add ENGINEERING_LEAD_EMAIL "engineering-lead@your-company.com"
```

### 2.6 Infrastructure Team Email

**Variable:** `INFRASTRUCTURE_TEAM_EMAIL`  
**Type:** Email address  
**Default:** `infrastructure@company.com`

**Purpose:** Receives infrastructure-specific alerts

**Setup:**
```bash
vercel env add INFRASTRUCTURE_TEAM_EMAIL "infrastructure@your-company.com"
```

---

## SECTION 3: Security Best Practices for Credentials

### 3.1 Secure Storage

**Development:**
- Use `.env.local` (never commit)
- Use test/sandbox API keys only
- Rotate credentials before each production push

**Production (Vercel):**
- Use Vercel Dashboard → Settings → Environment Variables
- Set separate values for Production, Preview, Development
- Enable "Encrypted" flag for sensitive values
- Require production deployments to use secrets

**Production (Self-Hosted):**
- Use HashiCorp Vault or AWS Secrets Manager
- Encrypt secrets at rest and in transit
- Audit all access to secrets
- Rotate automatically every 90 days

### 3.2 Credential Rotation

**Email Recipients:** Every quarter
- Update ops team contact list
- Update engineering manager email
- Sync with HR/org changes

**API Keys/Tokens:** Every 90 days
- Generate new Gmail API tokens
- Rotate PagerDuty integration keys
- Refresh Slack tokens
- Update AWS/Google Cloud credentials

**Process:**
```bash
# Create new credential
# Update environment variable
# Test new credential works
# Verify old credential is revoked
# Remove old credential from system

# Example for Vercel
vercel env add GMAIL_REFRESH_TOKEN "new-token-here"
# Wait for deployment
# Verify Gmail sends work
# Revoke old token
# Remove old value
vercel env rm GMAIL_REFRESH_TOKEN  # Re-adds new one
```

### 3.3 Credential Audit Trail

Keep a secure log of all credential changes:

```markdown
# Credentials Audit Log

## 2026-08-18
- ALERTS_EMAIL_RECIPIENTS: Updated for Q3 team restructuring
  - Old: ops-team@old-domain.com
  - New: ops-team@company.com
  - Changed by: security-team
  - Approved by: engineering-lead

## 2026-08-15
- GMAIL_REFRESH_TOKEN: Quarterly rotation
  - Old token revoked
  - New token deployed
  - Changed by: devops-automation
  - Verified: Production email working
```

---

## SECTION 4: Monitoring Credentials Usage

### 4.1 Log Credential Access

**DO:**
- Log when credentials are read (in production)
- Alert if credentials accessed outside normal patterns
- Audit all secrets management system access

**DON'T:**
- Log credential values anywhere
- Print credentials to logs
- Store credentials in Git history

### 4.2 Detect Credential Leaks

```bash
#!/bin/bash
# scripts/detect-credential-leaks.sh

echo "Scanning for exposed credentials..."

# Check for common patterns
git log --all -S "ALERTS_EMAIL_RECIPIENTS" -- . | head -5
git log --all -S "api_key" -- . | head -5
git log --all -S "secret" -- . | head -5

# Check recent commits
git diff HEAD~10 HEAD | grep -i "password\|token\|secret\|key" || echo "✓ No obvious leaks"

# Use external tools
# npm audit
# snyk test
```

### 4.3 Revocation Procedures

If a credential is accidentally exposed:

1. **Immediate (< 5 minutes)**
   - Revoke credential in source system (Gmail, PagerDuty, etc.)
   - Remove from environment variables
   - Notify security team

2. **Short-term (< 1 hour)**
   - Rotate all related credentials
   - Analyze access logs to see if compromised
   - Check for unauthorized usage

3. **Medium-term (< 24 hours)**
   - Update documentation
   - Notify affected services
   - Add to incident report

4. **Long-term (ongoing)**
   - Implement better secret scanning
   - Add pre-commit hooks to prevent similar leaks
   - Train team on credential handling

---

## SECTION 5: Email Configuration Validation

### 5.1 Validation Script

```typescript
// scripts/validate-email-config.ts
import nodemailer from "nodemailer";

async function validateEmailConfig() {
  const config = {
    recipients: process.env.ALERTS_EMAIL_RECIPIENTS?.split(",") || [],
    fromAddress: process.env.ALERTS_FROM_ADDRESS,
    digestRecipients: process.env.ERROR_DIGEST_EMAIL_RECIPIENTS?.split(",") || [],
  };

  console.log("📧 Email Configuration Validation");
  console.log("==================================\n");

  // Validate recipients list
  console.log("✓ Alert Recipients:");
  config.recipients.forEach((email) => {
    validateEmail(email);
  });

  console.log("\n✓ From Address:");
  validateEmail(config.fromAddress);

  console.log("\n✓ Digest Recipients:");
  config.digestRecipients.forEach((email) => {
    validateEmail(email);
  });

  // Test SMTP connection
  console.log("\n🔗 Testing SMTP Connection...");
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    await transporter.verify();
    console.log("✓ SMTP connection successful");
  } catch (error) {
    console.error("✗ SMTP connection failed:", error.message);
  }

  // Check for duplicates
  const allEmails = [
    ...config.recipients,
    ...config.digestRecipients,
  ];
  const duplicates = allEmails.filter(
    (email, index) => allEmails.indexOf(email) !== index
  );

  if (duplicates.length > 0) {
    console.warn("⚠ Duplicate recipients found:", duplicates);
  }
}

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error(`✗ Invalid email format: ${email}`);
    return false;
  }
  console.log(`  - ${email} ✓`);
  return true;
}

validateEmailConfig();
```

**Run validation:**
```bash
npx ts-node scripts/validate-email-config.ts
```

---

## SECTION 6: Production Deployment Checklist

Before deploying to production:

- [ ] All email recipients configured and tested
- [ ] Sender email address verified in email provider
- [ ] SMTP credentials set correctly
- [ ] Error digest emails configured
- [ ] On-call rotation configured
- [ ] All API keys rotated in last 90 days
- [ ] No credentials in code or git history
- [ ] Environment variables match .env.example
- [ ] Secrets marked as "Encrypted" in Vercel
- [ ] Credential audit log updated
- [ ] Team trained on credential handling
- [ ] Incident response plan updated
- [ ] Monitoring alerts configured
- [ ] Slack/PagerDuty integrations tested

---

## SECTION 7: Environment Variables Reference

### All Email-Related Variables

```bash
# Alert Recipients
ALERTS_EMAIL_RECIPIENTS=ops-team@company.com,engineering-lead@company.com
ALERTS_FROM_ADDRESS=alerts@company.com

# Digest Recipients
ERROR_DIGEST_EMAIL_RECIPIENTS=engineering-lead@company.com

# Individual Contacts
ON_CALL_EMAIL=oncall@company.com
ENGINEERING_LEAD_EMAIL=engineering-lead@company.com
INFRASTRUCTURE_TEAM_EMAIL=infrastructure@company.com

# SMTP Configuration (if self-hosting email)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifications@company.com
SMTP_PASSWORD=your-app-specific-password
```

### Vercel Deployment

```bash
# Production environment
vercel env add ALERTS_EMAIL_RECIPIENTS "ops@prod.example.com" --environment production

# Preview deployments (e.g., for testing)
vercel env add ALERTS_EMAIL_RECIPIENTS "dev@example.com" --environment preview

# Development environment
vercel env add ALERTS_EMAIL_RECIPIENTS "dev@example.com" --environment development
```

---

## SECTION 8: Troubleshooting

### Email Not Sending

**Check 1: Credentials**
```bash
# Verify env var is set
echo $ALERTS_EMAIL_RECIPIENTS

# Check SMTP credentials
vercel env ls | grep SMTP
```

**Check 2: Email Provider Verification**
- Gmail: Sender email must be verified in Gmail App Passwords
- SendGrid: API key must have Mail Send permission
- AWS SES: Sender email must be verified in SES console

**Check 3: Email Format**
```bash
# Validate email format
echo "ops@company.com" | grep -E '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
```

**Check 4: Rate Limiting**
- Check if email provider is rate-limiting
- Check logs for bounced emails
- Verify list doesn't contain invalid addresses

### Configuration Mismatch

**Symptom:** Alerts sent to wrong email address

**Debug:**
```typescript
// pages/api/debug/email-config.ts
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only available in development
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.json({
    alertsTo: process.env.ALERTS_EMAIL_RECIPIENTS,
    alertsFrom: process.env.ALERTS_FROM_ADDRESS,
    digestTo: process.env.ERROR_DIGEST_EMAIL_RECIPIENTS,
    onCallEmail: process.env.ON_CALL_EMAIL,
    engineeringLead: process.env.ENGINEERING_LEAD_EMAIL,
  });
}
```

---

## SECTION 9: Compliance & Audit

### GDPR Compliance

Email recipients must:
- Be consented for receiving notifications
- Have opt-out mechanism available
- Be stored securely (encrypted in transit and at rest)
- Be retained only as long as needed
- Be accessible via Subject Access Request

### SOC 2 Compliance

Email credential handling must:
- Be logged and audited
- Be rotated every 90 days
- Have access controls
- Have encryption in transit/at rest
- Have incident response plan

### Recommended Tools

- **HashiCorp Vault:** Centralized secret management
- **1Password Teams:** Team credential sharing
- **Doppler:** Environment variable management
- **AWS Secrets Manager:** AWS-native secrets
- **GitGuardian:** Secret scanning for Git

---

## SECTION 10: Related Documentation

- [Environment Variables (.env.example)](/Users/xaviercabrera/Claude/taskflow-kanban-prototype/.env.example)
- [PII Scrubbing Guide](/Users/xaviercabrera/Claude/taskflow-kanban-prototype/docs/PII_SCRUBBING.md)
- [Audit Logging & GDPR](/Users/xaviercabrera/Claude/taskflow-kanban-prototype/docs/AUDIT_LOGGING.md)
- [Monitoring & Alerts](/Users/xaviercabrera/Claude/taskflow-kanban-prototype/ops/1-monitoring-alerts.yaml)
- [Error Tracking Config](/Users/xaviercabrera/Claude/taskflow-kanban-prototype/ops/7-error-tracking-config.md)

---

**Last Updated:** 2026-08-18  
**Version:** 1.0  
**Status:** Complete
