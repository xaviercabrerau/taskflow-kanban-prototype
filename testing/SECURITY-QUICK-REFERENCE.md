# Security Testing Quick Reference Card

> **Status: verified 2026-09-10.** The real flags are `--suite NAME` (not
> `--section N`) and `--format json` (not a standalone `--json` flag); there is
> no `--fast` flag. The endpoint list and CI/CD snippets further down were
> written for routes this project does not have — see the notes inline.

## Run Tests

```bash
# Full suite (all 10 domains)
./2-security-testing.sh

# One suite only
./2-security-testing.sh --suite input

# JSON output for CI/CD
./2-security-testing.sh --format json

# Debug mode
./2-security-testing.sh --verbose --debug --suite auth
```

Valid `--suite` values: `all`, `input`, `auth`, `authz`, `ratelimit`,
`exposure`, `api`, `email`, `external`, `secrets`, `compliance`.

## Test Domains at a Glance

| Suite value | Domain | Focus | Remediation |
|---|---------|-------|------------|
| `input` | Input Validation | SQL/XSS/Command/Path attacks | Parameterize queries, escape output, validate paths |
| `auth` | Authentication | JWT validation, token checks | Verify JWT on all protected routes, check expiration |
| `authz` | Authorization | RLS, cross-org, privilege | Enforce `role_assignments`-based RLS (see `../MIGRACION.md` and the architecture notes in `../dev/`), verify user ownership |
| `ratelimit` | Rate Limiting | DDoS/brute force protection | Upstash-backed sliding window (`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`) |
| `exposure` | Data Exposure | Errors, headers, PII, logs | Generic errors, security headers, sanitize logs |
| `api` | API Security | CORS, CSRF, timeouts | Restrict CORS, CSRF tokens, request timeout |
| `email` | Email Security | Headers, XSS, spoofing | Sanitize headers, escape templates, verify From (Resend) |
| `external` | External Services | Failures, cascading issues | Circuit breakers, exponential backoff, timeouts |
| `secrets` | Secrets Management | Leakage in logs/errors | Redact logs, generic errors, never log env values |
| `compliance` | Compliance | Retention, audit, GDPR-style checks | See caveat below — this project has no dedicated audit-log or GDPR-export endpoints today |

The exact test count per domain is not fixed in the script (some checks are
conditional); don't treat the numbers in older drafts of this table as exact.

## Common Failures & Quick Fixes

### ✗ SQL Injection test fails
**Problem:** Parameterized queries not used
**Fix:** Use prepared statements in all DB queries
```javascript
// ❌ Bad
db.query(`SELECT * FROM notifications WHERE user_id = '${userId}'`)
// ✅ Good
db.query('SELECT * FROM notifications WHERE user_id = $1', [userId])
```

### ✗ XSS test fails
**Problem:** User input not escaped in templates
**Fix:** Use auto-escaping templating engine
```handlebars
{{! ✅ Handlebars auto-escapes by default }}
Hello {{userName}}!

{{! To render raw HTML, use triple braces (with caution) }}
{{{trustedHtml}}}
```

### ✗ Missing JWT test fails
**Problem:** Endpoints not authenticated
**Fix:** Add auth middleware
```typescript
// ✅ Protect route
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) return new Response('Unauthorized', { status: 401 });
  // Verify token, continue...
}
```

### ✗ RLS test fails
**Problem:** Row-level security not enforced
**Fix:** Enable RLS in Supabase
```sql
-- ✅ Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ✅ Create policy
CREATE POLICY user_isolation ON notifications
  FOR SELECT USING (auth.uid() = user_id);
```

### ✗ Rate limiting test fails
**Problem:** No rate limiting middleware
**Fix:** Add express-rate-limit
```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,            // 100 requests per minute
});

app.use('/api/notifications/emit', limiter);
```

### ✗ Security headers test fails
**Problem:** Missing CSP, X-Frame-Options, etc.
**Fix:** Add security headers middleware
```typescript
// In middleware.ts or server.ts
response.headers.set('Content-Security-Policy', "default-src 'self'");
response.headers.set('X-Content-Type-Options', 'nosniff');
response.headers.set('X-Frame-Options', 'DENY');
response.headers.set('Strict-Transport-Security', 'max-age=31536000');
```

