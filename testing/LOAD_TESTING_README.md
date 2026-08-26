# TaskFlow Notification System - Load Testing Guide

## Overview

This directory contains production-ready load testing infrastructure for the TaskFlow Notification System using K6, an open-source load testing tool designed for DevOps and developers.

**Key Files:**
- `1-load-testing.yaml` - Complete test scenario configuration and SLA definitions
- `load-test.js` - K6 JavaScript implementation with all test scenarios
- `LOAD_TESTING_README.md` - This guide

## Quick Start

### 1. Install K6

**macOS (Homebrew):**
```bash
brew install k6
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install k6
```

**Windows (Chocolatey):**
```bash
choco install k6
```

**Or download from:** https://k6.io/docs/getting-started/installation/

### 2. Set Environment Variables

```bash
# Required
export BASE_URL="http://localhost:3000"  # or https://staging.taskflow.app
export AUTH_TOKEN="Bearer YOUR_JWT_TOKEN"
export TEST_USER_ID="550e8400-e29b-41d4-a716-446655440000"
export ORGANIZATION_ID="660e8400-e29b-41d4-a716-446655440000"

# Optional (for monitoring)
export INFLUXDB_ADDR="http://localhost:8086"
export INFLUXDB_USER="admin"
export INFLUXDB_PASSWORD="password"
```

### 3. Run a Test

```bash
# Run baseline test (5 min, 10 VUs)
k6 run load-test.js

# Run with specific scenario
k6 run --stage baseline load-test.js
k6 run --stage ramp_up load-test.js
k6 run --stage spike load-test.js
k6 run --stage stress load-test.js
k6 run --stage endurance load-test.js
k6 run --stage email_delivery load-test.js
```

## Test Scenarios

### 1. Baseline Test (5 minutes)
**Purpose:** Establish performance baseline under normal conditions

**Load Profile:**
- 10 virtual users (VUs)
- 30 second ramp-up
- 5 minute sustained load
- 30 second ramp-down

**What's tested:**
- Health check endpoint
- Get notification preferences
- Get users list

**Success Criteria:**
- p95 latency < 500ms
- p99 latency < 1s
- Error rate < 0.1%
- Success rate > 99.9%

**Run:**
```bash
k6 run load-test.js --stage baseline
```

### 2. Ramp-up Test (15 minutes)
**Purpose:** Test system behavior under gradually increasing load

**Load Profile:**
- Ramp up from 10 to 100 VUs over 5 minutes
- Hold at 100 VUs for 5 minutes
- Ramp down over 5 minutes

**What's tested:**
- All API endpoints
- Database connection pooling
- Resource scaling

**Success Criteria:**
- p95 latency < 600ms
- p99 latency < 1.2s
- Error rate < 0.2%
- Sustained throughput

**Run:**
```bash
k6 run load-test.js --stage ramp_up
```

### 3. Spike Test (10 minutes)
**Purpose:** Test system recovery from sudden traffic spikes

**Load Profile:**
- 2 min at 10 VUs (baseline)
- 2 min spike to 500 VUs
- 2 min back to 10 VUs
- 4 min recovery monitoring

**What's tested:**
- Error handling under spike
- Resource cleanup
- Recovery time

**Success Criteria:**
- Max latency < 2s
- Error rate < 1% during spike
- Recovery to baseline within 2 minutes

**Run:**
```bash
k6 run load-test.js --stage spike
```

### 4. Stress Test (20 minutes)
**Purpose:** Find system breaking point through incremental load increase

**Load Profile:**
- Incrementally increase load: 50 → 100 → 200 → ... → 900 VUs
- 2 minutes at each level
- Stop when significant degradation detected

**What's tested:**
- System limits
- Graceful degradation
- Error patterns at breaking point

**Success Criteria:**
- Identify breaking point
- CPU usage pattern
- Memory usage pattern
- Connection pool saturation

**Run:**
```bash
k6 run load-test.js --stage stress
```

### 5. Endurance Test (60 minutes)
**Purpose:** Detect memory leaks and resource exhaustion under sustained load

**Load Profile:**
- 5 min ramp-up
- 50 min sustained at 50 VUs
- 5 min ramp-down

**What's tested:**
- Memory leak detection
- Garbage collection behavior
- Connection pool stability
- Long-running process stability

**Success Criteria:**
- p95 latency stable throughout
- No memory growth > 10% per hour
- Connection count stable
- Error rate consistent

**Run:**
```bash
k6 run load-test.js --stage endurance
```

### 6. Email Delivery Test (30 minutes)
**Purpose:** Test email notification delivery under high concurrency

**Load Profile:**
- 5 min ramp-up (50 VUs)
- 20 min sustained (100 VUs)
- 5 min ramp-down

**What's tested:**
- Email queue processing
- Concurrent email sends
- Delivery latency
- Queue depth management

**Success Criteria:**
- Delivery latency p95 < 2 minutes
- Queue depth < 100 jobs
- Delivery success rate > 99.5%
- Bounce rate < 0.5%

