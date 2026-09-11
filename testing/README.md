# TaskFlow Testing Suite

Complete testing infrastructure for the TaskFlow Notification System.

> **Status: verified 2026-09-10** against the actual scripts in this directory.
> `2-security-testing.sh` and the K6 load-testing scripts are real and runnable,
> but several flags and behaviors described in earlier versions of this
> directory's docs do not exist in the code — see the corrections below and in
> [`SECURITY-TESTING-README.md`](./SECURITY-TESTING-README.md). These are
> manually-run tools, separate from the automated `npm test` suite documented
> in [`../docs/TESTING.md`](../docs/TESTING.md).

## Overview

This directory contains manually-run testing tools for TaskFlow (load and
security testing, plus token/user generation helpers under `../scripts/`):

1. **2-security-testing.sh** - Bash security test script (993 lines)
2. **SECURITY-TESTING-README.md** - Detailed documentation with remediation guides
3. **SECURITY-QUICK-REFERENCE.md** - Quick reference card for common tasks
4. **SECURITY-SCRIPT-SUMMARY.md** / **SECURITY-TESTING-GUIDE.md** - additional
   summaries of the same script
5. **1-load-testing.yaml** - Load test scenario reference/config (the K6 script
   does not read this file — see the note under Test Configuration below)
6. **load-test.js** - K6 load test script
7. **run-load-tests.sh** - convenience wrapper around `k6 run load-test.js`

## Quick Start

### Run All Security Tests

```bash
cd testing
./2-security-testing.sh
```

### Run a Specific Suite

```bash
# Test only authentication
./2-security-testing.sh --suite auth

# JSON output for CI/CD
./2-security-testing.sh --format json
```

Valid `--suite` values: `all`, `input`, `auth`, `authz`, `ratelimit`,
`exposure`, `api`, `email`, `external`, `secrets`, `compliance`. There is no
`--fast` flag and no `--section N` flag — earlier drafts of this README
described both, but the script only accepts `--base-url`, `--suite`,
`--format`, `--verbose`, `--debug`, `--html`, and `--help` (see
`./2-security-testing.sh --help`). The `--html` flag is parsed but does
**not** currently generate an HTML report — only the text and JSON reports
implemented in the script are actually written.

## Test Coverage

The security testing suite covers **10 domains** (`test_input_validation`,
`test_authentication`, `test_authorization`, `test_rate_limiting`,
`test_data_exposure`, `test_api_security`, `test_email_security`,
`test_external_services`, `test_secret_management`, `test_compliance` in the
script) with roughly 40 individual pass/fail/warn checks in total. Exact
per-domain counts vary by run (some checks are conditional); the breakdown
below is illustrative, not a guaranteed count — see
`SECURITY-SCRIPT-SUMMARY.md` for the closest audited count.

### 1. Input Validation (4 tests)
- SQL Injection prevention
- XSS protection
- Command Injection blocking
- Path Traversal prevention

### 2. Authentication (5 tests)
- Missing JWT detection
- Invalid token rejection
- Expired token validation
- Tampered token detection
- Protected endpoint verification

### 3. Authorization & RLS (4 tests)
- Cross-organization access prevention
- User isolation enforcement
- Preference tampering prevention
- Privilege escalation blocking

### 4. Rate Limiting (3 tests)
- Rate limit enforcement
- Bypass prevention
- Distributed attack protection

### 5. Data Exposure (4 tests)
- Error message sanitization
- Security header verification
- PII protection
- Log sanitization

### 6. API Security (4 tests)
- CORS policy validation
- CSRF protection
- Request size limits
- Timeout enforcement

### 7. Email Security (4 tests)
- Email header injection prevention
- Template XSS protection
- Spoofing prevention
- Attachment validation

### 8. External Services (4 tests)
- Gmail API failure handling
- Redis connection failure
- Supabase downtime handling
- Cascading failure protection

### 9. Secret Management (3 tests)
- Secrets in logs detection
- Secrets in error responses
- Environment variable exposure

### 10. Compliance (4 tests)
- Data retention policies
- Data deletion functionality
- Audit logging
- GDPR compliance

## Files Reference

### Main Script: 2-security-testing.sh

**Size:** ~993 lines | **Language:** Bash 4.0+

**Key Features:**
- Color-coded output (✓, ✗, ⚠)
- Text and JSON reports for CI/CD (`--format json`; no HTML report is
  actually generated despite the `--html` flag being accepted)
- Per-suite testing (`--suite NAME`)
- Verbose and debug modes for troubleshooting
- Exit codes for automation

**Usage:**
```bash
./2-security-testing.sh [--base-url URL] [--suite NAME] [--format text|json] [--verbose] [--debug] [--html] [--help]
```

**Exit Codes:**
- `0` = All tests passed
- `1` = Tests failed
- `2` = Execution error

### Documentation

#### SECURITY-TESTING-README.md
**Comprehensive guide covering:**
- Installation and prerequisites
- All 10 sections with detailed explanations
- Remediation guides for each test
- CI/CD integration examples
- Common issues and solutions
- Best practices
- OWASP Top 10 mapping

