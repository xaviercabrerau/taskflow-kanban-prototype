# Security Testing Quick Reference Card

## Run Tests

```bash
# Full suite (all 10 sections, ~5-10 minutes)
./2-security-testing.sh

# Quick mode (skip external services, ~2 minutes)
./2-security-testing.sh --fast

# Specific section only
./2-security-testing.sh --section 1

# CI/CD with JSON
./2-security-testing.sh --json --fast

# Debug mode
./2-security-testing.sh --verbose --section 2
```

## Test Sections at a Glance

| # | Section | Focus | Count | Remediation |
|---|---------|-------|-------|------------|
| 1 | Input Validation | SQL/XSS/Command/Path attacks | 4 | Parameterize queries, escape output, validate paths |
| 2 | Authentication | JWT validation, token checks | 5 | Verify JWT on all protected routes, check expiration |
| 3 | Authorization | RLS, cross-org, privilege | 4 | Implement RLS policies, verify user ownership |
| 4 | Rate Limiting | DDoS/brute force protection | 3 | Use sliding window, 100 req/min for /emit |
| 5 | Data Exposure | Errors, headers, PII, logs | 4 | Generic errors, security headers, sanitize logs |
| 6 | API Security | CORS, CSRF, timeouts | 4 | Restrict CORS, CSRF tokens, 30s timeout |
| 7 | Email Security | Headers, XSS, spoofing | 4 | Sanitize headers, escape templates, verify From |
| 8 | External Services | Failures, cascading issues | 4 | Circuit breakers, exponential backoff, timeouts |
| 9 | Secrets Management | Leakage in logs/errors | 3 | Redact logs, generic errors, use secrets manager |
| 10 | Compliance | Retention, audit, GDPR | 4 | Delete >90d, audit logs, GDPR endpoints |

## Critical Tests (Must Pass Before Production)

```
Section 1: SQL Injection (test 1.1)
Section 2: Missing JWT (test 2.1)
Section 3: Cross-Org Access (test 3.1)
Section 4: Rate Limiting (test 4.1)
Section 5: Error Leakage (test 5.1)
Section 9: Secrets in Errors (test 9.2)
Section 10: Data Retention (test 10.1)
```

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
# URL of API to test
export API_URL=http://localhost:3000

# Enable verbose logging
export VERBOSE=1

# Output JSON for parsing
export JSON_OUTPUT=1

# Skip external service tests
export FAST_MODE=1

# Run only one section
export SECTION_FILTER=2
```

### Endpoint Requirements

Tests assume these endpoints exist and are properly protected:

```
GET     /api/notifications              # List notifications
POST    /api/notifications/emit         # Emit event
GET     /api/notifications/preferences  # Get preferences
PUT     /api/notifications/preferences  # Update preferences
DELETE  /api/notifications/:id          # Delete notification
GET     /api/audit-logs                 # Get audit logs
GET     /api/gdpr/export-data           # Export user data
```

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
    ./2-security-testing.sh --json --fast > results.json
    
    FAILED=$(jq '[.[] | select(.status == "FAIL")] | length' results.json)
    if [ $FAILED -gt 0 ]; then
      echo "❌ Security tests failed"
      jq '.[] | select(.status == "FAIL")' results.json
      exit 1
    fi
    echo "✅ All security tests passed"
```

### GitLab CI

```yaml
security:
  stage: test
  script:
    - cd testing
    - chmod +x 2-security-testing.sh
    - ./2-security-testing.sh --json --fast
  artifacts:
    reports:
      sast: results.json
```

## Test Duration

- **Full suite**: 5-10 minutes (includes external services)
- **Fast mode**: 2-3 minutes (skips Gmail, Redis, Supabase)
- **Single section**: 15-30 seconds
- **CI/CD recommended**: Fast mode only

## Resources

- Documentation: See `SECURITY-TESTING-README.md`
- OWASP Top 10: https://owasp.org/Top10/
- CWE List: https://cwe.mitre.org/
- GDPR Guide: https://gdpr-info.eu/

---

**Pro Tip:** Run `./2-security-testing.sh --fast` before every commit to catch issues early!