**Run:**
```bash
k6 run load-test.js --stage email_delivery
```

## Advanced Usage

### Custom Load Profile

Run test with specific VU count and duration:
```bash
k6 run --vus 50 --duration 10m load-test.js
```

### Export Results to Different Formats

**CSV Output:**
```bash
k6 run --out csv=results.csv load-test.js
```

**JSON Output:**
```bash
k6 run --out json=results.json load-test.js
```

**HTML Report:**
```bash
k6 run --out html=report.html load-test.js
```

### Prometheus/Grafana Integration

**InfluxDB Push:**
```bash
k6 run \
  -o experimental-prometheus-rw \
  --tag testid=baseline_001 \
  --tag environment=staging \
  load-test.js
```

### Run with Tags for Filtering

```bash
k6 run \
  --tag testtype=baseline \
  --tag environment=staging \
  --tag version=1.0 \
  load-test.js
```

### Verbose Output for Debugging

```bash
k6 run -v load-test.js
```

## Interpreting Results

### Key Metrics Explained

**Response Time (Latency)**
```
p50:  50% of requests faster than this
p95:  95% of requests faster than this (important SLA)
p99:  99% of requests faster than this (tail latency)
max:  Slowest request observed
```

**Evaluation:**
- ✅ Good: p95 < 500ms, p99 < 1s
- ⚠️ Warning: p95 500-800ms, p99 1-2s
- ❌ Critical: p95 > 800ms, p99 > 2s

**Error Rate**
- ✅ Good: < 0.1%
- ⚠️ Warning: 0.1-1%
- ❌ Critical: > 1%

**Success Rate**
- ✅ Good: > 99.9%
- ⚠️ Warning: 99-99.9%
- ❌ Critical: < 99%

**Resource Usage**

CPU:
- ✅ Good: < 50%
- ⚠️ Warning: 50-75%
- ❌ Critical: > 75%

Memory:
- ✅ Good: < 50% of available
- ⚠️ Warning: 50-75% of available
- ❌ Critical: > 75% of available

Database Connections:
- ✅ Good: < 50% of pool
- ⚠️ Warning: 50-75% of pool
- ❌ Critical: > 75% of pool

### Sample Output

```
     data_received..............: 1.2 MB  4.1 kB/s
     data_sent..................: 346 kB  1.2 kB/s
     http_req_blocked...........: avg=1.23ms    min=100µs    med=500µs    max=34ms     p(90)=2ms     p(95)=3ms
     http_req_connecting........: avg=0µs       min=0s       med=0s       max=0s       p(90)=0s      p(95)=0s
     http_req_duration..........: avg=305.23ms  min=100ms    med=250ms    max=2.1s     p(90)=500ms   p(95)=750ms
       { staticAsset:yes }......: avg=150ms     min=100ms    med=150ms    max=500ms    p(90)=200ms   p(95)=250ms
     http_req_failed............: 0.15%   ✓
     http_req_receiving.........: avg=10.5ms    min=100µs    med=2ms      max=500ms    p(90)=20ms    p(95)=50ms
     http_req_sending...........: avg=2.34ms    min=100µs    med=1ms      max=50ms     p(90)=5ms     p(95)=10ms
     http_req_tls_handshaking...: avg=0s        min=0s       med=0s       max=0s       p(90)=0s      p(95)=0s
     http_req_waiting...........: avg=292.39ms  min=100ms    med=240ms    max=2s       p(90)=480ms   p(95)=720ms
     http_reqs..................: 1200    4.08/s
     iteration_duration.........: avg=1.30s     min=1.10s    med=1.25s    max=3.15s    p(90)=1.50s   p(95)=1.75s
     iterations.................: 1200    4.08/s
     vus........................: 10      min=10      max=10
     vus_max....................: 10      min=10      max=10
```

## Troubleshooting

### Issue: 401 Unauthorized Errors

**Cause:** Invalid or expired authentication token

**Solution:**
```bash
# Get a valid JWT token from your auth system
export AUTH_TOKEN="Bearer <new_valid_token>"
k6 run load-test.js
```

### Issue: Connection Refused

**Cause:** Service not running or wrong BASE_URL

**Solution:**
```bash
# Verify service is running
curl http://localhost:3000/api/health

# Update BASE_URL if needed
export BASE_URL="https://staging.taskflow.app"
k6 run load-test.js
```

### Issue: High Error Rates

**Diagnosis:**
```bash
# Run with verbose logging
k6 run -v load-test.js

# Check service logs
tail -f /path/to/service.log

# Monitor system resources
top
```

**Common Causes:**
- Database connection pool exhausted
- Missing indexes on queries
- Memory leaks in application
- External service timeout

### Issue: Memory Leak Suspected

**Verify with Endurance Test:**
```bash
# Run 60-minute test with lower concurrency
k6 run --stage endurance load-test.js

# Monitor memory growth in dashboard
# If memory grows > 10% per hour = likely leak
```

