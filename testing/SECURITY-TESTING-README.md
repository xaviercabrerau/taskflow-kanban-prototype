# Security Testing Guide - TaskFlow Notification System

Comprehensive security testing toolkit for validating the TaskFlow notification pipeline, email delivery, and data handling security posture.

> **Status: verified 2026-09-10** against `testing/2-security-testing.sh`. This
> document previously described flags, environment variables, and endpoints
> (`/api/notifications/*`, `/api/gdpr/*`, `/api/audit-logs`) that do not exist
> in this project or in the script. Corrections are inline below; the real
> flags are `--suite NAME`, `--format text|json`, `--base-url`, `--verbose`,
> `--debug`, `--html` (parsed but does not generate an HTML report), and
> `--help`. There is no `--section N` flag and no `--fast`/"fast mode".

## Overview

This security testing framework covers 10 critical domains:

1. **Input Validation** - SQL injection, XSS, command injection, path traversal
2. **Authentication** - JWT tokens, expired tokens, tampered tokens
3. **Authorization & RLS** - Cross-organization access, user isolation, privilege escalation
4. **Rate Limiting** - Threshold enforcement, bypass attempts, distributed attacks
5. **Data Exposure** - Error messages, PII, sensitive headers, log leakage
6. **API Security** - CORS, CSRF, request sizes, timeouts
7. **Email Security** - Header injection, XSS in templates, spoofing, attachments
8. **External Services** - Gmail-reply webhook behavior, Upstash Redis (rate limiting/cache) issues, Supabase downtime, cascading failures
9. **Secret Management** - Secrets in logs, errors, environment variables
10. **Compliance** - Data retention, deletion, audit logging, GDPR compliance

## Quick Start

### Prerequisites

```bash
# Required tools
- bash 4.0+
- curl
- jq (optional, only used if you post-process the JSON report yourself)

# Environment variables the script actually reads
BASE_URL=http://localhost:3000  # API base URL (default: localhost:3000)
VERBOSE=false                    # Show detailed output (true/false)
DEBUG=false                      # Show curl requests/responses (true/false)
OUTPUT_FORMAT=text               # text or json
TEST_SUITE=all                   # Which suite to run
TIMEOUT=10                       # Request timeout, seconds
RESULTS_DIR=./test-results        # Where reports are written
```

There is no `API_URL`, `JSON_OUTPUT`, or `FAST_MODE` variable — those were
documented here previously but the script does not read them.

### Basic Usage

```bash
# Run all tests
./2-security-testing.sh

# Run in CI/CD with JSON output
./2-security-testing.sh --format json

# Run only one suite
./2-security-testing.sh --suite input

# Verbose output for debugging
./2-security-testing.sh --verbose

# Combined options
./2-security-testing.sh --format json --verbose --suite auth
```

## Test Sections

### Section 1: Input Validation — `--suite input`

Tests protection against injection attacks:

- **SQL Injection** - Verify parameterized queries prevent database injection
- **XSS Injection** - Confirm payload escaping in notification data
- **Command Injection** - Ensure commands cannot be executed via input
- **Path Traversal** - Block directory traversal attempts

**Remediation Guide:**
- Use parameterized queries/prepared statements for all DB queries
- Escape/sanitize all user input before rendering in HTML/email
- Avoid shell/exec functions with user-supplied data
- Validate and normalize file paths

### Section 2: Authentication — `--suite auth`

Tests JWT token validation and authentication enforcement:

- **Missing JWT** - Reject requests without authorization header
- **Invalid JWT** - Reject malformed/invalid tokens
- **Expired JWT** - Validate token expiration times
- **Tampered JWT** - Verify signature integrity
- **Unprotected Endpoints** - Ensure all sensitive endpoints require auth

**Remediation Guide:**
- Implement middleware to validate JWT on all protected routes
- Check `exp` claim for token expiration
- Verify JWT signature using correct algorithm and key
- Use strong key rotation practices

