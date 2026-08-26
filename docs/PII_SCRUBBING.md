# PII Scrubbing & Data Sanitization Guide

**Status:** Implementation Guide v1.0  
**Last Updated:** 2026-08-18  
**Maintainer:** Security & Compliance Team

---

## Overview

This document provides comprehensive guidance on identifying and scrubbing Personally Identifiable Information (PII) and sensitive data from error logs, crash reports, and audit trails. PII scrubbing is critical for regulatory compliance (GDPR, CCPA, HIPAA) and security.

---

## SECTION 1: PII Pattern Registry

### 1.1 Email Addresses

**Pattern:** Any valid email address  
**Regex:** `([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})`

**Examples to scrub:**
- user@example.com
- john.doe+tag@company.co.uk
- team.notifications@internal.example.org
- noreply@service.example.com

**Replacement:** `[EMAIL]`

```typescript
const emailPattern = /([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
text = text.replace(emailPattern, '[EMAIL]');
```

**Test Cases:**
```
Input: "Error sending to user@example.com"
Output: "Error sending to [EMAIL]"

Input: "admin.team+prod@my-company.io failed"
Output: "admin.team+prod@my-company.io failed" (NOT MATCHED - has dash in domain)
```

**Fix for edge cases:**
```typescript
const emailPattern = /\b[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi;
```

---

### 1.2 Phone Numbers

**Pattern:** Various international formats  
**Regex:** `(\+?1?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\+\d{1,3}\s?(\d|\s|-){6,})`

**Examples to scrub:**
- +1-555-123-4567
- +44 20 7946 0958
- (555) 123-4567
- 555.123.4567
- +886 2 2162 0145
- 1(800)FLOWERS

**Replacement:** `[PHONE]`

```typescript
const phonePattern = /(\+?1?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\+\d{1,3}\s?(\d|\s|-){6,})/g;
text = text.replace(phonePattern, '[PHONE]');
```

---

### 1.3 Social Security Numbers (SSN)

**Pattern:** XXX-XX-XXXX format (US)  
**Regex:** `(\d{3}-\d{2}-\d{4})`

**Examples to scrub:**
- 123-45-6789
- SSN: 999-99-9999

**Replacement:** `[SSN]`

```typescript
const ssnPattern = /\d{3}-\d{2}-\d{4}/g;
text = text.replace(ssnPattern, '[SSN]');
```

**Note:** Also scrub partial SSNs (last 4 digits)

```typescript
// Scrub partial SSN patterns like "***-**-1234"
const partialSSNPattern = /\*{3}-\*{2}-\d{4}/g;
text = text.replace(partialSSNPattern, '[SSN]');
```

---

### 1.4 Credit Card Numbers

**Pattern:** 13-19 digit card numbers  
**Regex:** `(\d{4}[\s-]?){3}\d{4,7}|(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})`

**Examples to scrub:**
- 4532-1234-5678-9010
- 5105105105105100
- 378282246310005
- 6011111111111117

**Replacement:** `[CREDIT_CARD]`

```typescript
// Luhn-algorithm validated card detection
const creditCardPattern = /(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})/g;
text = text.replace(creditCardPattern, '[CREDIT_CARD]');
```

---

### 1.5 API Keys & Secrets

**Pattern:** API keys, tokens, secrets  
**Regex:** `(api[_-]?key|secret|token|password|apikey)\s*[:=]\s*['\"]?([a-zA-Z0-9_-]{20,})['\"]?`

**Examples to scrub:**
- api_key: "sk-123456789abcdef"
- secret="s3cr3t_p@ssw0rd_123"
- TOKEN=ghp_16C7e42F292c6912E7710c838347Ae178B4a
- password: my_secure_p@ssw0rd
- Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

**Replacement:** `[API_KEY]` or `[SECRET]`

```typescript
const apiKeyPattern = /(api[_-]?key|secret|token|password|apikey)\s*[:=]\s*['\"]?([a-zA-Z0-9_-]{20,})['\"]?/gi;
text = text.replace(apiKeyPattern, '$1=[API_KEY]');
```

---

### 1.6 JWT Tokens (NEW)

**Pattern:** JWT format (header.payload.signature)  
**Regex:** `(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})`

**Examples to scrub:**
- eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
- Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

**Replacement:** `[JWT_TOKEN]`

```typescript
const jwtPattern = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
text = text.replace(jwtPattern, '[JWT_TOKEN]');
```

---

### 1.7 Database Connection Strings (NEW)