### ✗ Secrets in logs test fails
**Problem:** Passwords/tokens logged
**Fix:** Redact sensitive data
```typescript
// ✅ Use logger with redaction
const redactPatterns = [
  /password["\s:=]+[^\s"]+/gi,
  /token["\s:=]+[^\s"]+/gi,
  /api[_-]?key["\s:=]+[^\s"]+/gi,
];

function sanitizeLog(message: string) {
  return redactPatterns.reduce((msg, pattern) => 
    msg.replace(pattern, '[REDACTED]'), 
    message
  );
}
```

### ✗ Email XSS test fails
**Problem:** Templates don't escape HTML
**Fix:** Use auto-escaping or escape manually
```typescript
// ✅ Use nodemailer with sanitization
import { sanitizeHtml } from 'sanitize-html';

const htmlBody = sanitizeHtml(userInput, {
  allowedTags: ['b', 'i', 'em', 'strong', 'a'],
  allowedAttributes: { 'a': ['href'] },
});
```

## Test Configuration

### Environment Variables

```bash
# URL of API to test (the script reads BASE_URL, not API_URL)
export BASE_URL=http://localhost:3000

# Enable verbose logging
export VERBOSE=true

# Show curl request/response detail
export DEBUG=true

# Output format: text (default) or json
export OUTPUT_FORMAT=json

# Which suite to run (default: all)
export TEST_SUITE=auth
```

There is no `FAST_MODE` or `SECTION_FILTER` variable in the script.

### Endpoints the script actually touches

The real routes referenced by `2-security-testing.sh` are TaskFlow's actual
API surface, not a generic `/api/notifications/*` REST API — notably
`/api/health`, `/api/admin/notification-preferences`, `/api/admin/users`, and
`/api/webhooks/gmail-reply` (a disabled 501 stub, see
[`../docs/TESTING.md`](../docs/TESTING.md)). This project has **no**
`/api/notifications`, `/api/notifications/emit`, `/api/audit-logs`, or
`/api/gdpr/export-data` endpoints — an earlier version of this reference
listed those, but they don't exist in `src/app/api/`. The compliance-suite
checks that assume such endpoints will fail or no-op against this codebase.

## Reading Test Output

### Symbols

```
✓ Green  = Test passed
✗ Red    = Test failed (fix required)
⚠ Yellow = Test warning (verify manually)
ℹ Blue   = Informational message
```

### Report Metrics

```
Tests Run:     Total number of tests executed
Tests Passed:  Number of ✓ results
Tests Failed:  Number of ✗ results
Warnings:      Number of ⚠ results
Pass Rate:     Percentage of tests passed
```

## Before Production Checklist

- [ ] Run: `./2-security-testing.sh` (full suite)
- [ ] Result: All tests show ✓ or ⚠ (no ✗)
- [ ] Verify: All ⚠ warnings manually approved
- [ ] Review: Error message sanitization
- [ ] Confirm: Security headers present
- [ ] Check: Rate limiting thresholds appropriate
- [ ] Validate: Email security configuration
- [ ] Test: External service failure handling
- [ ] Audit: Secrets not in environment
- [ ] Verify: GDPR compliance endpoints

## Integration with CI/CD

### GitHub Actions

```yaml
- name: Security Tests
  run: |
    cd testing
    chmod +x 2-security-testing.sh
    ./2-security-testing.sh --format json
```

This repository has **no `.github/workflows/`** today, so this is a starting
point for adding one, not a description of an existing pipeline. The report is
written to `./test-results/security-test-report-<timestamp>.json` (see
`RESULTS_DIR` in the script) — parse that file rather than assuming stdout is
valid JSON on its own.

### GitLab CI

```yaml
security:
  stage: test
  script:
    - cd testing
    - chmod +x 2-security-testing.sh
    - ./2-security-testing.sh --format json
  artifacts:
    paths:
      - testing/test-results/
```

## Test Duration

- **Full suite**: a few minutes, depending on latency to `BASE_URL`
- **Single suite** (`--suite NAME`): a fraction of that

There is no fast/skip mode in the script.

## Resources

- Documentation: See `SECURITY-TESTING-README.md`
- OWASP Top 10: https://owasp.org/Top10/
- CWE List: https://cwe.mitre.org/

---

**Pro Tip:** Run `./2-security-testing.sh` before every deploy to catch issues early.
