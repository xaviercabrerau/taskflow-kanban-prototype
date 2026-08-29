# TaskFlow Testing Suite

Complete testing infrastructure for the TaskFlow Notification System.

## Overview

This directory contains the complete testing infrastructure for TaskFlow:

1. **2-security-testing.sh** - Comprehensive security test suite (41KB, 800+ lines)
2. **SECURITY-TESTING-README.md** - Complete documentation with remediation guides
3. **SECURITY-QUICK-REFERENCE.md** - Quick reference card for common tasks
4. **1-load-testing.yaml** - Load testing configuration
5. **load-test.js** - Load test execution script

## Quick Start

### Run All Security Tests

```bash
cd testing
./2-security-testing.sh
```

### Run Specific Section

```bash
# Test only authentication (Section 2)
./2-security-testing.sh --section 2

# Fast mode (skip external services)
./2-security-testing.sh --fast

# With JSON output for CI/CD
./2-security-testing.sh --json
```

## Test Coverage

The security testing suite covers **10 critical domains** with **40+ individual tests**:

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

**Size:** 41KB | **Lines:** 800+ | **Languages:** Bash 4.0+

**Key Features:**
- Color-coded output (✓, ✗, ⚠)
- JSON export for CI/CD
- Per-section testing
- Verbose mode for debugging
- Fast mode for quick checks
- Exit codes for automation

**Usage:**
```bash
./2-security-testing.sh [--json] [--verbose] [--fast] [--section N] [--no-color]
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
    ./2-security-testing.sh --json --fast
```

### Local Development

```bash
# Watch mode - re-run on file changes
watch -n 10 'cd testing && ./2-security-testing.sh --fast'
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
- API running at `http://localhost:3000` or `$API_URL`
- Endpoints properly protected with authentication
- Rate limiting configured
- Security headers enabled

## Common Commands

```bash
# Run all tests
./2-security-testing.sh

# Run input validation tests
./2-security-testing.sh --section 1

# Run authentication tests
./2-security-testing.sh --section 2

# Run authorization tests
./2-security-testing.sh --section 3

# Fast mode for CI/CD
./2-security-testing.sh --json --fast

# Debug mode with full output
./2-security-testing.sh --verbose --section 2

# Specific test only
./2-security-testing.sh --section 5  # Data exposure
```

## Test Configuration

Set environment variables to customize:

```bash
# API URL (default: http://localhost:3000)
export API_URL=http://api.example.com

# Enable verbose output
export VERBOSE=1

# Output JSON instead of text
export JSON_OUTPUT=1

# Skip external service tests
export FAST_MODE=1

# Run only one section
export SECTION_FILTER=3
```

## Troubleshooting

### Tests timeout or can't connect

```bash
# Verify API is running
curl http://localhost:3000/api/health

# Try with custom URL
API_URL=http://your-api:3000 ./2-security-testing.sh
```

### Email/Gmail tests failing

```bash
# Gmail integration not needed for tests
./2-security-testing.sh --fast
```

### Rate limiting tests inconclusive

```bash
# Run rate limiting tests separately
./2-security-testing.sh --section 4

# Clear Redis cache if used
redis-cli FLUSHDB
```

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

- **Full suite**: ~5-10 minutes
- **Fast mode**: ~2-3 minutes
- **Single section**: ~15-30 seconds
- **CI/CD recommended**: Fast mode

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

- Architecture: `AGENTS.md`
- Notification System: `src/lib/notifications/`
- API Documentation: See Next.js routes
- Security Policy: See project SECURITY.md

---

**Last Updated:** 2026-08-18
**Version:** 1.0
**Maintained by:** Security Team