**Pattern:** Database URLs with credentials  
**Regex:** `(postgresql|mysql|mongodb|redis):\/\/([a-zA-Z0-9._%-]+):([a-zA-Z0-9_-]+)@([a-zA-Z0-9.-]+):?(\d+)?\/(\w+)`

**Examples to scrub:**
- postgresql://user:password@localhost:5432/database
- mysql://admin:secret123@db.example.com:3306/mydb
- mongodb://user:password@mongo.internal:27017/admin
- redis://:password@redis.local:6379/0

**Replacement:** `[DATABASE_URL]`

```typescript
const dbConnectionPattern = /(postgresql|mysql|mongodb|redis):\/\/([a-zA-Z0-9._%-]+):([a-zA-Z0-9_-]+)@/gi;
text = text.replace(dbConnectionPattern, '$1://[USER]:[PASSWORD]@');
```

**Advanced:** Scrub the entire connection string for sensitivity

```typescript
const dbUrlPattern = /(postgresql|mysql|mongodb|redis):\/\/[^\s]+/gi;
text = text.replace(dbUrlPattern, '[DATABASE_URL]');
```

---

### 1.8 OAuth Tokens & Credentials (NEW)

**Pattern:** OAuth refresh tokens, access tokens, client secrets  
**Regex:** `(refresh_token|access_token|client_secret)\s*[:=]\s*['\"]?([a-zA-Z0-9._-]{30,})['\"]?`

**Examples to scrub:**
- refresh_token: "ya29.a0AfH6SMBz..."
- access_token="1//0gH..."
- client_secret: "OB33vf2..."
- oauth_token: "3c19742ac..."

**Replacement:** `[OAUTH_TOKEN]`

```typescript
const oauthPattern = /(refresh_token|access_token|client_secret|oauth_token)\s*[:=]\s*['\"]?([a-zA-Z0-9._-]{30,})['\"]?/gi;
text = text.replace(oauthPattern, '$1=[OAUTH_TOKEN]');
```

---

### 1.9 Slack Tokens (NEW)

**Pattern:** Slack bot tokens, webhooks, legacy tokens  
**Regex:** `(xoxb-|xoxp-|xoxe-|https:\/\/hooks\.slack\.com\/services\/)`

**Examples to scrub:**
- xoxb-1234567890123-1234567890123-xxxxxxxxxxxx
- xoxp-1234567890-1234567890-1234567890-xxxxxx
- https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX

**Replacement:** `[SLACK_TOKEN]`

```typescript
const slackTokenPattern = /(xoxb-|xoxp-|xoxe-|https:\/\/hooks\.slack\.com\/services\/)[a-zA-Z0-9_-]+/gi;
text = text.replace(slackTokenPattern, '[SLACK_TOKEN]');
```

---

### 1.10 PagerDuty & Monitoring Service Keys (NEW)

**Pattern:** PagerDuty API tokens, integration keys, incident keys  
**Regex:** `(pagerduty_.*?_token|integration_key|incident_key|routing_key)\s*[:=]\s*['\"]?([a-zA-Z0-9]{30,})['\"]?`

**Examples to scrub:**
- pagerduty_api_token: "u+KP_xyz..."
- integration_key: "Px5Fxxxxxxxxxxxx"
- routing_key: "R12345678901234567890"

**Replacement:** `[PAGERDUTY_KEY]`

```typescript
const pagerdutyPattern = /(pagerduty_.*?_token|integration_key|incident_key|routing_key)\s*[:=]\s*['\"]?([a-zA-Z0-9]{30,})['\"]?/gi;
text = text.replace(pagerdutyPattern, '$1=[PAGERDUTY_KEY]');
```

---

### 1.11 AWS Access Keys (NEW)

**Pattern:** AWS Access Key IDs and Secret Access Keys  
**Regex:** `(AKIA|aws_access_key_id|aws_secret_access_key)\s*[:=]\s*['\"]?([A-Z0-9]{20,}|[a-zA-Z0-9\/+]{40,})['\"]?`

**Examples to scrub:**
- AKIAIOSFODNN7EXAMPLE
- aws_access_key_id=AKIAIOSFODNN7EXAMPLE
- aws_secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

**Replacement:** `[AWS_KEY]`

```typescript
const awsKeyPattern = /(AKIA[0-9A-Z]{16}|aws_access_key_id|aws_secret_access_key)\s*[:=]\s*['\"]?([A-Za-z0-9\/+=]{40,})?['\"]?/gi;
text = text.replace(awsKeyPattern, '[AWS_KEY]');
```

---

### 1.12 Google API Keys & Firebase Credentials (NEW)