#### SECURITY-QUICK-REFERENCE.md
**Quick reference for:**
- Test commands cheat sheet
- Section overview table
- Critical tests list
- Common failure fixes
- Environment configuration
- Pre-production checklist

## CI/CD Integration

### GitHub Actions

```yaml
- name: Security Testing
  run: |
    cd testing
    chmod +x 2-security-testing.sh
    ./2-security-testing.sh --format json
```

This repository has **no `.github/workflows/`** configured — there is no CI
pipeline actually running this today; the snippet above is a starting point if
you add one.

### Local Development

```bash
# Watch mode - re-run on file changes
watch -n 10 'cd testing && ./2-security-testing.sh'
```

## Test Results

### Expected Behavior

**Before Production:**
- All FAIL results must be fixed
- All WARN results manually verified
- PASS rate ≥ 95%

**After Fix:**
- Re-run tests to verify fix
- Document changes in commit message
- Review with security team

## File Structure

```
testing/
├── 2-security-testing.sh              # Main security test suite (executable)
├── SECURITY-TESTING-README.md         # Comprehensive documentation
├── SECURITY-QUICK-REFERENCE.md        # Quick reference card
├── README.md                          # This file
├── 1-load-testing.yaml               # Load testing configuration
└── load-test.js
```

## Requirements

### System
- Bash 4.0+
- curl
- Python 3 (optional)

### API Setup
- API running at `http://localhost:3000` or the URL passed via `$BASE_URL` / `--base-url`
- Endpoints properly protected with authentication
- Rate limiting configured
- Security headers enabled

## Common Commands

```bash
# Run all tests
./2-security-testing.sh

# Run input validation tests
./2-security-testing.sh --suite input

# Run authentication tests
./2-security-testing.sh --suite auth

# Run authorization tests
./2-security-testing.sh --suite authz

# JSON output for CI/CD
./2-security-testing.sh --format json

# Debug mode with full output
./2-security-testing.sh --verbose --debug --suite auth

# Specific suite only
./2-security-testing.sh --suite exposure  # Data exposure
```

## Test Configuration

Set environment variables to customize (matching the script's real defaults):

```bash
# Base URL (default: http://localhost:3000) — the script reads BASE_URL, not API_URL
export BASE_URL=http://api.example.com

# Enable verbose output
export VERBOSE=true

# Show curl request/response detail
export DEBUG=true

# Output format: text (default) or json
export OUTPUT_FORMAT=json

# Request timeout in seconds (default: 10)
export TIMEOUT=30

# Which suite to run (default: all)
export TEST_SUITE=auth

# Where reports are written (default: ./test-results)
export RESULTS_DIR=./test-results
```

There is no `FAST_MODE`, `JSON_OUTPUT`, `SECTION_FILTER`, or `API_URL`
environment variable in the script — those were documented here previously
but do not exist in `2-security-testing.sh`.

## Troubleshooting

### Tests timeout or can't connect

```bash
# Verify API is running
curl http://localhost:3000/api/health

# Try with custom URL
./2-security-testing.sh --base-url http://your-api:3000
```

### Email/Gmail tests failing

`POST /api/webhooks/gmail-reply` is a disabled `501` stub in this codebase
(see `../docs/TESTING.md`), so the script's Gmail-related check expects that
501/disabled response rather than a live Gmail integration.

### Rate limiting tests inconclusive

```bash
# Run rate limiting tests separately
./2-security-testing.sh --suite ratelimit
```

Rate limiting in this app is backed by Upstash Redis over HTTPS
(`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`), not a local Redis
instance, so `redis-cli FLUSHDB` will not affect it.

## Security Checklist

Use before every production deployment:

- [ ] Run full security test suite
- [ ] All tests show PASS (✓) or warning (⚠)
- [ ] Fix all FAIL (✗) results
- [ ] Manually verify all warnings
- [ ] Review error messages (no secrets)
- [ ] Verify security headers present
- [ ] Confirm rate limiting active
- [ ] Test external service failures
- [ ] Validate GDPR endpoints

## Performance

- **Full suite**: roughly a few minutes, depending on network latency to `BASE_URL`
- **Single suite** (`--suite NAME`): a fraction of that

There is no fast/skip mode in the script; running a single `--suite` is the
only way to shorten a run.

## Support

For questions or issues:

1. Check `SECURITY-TESTING-README.md` for detailed guidance
2. Review `SECURITY-QUICK-REFERENCE.md` for quick answers
3. Check test logs: `./2-security-testing.sh --verbose`
4. See remediation guides for specific failures

## Maintenance

- Update tests quarterly as new vulnerabilities discovered
- Review rate limit thresholds annually
- Verify compliance requirements still current
- Keep OWASP Top 10 mapping updated

## Related Documents

- Notification System: `src/lib/notifications/`
- API routes: `src/app/api/**/route.ts`
- Automated tests (`npm test`): [`../docs/TESTING.md`](../docs/TESTING.md)

There is no `SECURITY.md` file in this repository — a previous version of
this document pointed to one that does not exist.

---

**Last Updated:** 2026-09-10 (this correction pass)
**Maintained by:** whoever runs it — there is no dedicated "Security Team" in
this project.
