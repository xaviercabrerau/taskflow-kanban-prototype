# Testing Quick Reference Guide

Quick reference for running load tests, security tests, and monitoring the TaskFlow Notification System.

## TL;DR Setup (5 minutes)

```bash
# 1. Create test users (first time only)
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node scripts/generate-test-users.js 50

# 2. Generate JWT tokens (before each test session)
export SUPABASE_ANON_KEY="your-anon-key"
node scripts/generate-test-tokens.js 5

# 3. Run baseline load test (5 minutes)
export AUTH_TOKEN="Bearer <token-from-step-2>"
./testing/run-load-tests.sh

# Done! Check testing/results/ for reports
```

## Common Commands

### Load Testing

```bash
# Baseline (5 min, 10 VUs)
./testing/run-load-tests.sh

# Ramp-up test (15 min, gradual 10→100 VUs)
./testing/run-load-tests.sh -s ramp_up

# Spike test (10 min, sudden 500 VUs)
./testing/run-load-tests.sh -s spike

# Stress test (20 min, up to breaking point)
./testing/run-load-tests.sh -s stress

# Endurance test (60 min, 50 VUs)
./testing/run-load-tests.sh -s endurance

# Email delivery test (30 min)
./testing/run-load-tests.sh -s email_delivery

# Custom: 200 VUs for 10 minutes
k6 run --vus 200 --duration 10m testing/load-test.js

# Export to CSV (for Excel analysis)
./testing/run-load-tests.sh -f csv

# Dry run (show command without executing)
./testing/run-load-tests.sh --dry-run
```

### Security Testing

```bash
# Run all security tests
./testing/2-security-testing.sh

# Specific test suite
./testing/2-security-testing.sh --suite input          # Input validation
./testing/2-security-testing.sh --suite auth           # Authentication
./testing/2-security-testing.sh --suite compliance     # GDPR/compliance

# Verbose output (shows details)
./testing/2-security-testing.sh --verbose

# Debug mode (shows curl requests/responses)
./testing/2-security-testing.sh --debug

# JSON output (for CI/CD integration)
./testing/2-security-testing.sh --format json

# Against staging
BASE_URL=https://staging.taskflow.app ./testing/2-security-testing.sh
```

### Credential Management

```bash
# Generate test users (one-time)
node scripts/generate-test-users.js 10        # 10 users
node scripts/generate-test-users.js 50        # 50 users
node scripts/generate-test-users.js 100       # 100 users

# Generate JWT tokens (before each test session)
node scripts/generate-test-tokens.js           # 5 tokens
node scripts/generate-test-tokens.js 20        # 20 tokens
node scripts/generate-test-tokens.js 50        # 50 tokens

# Verify credentials work
./scripts/test-credentials.sh
```

## Environment Setup

### Required Environment Variables

```bash
# Load Testing
export BASE_URL="http://localhost:3000"
export AUTH_TOKEN="Bearer <jwt_token>"
export TEST_USER_ID="<user-uuid>"
export ORGANIZATION_ID="<org-uuid>"

# Supabase (for credential generation)
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="<anon-key>"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"

# Sentry (optional - for error tracking)
export NEXT_PUBLIC_SENTRY_DSN="https://key@ingest.sentry.io/projectId"
```

### Save to .env.local

```bash
# .env.local
BASE_URL=http://localhost:3000
AUTH_TOKEN=Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
TEST_USER_ID=550e8400-e29b-41d4-a716-446655440000
ORGANIZATION_ID=660e8400-e29b-41d4-a716-446655440000

# For generating credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# For Sentry error tracking
NEXT_PUBLIC_SENTRY_DSN=https://key@ingest.sentry.io/projectId
SENTRY_ENABLED=true
SENTRY_ENVIRONMENT=development
SENTRY_TRACE_SAMPLE_RATE=1.0
```

## Interpreting Results

### Load Test Success Criteria

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| **P95 Latency** | < 500ms | 500-800ms | > 800ms |
| **P99 Latency** | < 1000ms | 1-2s | > 2s |
| **Error Rate** | < 0.1% | 0.1-1% | > 1% |
| **Success Rate** | > 99.9% | 99-99.9% | < 99% |
| **CPU Usage** | < 50% | 50-75% | > 75% |
| **Memory** | < 50% | 50-75% | > 75% |

### Example: Good Results

```
Load Test Results
====================
Tests Run:     1,500
Passed:        1,499
Failed:        1
Success Rate:  99.93% ✓

Latency (response time)
p50:  120ms
p95:  450ms ✓
p99:  850ms ✓

Throughput:    300 req/sec ✓
Error Rate:    0.07% ✓
```