**Pattern:** Google API keys, Firebase tokens  
**Regex:** `(AIza[0-9A-Za-z_-]{35}|firebase.*?key)\s*[:=]?\s*['\"]?([a-zA-Z0-9_-]{20,})['\"]?`

**Examples to scrub:**
- AIzaSyDummy_35CharactersLongKeyExample
- firebase_api_key: "AIzaSyExample123456789"
- config.apiKey = "AIzaSy..."

**Replacement:** `[GOOGLE_KEY]`

```typescript
const googleKeyPattern = /AIza[0-9A-Za-z_-]{35}/g;
text = text.replace(googleKeyPattern, '[GOOGLE_KEY]');
```

---

## SECTION 2: PII Scrubbing Implementation

### 2.1 Complete Scrubbing Function

```typescript
// lib/pii-scrubber.ts
export interface PIIPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

export const PII_PATTERNS: Record<string, PIIPattern> = {
  email: {
    name: 'Email Address',
    regex: /\b[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi,
    replacement: '[EMAIL]',
  },
  phone: {
    name: 'Phone Number',
    regex: /(\+?1?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\+\d{1,3}\s?(\d|\s|-){6,})/g,
    replacement: '[PHONE]',
  },
  ssn: {
    name: 'Social Security Number',
    regex: /\d{3}-\d{2}-\d{4}/g,
    replacement: '[SSN]',
  },
  creditCard: {
    name: 'Credit Card',
    regex: /(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})/g,
    replacement: '[CREDIT_CARD]',
  },
  apiKey: {
    name: 'API Key',
    regex: /(api[_-]?key|secret|token|password|apikey)\s*[:=]\s*['\"]?([a-zA-Z0-9_-]{20,})['\"]?/gi,
    replacement: '$1=[API_KEY]',
  },
  jwtToken: {
    name: 'JWT Token',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replacement: '[JWT_TOKEN]',
  },
  databaseUrl: {
    name: 'Database Connection String',
    regex: /(postgresql|mysql|mongodb|redis):\/\/[^\s]+/gi,
    replacement: '[DATABASE_URL]',
  },
  oauthToken: {
    name: 'OAuth Token',
    regex: /(refresh_token|access_token|client_secret|oauth_token)\s*[:=]\s*['\"]?([a-zA-Z0-9._-]{30,})['\"]?/gi,
    replacement: '$1=[OAUTH_TOKEN]',
  },
  slackToken: {
    name: 'Slack Token',
    regex: /(xoxb-|xoxp-|xoxe-|https:\/\/hooks\.slack\.com\/services\/)[a-zA-Z0-9_/-]+/gi,
    replacement: '[SLACK_TOKEN]',
  },
  pagerdutyKey: {
    name: 'PagerDuty Key',
    regex: /(pagerduty_.*?_token|integration_key|incident_key|routing_key)\s*[:=]\s*['\"]?([a-zA-Z0-9]{30,})['\"]?/gi,
    replacement: '$1=[PAGERDUTY_KEY]',
  },
  awsKey: {
    name: 'AWS Key',
    regex: /(AKIA[0-9A-Z]{16}|aws_access_key_id|aws_secret_access_key)\s*[:=]\s*['\"]?([A-Za-z0-9\/+=]{40,})?['\"]?/gi,
    replacement: '[AWS_KEY]',
  },
  googleKey: {
    name: 'Google API Key',
    regex: /AIza[0-9A-Za-z_-]{35}/g,
    replacement: '[GOOGLE_KEY]',
  },
};

export class PIIScrubber {
  /**
   * Scrub all PII from text
   */
  static scrubText(text: string, patterns?: string[]): string {
    let scrubbed = text;
    
    const patternsToUse = patterns
      ? Object.entries(PII_PATTERNS)
          .filter(([key]) => patterns.includes(key))
          .map(([_, pattern]) => pattern)
      : Object.values(PII_PATTERNS);

    patternsToUse.forEach((pattern) => {
      scrubbed = scrubbed.replace(pattern.regex, pattern.replacement);
    });

    return scrubbed;
  }

  /**
   * Scrub PII from object (recursively)
   */
  static scrubObject(obj: any, patterns?: string[]): any {
    if (typeof obj === 'string') {
      return this.scrubText(obj, patterns);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.scrubObject(item, patterns));
    }

    if (obj !== null && typeof obj === 'object') {
      const scrubbed: any = {};
      for (const [key, value] of Object.entries(obj)) {
        scrubbed[key] = this.scrubObject(value, patterns);
      }
      return scrubbed;
    }

    return obj;
  }

  /**
   * Get list of PII detected in text
   */
  static detectPII(text: string): Array<{ type: string; matched: string }> {
    const detections: Array<{ type: string; matched: string }> = [];

    Object.entries(PII_PATTERNS).forEach(([type, pattern]) => {
      const matches = [...text.matchAll(pattern.regex)];
      matches.forEach((match) => {
        detections.push({
          type,
          matched: match[0],
        });
      });
    });

    return detections;
  }
}

// Usage
export default PIIScrubber;
```