### Issue: Test Runs Slow or Times Out

**Optimize:**
```bash
# Reduce batch size
k6 run --batch 5 load-test.js

# Increase timeout
export TIMEOUT="30s"
k6 run load-test.js

# Run from same region as service
# Reduce VU count for initial test
k6 run --vus 5 --duration 1m load-test.js
```

## Performance Benchmarks

### Expected Baselines

**Typical API Response Times** (single instance):
```
GET /api/health:                          50-100ms
GET /api/admin/notification-preferences:  200-400ms
PATCH /api/admin/notification-preferences: 300-500ms
GET /api/admin/users:                     200-400ms
```

**Typical Throughput** (single instance):
```
At 50 VUs:   ~50 requests/second
At 100 VUs:  ~100 requests/second
At 200 VUs:  ~150-180 requests/second (saturation point)
```

## Capacity Planning

### Step-by-Step Process

1. **Run Stress Test**
   ```bash
   k6 run --stage stress load-test.js
   ```

2. **Identify Breaking Point** (where error rate jumps)
   - Example: Breaking point at 600 VUs = ~600 RPS

3. **Calculate Sustainable Load** (60-70% of breaking point)
   - Example: 600 × 0.65 = 390 RPS

4. **Factor in Peak Multiplier** (typically 2-3x normal)
   - Example: 390 × 2.5 = 975 RPS peak

5. **Plan Infrastructure** (2x peak capacity)
   - Example: Provision for 2000 RPS capacity

### Infrastructure Sizing Example

```
Test Results:
  - Breaking point: 600 RPS
  - Sustainable: 390 RPS
  - Expected peak: 975 RPS
  - Target capacity: 2000 RPS

Current Setup:
  - 2 application servers @ 300 RPS each = 600 RPS total
  - Database connection pool: 100 connections

Recommended:
  - 4-6 application servers = 1200-1800 RPS capacity
  - Database connection pool: 200 connections
  - Load balancer with health checks
  - Database read replicas for reporting
```

## Monitoring & Dashboards

### Integration with Grafana

1. **Configure InfluxDB datasource**
2. **Import K6 dashboard** (grafana.com/dashboards/2587)
3. **Add custom panels:**
   - P95 latency trend
   - Error rate trend
   - Throughput (RPS) trend
   - Resource usage graphs

### Metrics to Monitor Continuously

```
Real-time Alerts:
- Error rate > 0.5%
- P95 latency > 1000ms
- CPU > 80%
- Memory > 80%
- Database connections > 90 in pool

Long-term Trends:
- Response time regression
- Error rate increase
- Memory growth (leak detection)
- Database query slowdown
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Load Tests

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:

jobs:
  load_test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup K6
        run: |
          sudo apt-get update
          sudo apt-get install -y k6
      
      - name: Run Load Tests
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
          AUTH_TOKEN: ${{ secrets.TEST_AUTH_TOKEN }}
          TEST_USER_ID: ${{ secrets.TEST_USER_ID }}
          ORGANIZATION_ID: ${{ secrets.TEST_ORG_ID }}
        run: |
          k6 run testing/load-test.js --out csv=results.csv
      
      - name: Upload Results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: load-test-results
          path: results.csv
      
      - name: Check Thresholds
        run: |
          if grep -q "p(95) < 500" results.csv; then
            echo "✅ Performance within SLA"
          else
            echo "❌ Performance regression detected"
            exit 1
          fi
```

### GitLab CI

```yaml
load_test:
  stage: performance
  image: grafana/k6:latest
  script:
    - k6 run testing/load-test.js --out json=results.json
  artifacts:
    paths:
      - results.json
  only:
    - schedules
```

## Best Practices

### Before Running Tests

1. ✅ Notify ops team
2. ✅ Check service health
3. ✅ Verify test credentials
4. ✅ Backup database
5. ✅ Ensure adequate resources

### During Tests

1. ✅ Monitor application logs
2. ✅ Watch system resources (CPU, memory, connections)
3. ✅ Don't kill test early (need complete data)
4. ✅ Note any anomalies

### After Tests

1. ✅ Analyze results thoroughly
2. ✅ Check for regressions
3. ✅ Document findings
4. ✅ Create issues for improvements
5. ✅ Archive results

## Documentation References

- **K6 Official Docs:** https://k6.io/docs/
- **Best Practices:** https://k6.io/docs/testing-guides/running-large-tests/
- **Performance SLAs:** See `1-load-testing.yaml` Section 4
- **Metrics Guide:** See `1-load-testing.yaml` Section 3

## Support & Questions

**For K6 Issues:**
- K6 Discord Community: https://community.grafana.com/
- K6 GitHub Issues: https://github.com/grafana/k6/issues

**For TaskFlow Issues:**
- File an issue in the project repository
- Include test configuration and results

---

**Last Updated:** August 18, 2026
**Maintained By:** TaskFlow DevOps Team
**Version:** 1.0.0