### Example: Needs Investigation

```
Load Test Results
====================
Tests Run:     1,500
Passed:        1,485
Failed:        15
Success Rate:  99.0% ⚠

Latency (response time)
p50:  200ms
p95:  1200ms ⚠ (exceeds 500ms SLA)
p99:  2500ms ✗ (exceeds 1000ms SLA)

Throughput:    250 req/sec ✓
Error Rate:    1.0% ⚠ (exceeds 0.1% SLA)
```

**Next Step:** Review LOAD_TEST_SETUP.md troubleshooting section

## File Locations

### Documentation
- `docs/LOAD_TEST_SETUP.md` - Comprehensive load testing guide
- `docs/SECURITY_ENDPOINTS_CHECKLIST.md` - Pending endpoint specifications
- `docs/SENTRY_SETUP.md` - Error tracking setup
- `docs/BLOCKERS_RESOLUTION_SUMMARY.md` - Overview of all fixes
- `docs/TESTING.md` - General testing strategy
- `docs/API_ENDPOINTS.md` - API reference

### Test Automation
- `testing/run-load-tests.sh` - Load test runner
- `testing/1-load-testing.yaml` - K6 configuration
- `testing/2-security-testing.sh` - Security test suite
- `scripts/generate-test-users.js` - Create test users
- `scripts/generate-test-tokens.js` - Generate JWT tokens
- `scripts/test-credentials.sh` - Verify credentials

### Results
- `testing/results/` - Test results and logs
- `test-tokens.json` - Generated tokens (keep secure!)
- `test-users-credentials.json` - User credentials (keep secure!)

## Troubleshooting

### "401 Unauthorized"
```bash
# Token expired? Regenerate:
node scripts/generate-test-tokens.js

# Token invalid? Verify it exists:
echo $AUTH_TOKEN

# Wrong BASE_URL? Check:
echo $BASE_URL
```

### "404 Not Found"
```bash
# Service not running? Start dev server:
npm run dev

# Wrong endpoint? Check:
curl http://localhost:3000/api/health

# Endpoint not implemented yet? See:
# docs/SECURITY_ENDPOINTS_CHECKLIST.md
```

### "429 Too Many Requests"
```bash
# Rate limited? Reduce VU count:
./testing/run-load-tests.sh -s baseline  # Uses 10 VUs

# Or wait for rate limit window to reset:
# Usually 1 minute for development
sleep 60
```

### "Connection refused"
```bash
# Service not running:
npm run dev

# Wrong BASE_URL:
export BASE_URL="http://localhost:3000"

# Firewall blocking? Try:
curl -v http://localhost:3000/api/health
```

## Weekly Checklist

- [ ] Monday morning: Run baseline test
- [ ] Review results in testing/results/
- [ ] Check for performance regressions
- [ ] Update test tokens if > 1 week old
- [ ] Review Sentry dashboard for errors
- [ ] Document any issues found

## Before Production Deployment

- [ ] Implement missing GDPR endpoints (docs/SECURITY_ENDPOINTS_CHECKLIST.md)
- [ ] Run full security test suite: `./testing/2-security-testing.sh`
- [ ] Run stress test: `./testing/run-load-tests.sh -s stress`
- [ ] Verify Sentry configured: `curl http://localhost:3000/api/test-sentry`
- [ ] All tests pass with ✓ (no failures or critical warnings)
- [ ] Document results in testing/results/
- [ ] Notify ops team of any critical findings

## Performance Targets

### Email Notifications
- Delivery latency (p95): < 2 minutes
- Success rate: > 99.5%
- Bounce rate: < 0.5%

### API Endpoints
- Response time (p95): < 500ms
- Error rate: < 0.1%
- Availability: > 99.9%

### Database
- Connection pool utilization: < 90%
- Query latency (p95): < 100ms
- Lock wait time: < 10ms

## Getting Help

1. **Load Testing Issues** → Read `docs/LOAD_TEST_SETUP.md`
2. **Missing Endpoints** → Read `docs/SECURITY_ENDPOINTS_CHECKLIST.md`
3. **Error Tracking** → Read `docs/SENTRY_SETUP.md`
4. **Overall Context** → Read `docs/BLOCKERS_RESOLUTION_SUMMARY.md`
5. **General Testing** → Read `docs/TESTING.md`

## Key Contacts

- **Load Testing:** ops-team@taskflow.app
- **Security Testing:** security-team@taskflow.app
- **Error Tracking:** devops-team@taskflow.app
- **General Questions:** engineering-team@taskflow.app

---

**Last Updated:** 2026-08-18  
**Next Review:** 2026-09-15  
**Status:** READY FOR USE