---

### 2.2 Integration with Sentry

```typescript
// lib/sentry-filters.ts
import * as Sentry from "@sentry/node";
import PIIScrubber from "@/lib/pii-scrubber";

export function initSentryWithPIIScrubbing() {
  Sentry.init({
    // ... other config
    beforeSend(event) {
      // Scrub PII from event
      const scrubbedEvent = PIIScrubber.scrubObject(event);
      return scrubbedEvent;
    },
  });
}
```

---

## SECTION 3: Testing PII Scrubbing

### 3.1 Unit Tests

```typescript
// lib/__tests__/pii-scrubber.test.ts
import PIIScrubber from "@/lib/pii-scrubber";

describe("PIIScrubber", () => {
  describe("Email scrubbing", () => {
    it("should scrub email addresses", () => {
      const input = "Contact user@example.com for support";
      const output = PIIScrubber.scrubText(input);
      expect(output).toBe("Contact [EMAIL] for support");
    });

    it("should scrub multiple emails", () => {
      const input = "Email: admin@company.com or support@company.com";
      const output = PIIScrubber.scrubText(input);
      expect(output).toBe("Email: [EMAIL] or [EMAIL]");
    });
  });

  describe("Phone scrubbing", () => {
    it("should scrub US phone numbers", () => {
      const input = "Call 555-123-4567 for help";
      const output = PIIScrubber.scrubText(input);
      expect(output).toBe("Call [PHONE] for help");
    });

    it("should scrub international phone numbers", () => {
      const input = "UK: +44 20 7946 0958";
      const output = PIIScrubber.scrubText(input);
      expect(output).toBe("UK: [PHONE]");
    });
  });

  describe("JWT scrubbing", () => {
    it("should scrub JWT tokens", () => {
      const jwtToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const input = `Authorization: Bearer ${jwtToken}`;
      const output = PIIScrubber.scrubText(input);
      expect(output).toContain("[JWT_TOKEN]");
      expect(output).not.toContain(jwtToken);
    });
  });

  describe("Database URL scrubbing", () => {
    it("should scrub PostgreSQL connection strings", () => {
      const input =
        "Connected to postgresql://user:password@localhost:5432/db";
      const output = PIIScrubber.scrubText(input);
      expect(output).toBe("Connected to [DATABASE_URL]");
    });
  });

  describe("API key scrubbing", () => {
    it("should scrub API keys", () => {
      const input = 'API_KEY="sk-123456789abcdef"';
      const output = PIIScrubber.scrubText(input);
      expect(output).toContain("[API_KEY]");
    });
  });

  describe("Object scrubbing", () => {
    it("should scrub nested objects", () => {
      const input = {
        user: {
          email: "user@example.com",
          phone: "555-123-4567",
          metadata: {
            token: "jwt_token_here_very_long_string",
          },
        },
      };

      const output = PIIScrubber.scrubObject(input);

      expect(output.user.email).toBe("[EMAIL]");
      expect(output.user.phone).toBe("[PHONE]");
    });

    it("should scrub arrays", () => {
      const input = {
        emails: [
          "admin@company.com",
          "user@example.com",
          "support@example.com",
        ],
      };

      const output = PIIScrubber.scrubObject(input);

      output.emails.forEach((email) => {
        expect(email).toBe("[EMAIL]");
      });
    });
  });

  describe("PII detection", () => {
    it("should detect PII in text", () => {
      const input =
        "Email: user@example.com, Phone: 555-123-4567, SSN: 123-45-6789";
      const detections = PIIScrubber.detectPII(input);

      expect(detections.length).toBe(3);
      expect(detections).toContainEqual(
        expect.objectContaining({ type: "email" })
      );
      expect(detections).toContainEqual(
        expect.objectContaining({ type: "phone" })
      );
      expect(detections).toContainEqual(
        expect.objectContaining({ type: "ssn" })
      );
    });
  });
});
```

---

### 3.2 Manual Verification Procedures

**Step 1: Identify High-Risk Logs**

