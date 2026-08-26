# Security Testing Quick Start Guide

## Overview

The `2-security-testing.sh` script provides comprehensive security testing for the TaskFlow Notification System with 10 test suites covering 40+ security scenarios.

## Quick Start

### Run All Tests
```bash
./2-security-testing.sh
```

### Test Specific Domains
```bash
./2-security-testing.sh --suite auth          # Authentication only
./2-security-testing.sh --suite input         # Input validation
./2-security-testing.sh --suite api           # API security
./2-security-testing.sh --suite email         # Email security
./2-security-testing.sh --suite compliance    # Compliance checks
```

### Advanced Options
```bash
# Verbose output
./2-security-testing.sh --verbose

# Debug mode (see curl requests/responses)
./2-security-testing.sh --debug

# JSON report output
./2-security-testing.sh --format json

# Test staging environment
BASE_URL=http://staging:3000 ./2-security-testing.sh

# Combined options
BASE_URL=http://staging:3000 ./2-security-testing.sh --format json --verbose
```

## Test Suites

### 1. Input Validation (5 tests)
Tests protection against common injection attacks:
- SQL injection
- XSS (Cross-Site Scripting)
- Command injection
- Path traversal
- Invalid JSON/malformed data

**Commands to test individually:**
```bash
./2-security-testing.sh --suite input --verbose
```

### 2. Authentication (5 tests)
Validates JWT token handling:
- Missing JWT rejection
- Invalid JWT format detection
- Expired token detection
- Tampered token rejection
- Bearer token requirement enforcement

**Commands to test individually:**
```bash
./2-security-testing.sh --suite auth --verbose
```

### 3. Authorization (4 tests)
Verifies access control enforcement:
- Cross-user access prevention
- Cross-organization access prevention
- Privilege escalation prevention
- RLS (Row-Level Security) bypass prevention

**Commands to test individually:**
```bash
./2-security-testing.sh --suite authz --verbose
```

### 4. Rate Limiting (2 tests)
Validates rate limiting implementation:
- Threshold enforcement (5 req/min)
- Rate limit header exposure
- IP spoofing detection

**Commands to test individually:**
```bash
./2-security-testing.sh --suite ratelimit --verbose
```

### 5. Data Exposure (4 tests)
Checks for information leakage:
- Error message sanitization
- Security header presence
- Secrets in responses
- PII (Personally Identifiable Information) exposure

**Commands to test individually:**
```bash
./2-security-testing.sh --suite exposure --verbose
```

### 6. API Security (4 tests)
Validates API security controls:
- CORS policy enforcement
- HTTP method validation
- Content-Type validation
- Request timeout handling

**Commands to test individually:**
```bash
./2-security-testing.sh --suite api --verbose
```

### 7. Email Security (3 tests)
Tests email-specific security:
- Email header injection prevention
- Email template XSS protection
- From address validation

**Commands to test individually:**
```bash
./2-security-testing.sh --suite email --verbose
```

### 8. External Services (2 tests)
Validates external service handling:
- Gmail API failure handling
- Health check isolation
- Graceful degradation

**Commands to test individually:**
```bash
./2-security-testing.sh --suite external --verbose
```

### 9. Secret Management (4 tests)
Checks for credential exposure:
- Secrets in error responses
- Environment variable exposure
- .env file protection
- .env.example documentation

**Commands to test individually:**
```bash
./2-security-testing.sh --suite secrets --verbose
```

### 10. Compliance (4 tests)
Verifies compliance requirements:
- Data deletion functionality
- Audit logging presence
- GDPR data export endpoint
- Privacy policy documentation

**Commands to test individually:**
```bash
./2-security-testing.sh --suite compliance --verbose
```

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | All tests passed | Ready to deploy |
| 1 | One or more failures | Review FAIL results |
| 2 | Test execution error | Check configuration |
| 3 | Connection error | Verify BASE_URL is reachable |

## Reports

Reports are automatically saved to `./test-results/`:

### Text Report
```
security-test-report-YYYYMMDD_HHMMSS.txt
```

Includes:
- Executive summary
- Detailed results by category
- Security recommendations
- Best practices checklist
- Production deployment requirements

### JSON Report
```
security-test-report-YYYYMMDD_HHMMSS.json
```

Includes:
- Timestamp
- Summary metrics
- Structured test results
- Severity levels
- Machine-readable format for CI/CD

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
      - name: Run security tests
        run: ./testing/2-security-testing.sh
        env:
          BASE_URL: http://localhost:3000
```

### GitLab CI Example
```yaml
security_test:
  script:
    - ./testing/2-security-testing.sh
  artifacts:
    paths:
      - test-results/
    expire_in: 30 days
```

## Interpreting Results

### PASS (✓)
Test succeeded - no action needed.

### FAIL (✗)
**Critical issue** - must be fixed before production deployment.

### WARN (⚠)
**Potential issue** - review and decide whether to implement control or accept risk.

## Best Practices

1. **Before Deployment:**
   ```bash
   BASE_URL=http://localhost:3000 ./2-security-testing.sh
   ```
   All FAIL results must be fixed.

2. **Staging Validation:**
   ```bash
   BASE_URL=http://staging:3000 ./2-security-testing.sh --format json
   ```
   Keep JSON report for compliance documentation.

3. **Regular Testing:**
   ```bash
   # Monthly or after security updates
   ./2-security-testing.sh --verbose
   ```

4. **Investigation:**
   ```bash
   # Debug specific failures
   ./2-security-testing.sh --suite auth --debug --verbose
   ```

## Customization

### Changing Base URL
```bash
BASE_URL=http://custom-host:8080 ./2-security-testing.sh
```

### Adjusting Timeout
```bash
TIMEOUT=30 ./2-security-testing.sh
```

### Enabling Verbose Output
```bash
VERBOSE=true ./2-security-testing.sh
```

### Debug Mode
```bash
DEBUG=true ./2-security-testing.sh
```

## Troubleshooting

### "Connection refused" error
- Verify BASE_URL is correct: `curl $BASE_URL/api/health`
- Ensure application is running
- Check firewall/network policies

### Tests showing "CONNECTION_ERROR"
```bash
# Test connectivity
curl -v http://localhost:3000/api/health

# Try with explicit timeout
TIMEOUT=30 ./2-security-testing.sh
```

### Want to see request/response details
```bash
./2-security-testing.sh --debug --verbose
```

### Generate both text and JSON reports
```bash
./2-security-testing.sh                    # Text
./2-security-testing.sh --format json      # JSON
```

## Remediation Workflow

1. **Run tests** - identify all issues
2. **Categorize** - separate FAIL from WARN
3. **Fix FAILs** - implement critical fixes
4. **Retest** - run `--suite` tests for fixes
5. **Document WAINs** - decide: implement or accept risk
6. **Archive report** - save for compliance audit trail
7. **Redeploy** - confirm all FAILs resolved before production

## Further Reading

- [SECURITY-TESTING-README.md](./SECURITY-TESTING-README.md) - Detailed test descriptions
- [SECURITY-QUICK-REFERENCE.md](./SECURITY-QUICK-REFERENCE.md) - Security controls reference
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) - Common vulnerabilities
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework) - Security standards

## Support

For issues or questions:
1. Check if endpoint is reachable: `curl $BASE_URL/api/health`
2. Run with `--debug` flag for detailed output
3. Review test code in script for exact assertion logic
4. Check project's security documentation