### Section 3: Authorization & RLS — `--suite authz`

Tests database-level authorization and cross-organization/user isolation:

- **Cross-Organization Access** - Prevent access to other organization's data
- **User Isolation** - Users cannot see each other's notifications
- **Preference Tampering** - Prevent modification of other user's settings
- **Privilege Escalation** - Verify actor_id cannot be spoofed

**Remediation Guide:**
- Implement Row-Level Security (RLS) policies in Supabase
- Enforce `organization_id` filtering in all queries
- Verify user ownership before allowing modifications
- Validate actor permissions before recording event

### Section 4: Rate Limiting — `--suite ratelimit`

Tests request rate limiting and distributed attack prevention:

- **Rate Limit Enforcement** - API rejects requests exceeding threshold
- **Header Bypass Prevention** - Validate X-Forwarded-For header
- **Distributed Attack Protection** - Rate limiting per true IP

**Remediation Guide:**
- Implement rate limiting middleware (e.g., express-rate-limit)
- Use sliding window algorithm for fair distribution
- Rate limit state is stored in Upstash Redis over HTTPS (`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, aliased as `KV_REST_API_URL`/`KV_REST_API_TOKEN` on Vercel) — not a local Redis instance
- Trust X-Forwarded-For only from trusted proxies
- Set appropriate limits: 100 req/minute for notifications/emit

### Section 5: Data Exposure — `--suite exposure`

Tests for information leakage through errors, headers, and logs:

- **Error Message Leakage** - Verify no sensitive data in errors
- **Security Headers** - Check for CSP, X-Frame-Options, HSTS
- **PII Exposure** - Ensure no SSN/passport/payment data in responses
- **Log Sanitization** - Verify secrets not logged

**Remediation Guide:**
- Return generic error messages in production: "An error occurred"
- Set security headers: CSP, X-Content-Type-Options, X-Frame-Options, HSTS
- Never log user passwords, tokens, or PII
- Use structured logging with built-in redaction

### Section 6: API Security — `--suite api`

Tests cross-origin, CSRF, and request handling:

- **CORS Policy** - Verify origins restricted (not wildcard)
- **CSRF Protection** - Check token requirement for state-changing requests
- **Request Size Limits** - Oversized payloads rejected (413 status)
- **Timeout Protection** - Long-running requests timeout

**Remediation Guide:**
- Configure CORS with explicit allowed origins
- Implement CSRF token validation for POST/PUT/DELETE
- Set max request size: 1MB for JSON payloads
- Set request timeout: 30 seconds default

### Section 7: Email Security — `--suite email`

Tests email delivery and template security:

- **Header Injection** - Prevent email header manipulation
- **XSS in Templates** - HTML-escape template variables
- **Email Spoofing** - Verify From header sender
- **Attachment Validation** - Block dangerous file types

**Remediation Guide:**
- Use libraries like nodemailer that sanitize headers
- Use templating engines with auto-escaping (handlebars, nunjucks)
- Enforce From address matching authenticated user
- Whitelist safe attachment types: pdf, doc, docx, txt, csv
- Block: exe, bat, com, scr, zip with embedded executables

### Section 8: External Service Security — `--suite external`

Tests resilience to external service failures:

- **Gmail API Failures** - Graceful degradation when Gmail unavailable
- **Upstash Redis Failure** - Rate limiting/cache degrades gracefully when Upstash is unreachable (this project has no job queue)
- **Supabase Downtime** - Database unavailability handling
- **Cascading Failures** - Multiple simultaneous failures

**Remediation Guide:**
- Implement circuit breakers for external APIs
- Use exponential backoff for retries (1s, 2s, 4s, 8s, 16s)
- Store failed jobs in database for manual retry
- Set sensible timeouts for the Upstash Redis REST calls and Supabase queries
- Monitor error rates and alert on thresholds

### Section 9: Secret Management — `--suite secrets`

Tests protection of sensitive credentials:

- **Secrets in Logs** - Verify no passwords/tokens in logs
- **Secrets in Errors** - Error responses don't leak secrets
- **Env Variable Exposure** - No environment variables in responses

**Remediation Guide:**
- Use libraries like winston with redaction patterns
- Never return full stack traces in production
- Keep environment file names out of git history
- Use secrets manager (Vercel Secrets, AWS Secrets Manager)
- Never log: passwords, tokens, API keys, database credentials

### Section 10: Compliance — `--suite compliance`

Tests regulatory and audit requirements:

- **Data Retention** - Old notifications deleted per policy
- **Data Deletion** - Soft/hard delete working correctly
- **Audit Logging** - Complete audit trail with required fields
- **GDPR Compliance** - User data export functionality

**Remediation Guide:**
- Implement automated deletion job: delete notifications >90 days
- Record all modifications in audit logs
- Audit logs must include: timestamp, user_id, action, resource, status
- This project does **not** currently have `/api/gdpr/export-data` or
  `/api/gdpr/delete-data` endpoints, or a dedicated `/api/audit-logs` route
  (see the real route list in `../MIGRACION.md` / `GROUND_TRUTH`) — treat
  the compliance suite's checks against those paths as a gap to fill, not a
  description of existing functionality
- Test retention and deletion regularly

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Security Tests

on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Start API server
        run: npm run dev &
        env:
          API_PORT: 3000
      
      - name: Wait for API
        run: sleep 5
      
      - name: Run security tests
        run: |
          cd testing
          ./2-security-testing.sh --format json
          # Report is written under testing/test-results/, not stdout redirection
          
      - name: Parse results
        run: |
          FAILED=$(jq '[.[] | select(.status == "FAIL")] | length' results.json)
          if [ $FAILED -gt 0 ]; then
            echo "Security tests failed: $FAILED"
            exit 1
          fi
```

### Local Development

```bash
# Terminal 1: Start API
npm run dev

# Terminal 2: Run tests
cd testing
./2-security-testing.sh --verbose

# Watch for changes and re-run
watch -n 10 './2-security-testing.sh'
```

## Interpreting Results

### Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed
- `2` - Test execution error (configuration, network issue)

### Output Format

#### Console Output (Default)

```
✓ Test passed (green)
✗ Test failed (red)
⚠ Warning/verification needed (yellow)
ℹ Informational message (blue)
```

#### JSON Output

The real shape written to
`test-results/security-test-report-<timestamp>.json` is an object, not a bare
array:

```json
{
  "timestamp": "2026-09-10T00:00:00Z",
  "base_url": "http://localhost:3000",
  "summary": {
    "tests_run": 40,
    "tests_passed": 35,
    "tests_failed": 2,
    "warnings": 3,
    "critical_failures": 0,
    "pass_rate": 87
  },
  "status": "FAIL",
  "details": [
    { "status": "PASS", "section": "Authentication", "test": "Missing JWT rejected", "severity": "low" },
    { "status": "FAIL", "section": "Authentication", "test": "Tampered token rejected", "severity": "critical" }
  ]
}
```

## Common Issues & Solutions

### Issue: All tests timeout or fail to connect

**Solution:**
```bash
# Verify API is running
curl http://localhost:3000/api/health

# Check BASE_URL environment variable (the script does not read API_URL)
echo $BASE_URL

# Run with custom URL
./2-security-testing.sh --base-url http://192.168.1.100:3000
```

### Issue: CORS tests show false positives

**Solution:**
- CORS is expected in development
- Tests assume stricter production policy
- Manually verify CORS configuration in production

### Issue: Email tests failing but Gmail works

**Solution:**
- Tests assume Gmail API not integrated in test environment
- There is no flag to skip email tests specifically — use `--suite email` to isolate them instead
- Manually test Gmail integration separately

### Issue: Rate limiting shows false negatives

**Solution:**
- Rate limiting may already be triggered by other tests
- Run the suite separately: `./2-security-testing.sh --suite ratelimit`
- Rate limiting is backed by Upstash Redis over HTTPS, not a local instance, so `redis-cli FLUSHDB` will not clear it — use the Upstash console/API instead

## Best Practices

### Before Production Deployment

1. Run full security test suite: `./2-security-testing.sh`
2. Fix all FAIL results
3. Verify all WARN results manually
4. Run twice to ensure consistency
5. Review test output for edge cases

### Regular Security Testing

```bash
# Weekly in CI/CD
0 0 * * 0 cd /path/to/app/testing && ./2-security-testing.sh --format json

# After security incidents
./2-security-testing.sh --verbose

# After dependencies update
npm update && ./2-security-testing.sh
```

### Test-Driven Security

```bash
# 1. Write test for new vulnerability
# 2. Verify it fails
# 3. Implement fix
# 4. Verify test passes
# 5. Commit both test and fix

# Example: prevent header injection
./2-security-testing.sh --suite email
# Implement fix
./2-security-testing.sh --suite email  # Verify
```

## Extending the Test Suite

### Adding a New Test

Edit `2-security-testing.sh` and add to appropriate section:

```bash
# In test_input_validation() or other section:

# Test X.Y: Clear description
increment_test_counter
log_info "Test X.Y: Clear description"

local response=$(make_request POST "/api/endpoint" \
    "{\"param\": \"test_value\"}")

if [[ condition ]]; then
    log_pass "Test passed"
    add_test_result X "Test Name" "PASS" "Details"
else
    log_fail "Test failed"
    add_test_result X "Test Name" "FAIL" "Failure reason"
fi
```

### Adding a New Section

1. Create `test_new_domain()` function
2. Add `log_section` header
3. Add tests with `increment_test_counter`
4. Call from `main()` function
5. Update this documentation

## Security Test Checklist

Use this checklist before each release:

- [ ] All Section 1-3 tests pass (input, auth, authorization)
- [ ] No secrets in errors or logs (Section 9)
- [ ] Rate limiting active (Section 4)
- [ ] Security headers present (Section 5)
- [ ] Data retention/deletion working (Section 10)
- [ ] External service failures handled (Section 8)
- [ ] Email security validated (Section 7)
- [ ] GDPR-style data export/delete — not implemented yet in this project (Section 10 checks a gap, see note above)
- [ ] Test results reviewed by security team
- [ ] All WARN results manually verified

## Additional Resources

### OWASP Top 10 Mapping

- Injection (A03) → Section 1
- Broken Authentication (A07) → Section 2
- Broken Access Control (A01) → Section 3
- Sensitive Data Exposure (A02) → Section 5
- Security Misconfiguration (A05) → Section 6
- A08 - Software & Data Integrity Failures → Section 8

### Security Standards

- GDPR Article 12-14: User rights (Section 10)
- CWE-22: Path Traversal (Section 1)
- CWE-89: SQL Injection (Section 1)
- CWE-79: XSS (Section 1, 7)

### Tools for Manual Testing

- **Burp Suite Community** - Intercept and modify requests
- **OWASP ZAP** - Automated vulnerability scanning
- **Postman** - API testing with custom payloads
- **Trivy** - Container/dependency scanning

## Support & Issues

For issues or questions:

1. Check test logs: `./2-security-testing.sh --verbose`
2. Review this documentation
3. Check Section-specific remediation guides
4. Consult OWASP Top 10 resources
5. Review notification system architecture docs

## Maintenance

### Updates

- Update test thresholds based on production performance
- Add new tests as vulnerabilities discovered
- Review rate limits annually with team
- Verify compliance requirements still current

### Test Data

- Update `TEST_USER_ID`, `TEST_ORG_ID` generation if needed
- Adjust payload sizes for your API limits
- Customize security headers for your policy

---

**Last Updated:** 2026-09-10 (this correction pass)
**Maintained by:** whoever runs it — there is no dedicated "Security Team" in this project.