```bash
# Find logs containing common PII patterns
grep -r "@.*\.com\|@.*\.co\.uk" logs/
grep -r "[0-9]\{3\}-[0-9]\{2\}-[0-9]\{4\}" logs/
grep -r "api_key\|secret\|token" logs/
```

**Step 2: Sample & Verify Scrubbing**

```bash
# Export recent error logs
curl https://sentry.io/api/0/organizations/{org}/events/ \
  -H "Authorization: Bearer {token}" \
  | jq '.[] | .contexts' > sample_logs.json

# Run scrubber on sample
node -e "
const scrubber = require('./lib/pii-scrubber').default;
const fs = require('fs');
const logs = JSON.parse(fs.readFileSync('sample_logs.json'));
const scrubbed = scrubber.scrubObject(logs);
console.log(JSON.stringify(scrubbed, null, 2));
" > scrubbed_logs.json

# Diff to verify no PII leaked
diff sample_logs.json scrubbed_logs.json
```

**Step 3: Continuous Monitoring**

- Set up periodic scans of error logs for PII
- Alert if PII patterns detected in production logs
- Audit all error events daily for compliance

---

## SECTION 4: Compliance & Best Practices

### 4.1 GDPR Compliance

- **Right to Erasure:** All PII must be scrubbed from logs
- **Data Minimization:** Only collect PII when necessary
- **Retention:** PII-containing logs deleted after 30 days
- **Auditing:** Maintain audit trail of who accessed logs

### 4.2 Data Retention Policy

| Log Type | Retention | PII Requirement |
|----------|-----------|-----------------|
| Error Logs (Sentry) | 90 days | Must scrub all PII |
| Application Logs (Vercel) | 30 days | Must scrub sensitive fields |
| Audit Logs (Database) | 1 year | Scrub user emails |
| Debug Logs | 7 days | Scrub all PII |
| Performance Traces | 30 days | Scrub query parameters |

### 4.3 Scrubbing Checklist

Before any log is sent to external services:

- [ ] Email addresses scrubbed
- [ ] Phone numbers scrubbed
- [ ] API keys/secrets scrubbed
- [ ] JWT tokens scrubbed
- [ ] Database connection strings scrubbed
- [ ] OAuth tokens scrubbed
- [ ] AWS keys scrubbed
- [ ] Credit card numbers scrubbed
- [ ] Personal identifiers (SSN, passport) scrubbed

---

## SECTION 5: Tools & Automation

### 5.1 Pre-Deployment Check

```bash
#!/bin/bash
# scripts/check-pii-logs.sh

echo "Checking for PII in logs..."

FOUND_PII=0

# Check for email patterns
if grep -r '[a-zA-Z0-9._%-]*@[a-zA-Z0-9.-]*\.[a-zA-Z]' logs/ 2>/dev/null; then
  echo "❌ Found potential email addresses in logs"
  FOUND_PII=1
fi

# Check for API keys
if grep -r "api_key.*=\|secret.*=\|token.*=" logs/ 2>/dev/null; then
  echo "❌ Found potential secrets in logs"
  FOUND_PII=1
fi

# Check for AWS keys
if grep -r "AKIA[0-9A-Z]\{16\}" logs/ 2>/dev/null; then
  echo "❌ Found AWS access keys in logs"
  FOUND_PII=1
fi

if [ $FOUND_PII -eq 0 ]; then
  echo "✓ No PII found in logs"
  exit 0
else
  echo "✗ PII detected - scrub before deploying"
  exit 1
fi
```

### 5.2 CI/CD Integration

```yaml
# .github/workflows/check-pii.yml
name: PII Detection

on: [push, pull_request]

jobs:
  check-pii:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check for PII
        run: bash scripts/check-pii-logs.sh
```

---

## SECTION 6: Incident Response

**If PII is discovered in logs:**

1. **Immediate Action (< 1 hour)**
   - Identify scope (which logs affected)
   - Notify security team
   - Halt log exports to external services

2. **Containment (< 4 hours)**
   - Delete affected log entries
   - Purge from caches and CDNs
   - Rotate affected credentials

3. **Investigation (< 24 hours)**
   - Determine root cause
   - Review access logs
   - Identify who accessed logs

4. **Remediation**
   - Implement stronger PII scrubbing
   - Update documentation
   - Train team on PII sensitivity

---

## Appendix: Reference Implementation

See the complete implementation in:
- `/lib/pii-scrubber.ts` - Scrubber class
- `/lib/__tests__/pii-scrubber.test.ts` - Test suite
- `/lib/sentry-filters.ts` - Sentry integration

---

**Last Updated:** 2026-08-18  
**Version:** 1.0  
**Status:** Complete
