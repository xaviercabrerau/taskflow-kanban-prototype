# TaskFlow Testing Infrastructure - Complete Summary

## Overview

This directory contains **production-ready testing infrastructure** for the TaskFlow Notification System, including load testing, security testing, and integration testing capabilities.

**Status:** ✅ Complete and production-ready
**Version:** 1.0.0
**Last Updated:** August 18, 2026

---

## 📋 Files in This Directory

### Load Testing Infrastructure

| File | Purpose | Status |
|------|---------|--------|
| `1-load-testing.yaml` | Complete K6 test configuration (6 scenarios, SLAs, metrics) | ✅ Ready |
| `load-test.js` | K6 JavaScript implementation with all test scenarios | ✅ Ready |
| `run-load-tests.sh` | Convenience shell script for running tests | ✅ Ready |
| `LOAD_TESTING_README.md` | Comprehensive guide for load testing | ✅ Ready |

### Supporting Test Files

| File | Purpose | Status |
|------|---------|--------|
| `2-security-testing.sh` | Security and penetration testing script | ✅ Ready |
| `SECURITY-TESTING-README.md` | Security testing guide | ✅ Ready |

---

## 🚀 Quick Start

### 1. Install K6

```bash
# macOS
brew install k6

# Linux (Ubuntu/Debian)
sudo apt-get install k6

# Windows
choco install k6
```

### 2. Set Environment Variables

```bash
export BASE_URL="http://localhost:3000"
export AUTH_TOKEN="Bearer YOUR_JWT_TOKEN"
export TEST_USER_ID="550e8400-e29b-41d4-a716-446655440000"
export ORGANIZATION_ID="660e8400-e29b-41d4-a716-446655440000"
```

### 3. Run Baseline Test

```bash
# Using the convenience script
./testing/run-load-tests.sh -s baseline

# Or directly with K6
k6 run testing/load-test.js
```

### 4. Check Results

```bash
# View results directory
ls -lah testing/results/

# View detailed report
cat testing/results/report_*.md
```

---

## 📊 Test Scenarios Available

### 1. Baseline Test (5 min)
**What:** Performance baseline under normal conditions
- 10 VUs, 5 minute duration
- Ramp-up/down: 30 seconds each
- Success Criteria: p95 < 500ms, error rate < 0.1%

**Run:**
```bash
./testing/run-load-tests.sh -s baseline
# or
k6 run testing/load-test.js --stage baseline
```

### 2. Ramp-up Test (15 min)
**What:** Behavior under gradually increasing load
- 10 → 100 VUs over 5 minutes
- Sustained at 100 for 5 minutes
- Ramp-down over 5 minutes
- Success Criteria: p95 < 600ms, error rate < 0.2%

**Run:**
```bash
./testing/run-load-tests.sh -s ramp_up
```

### 3. Spike Test (10 min)
**What:** System recovery from sudden traffic spikes
- 2 min baseline (10 VUs)
- 2 min spike (500 VUs)
- 2 min recovery
- 4 min stability monitoring
- Success Criteria: Recovery within 2 minutes, error rate < 1%

**Run:**
```bash
./testing/run-load-tests.sh -s spike
```

### 4. Stress Test (20 min)
**What:** Find system breaking point through incremental load
- Incrementally increase: 50 → 100 → 200 → ... → 900 VUs
- 2 minutes at each level
- Stop when significant degradation detected
- Success Criteria: Identify breaking point, measure graceful degradation

**Run:**
```bash
./testing/run-load-tests.sh -s stress
```

### 5. Endurance Test (60 min)
**What:** Detect memory leaks and resource exhaustion
- 5 min ramp-up to 50 VUs
- 50 min sustained load
- 5 min ramp-down
- Success Criteria: Stable metrics throughout, memory growth < 10%/hour

**Run:**
```bash
./testing/run-load-tests.sh -s endurance
```

### 6. Email Delivery Test (30 min)
**What:** Email notification queue performance under concurrency
- 5 min ramp-up to 50 VUs
- 20 min sustained at 100 VUs
- 5 min ramp-down
- Success Criteria: Delivery latency p95 < 2 min, success rate > 99.5%

**Run:**
```bash
./testing/run-load-tests.sh -s email_delivery
```

---

## 📈 Performance SLAs

### Latency Targets
```
p50 (median):  < 300ms ✓
p95 (SLA):     < 500ms ✓
p99 (tail):    < 1000ms ✓
max:           < 2000ms ✓
```

### Availability Targets
```
Success Rate:  > 99.9% ✓
Error Rate:    < 0.1% ✓
Uptime:        > 99.95% ✓
```

### Queue Performance
```
Max Depth:     < 100 jobs ✓
Processing:    > 10 jobs/sec ✓
Email Delay:   < 2 minutes ✓
```

### Resource Constraints
```
CPU:           < 80% ✓
Memory:        < 2GB (or 50% available) ✓
Connections:   < 100 in pool ✓
```

---

## 🔍 Key Metrics Collected

### Response Time
- p50, p75, p95, p99 latencies
- Maximum latency
- Average latency

### Errors
- Error rate (%)
- Error count by type
- 4xx vs 5xx errors
- Timeout errors

### Throughput
- Requests per second (RPS)
- Bytes sent/received per second

### Resources
- CPU usage (%)
- Memory usage (MB)
- Database connections
- Connection pool utilization

### Queue Metrics
- Queue depth
- Processing rate
- Max depth observed

---

## 🛠️ Advanced Usage

### Run with Custom Load Profile

```bash
# Custom VU count and duration
k6 run --vus 200 --duration 10m testing/load-test.js

# Custom ramp-up/down
k6 run \
  --stage "5m:50" \
  --stage "10m:100" \
  --stage "5m:0" \
  testing/load-test.js
```

### Export Results in Different Formats

```bash
# CSV format
k6 run --out csv=results.csv testing/load-test.js

# JSON format
k6 run --out json=results.json testing/load-test.js

# HTML report
k6 run --out html=report.html testing/load-test.js
```

### With Prometheus/Grafana

```bash
k6 run \
  -o experimental-prometheus-rw \
  --tag testid=baseline_001 \
  --tag environment=staging \
  testing/load-test.js
```

### Verbose Debugging

```bash
k6 run -v testing/load-test.js  # Verbose output
```

### Dry Run (See Command Without Executing)

```bash
./testing/run-load-tests.sh -s stress --dry-run
```

---

## 📊 Understanding Results

### Sample Output

```
     data_received..............: 1.2 MB  4.1 kB/s
     http_req_duration..........: avg=305.23ms  min=100ms  med=250ms  max=2.1s  p(95)=750ms  p(99)=1.2s
     http_req_failed............: 0.15%   ✓
     http_reqs..................: 1200    4.08/s
     iteration_duration.........: avg=1.30s     min=1.10s  med=1.25s  max=3.15s
     vus........................: 10      min=10     max=10
```

### Interpreting Metrics

**✅ Good Performance:**
- p95 latency < 500ms
- p99 latency < 1s
- Error rate < 0.1%
- Success rate > 99.9%

**⚠️ Warning Signs:**
- p95 latency 500-800ms
- Error rate 0.1-1%
- Memory growth > 5% per hour
- Connection pool > 75% utilized

**❌ Critical Issues:**
- p95 latency > 800ms
- Error rate > 1%
- CPU > 80% sustained
- Memory growth > 10% per hour
- Breaking point reached

---

## 🔧 Troubleshooting

### Issue: 401 Unauthorized

```bash
# Get valid authentication token
# Update and re-export
export AUTH_TOKEN="Bearer <new_valid_token>"
./testing/run-load-tests.sh -s baseline
```

### Issue: Connection Refused

```bash
# Verify service is running
curl http://localhost:3000/api/health

# Check/update BASE_URL
export BASE_URL="http://your-service:3000"
./testing/run-load-tests.sh -s baseline
```

### Issue: High Error Rates

```bash
# Run with verbose logging
k6 run -v testing/load-test.js

# Check application logs
tail -f /var/log/your-app.log

# Monitor system resources
top
```

### Issue: Memory Leak Suspected

```bash
# Run 60-minute endurance test
./testing/run-load-tests.sh -s endurance

# Monitor memory usage in results
# Growth > 10% per hour = likely leak
```

---

## 📋 Capacity Planning

### Step-by-Step Process

1. **Run stress test**
   ```bash
   ./testing/run-load-tests.sh -s stress
   ```

2. **Find breaking point** (where error rate increases)
   - Example: Breaking point at 600 VUs = ~600 RPS

3. **Calculate sustainable load** (60-70% of breaking point)
   - Example: 600 × 0.65 = 390 RPS

4. **Factor in peak multiplier** (typically 2-3x normal)
   - Example: 390 × 2.5 = 975 RPS peak

5. **Plan infrastructure** (2x peak capacity)
   - Example: Provision for 2000 RPS capacity

### Example Capacity Plan

```
Test Results:
  Breaking point: 600 RPS
  Sustainable: 390 RPS  
  Expected peak: 975 RPS
  Target capacity: 2000 RPS

Current Setup:
  - 2 app servers @ 300 RPS each = 600 RPS total
  - DB connections: 100

Recommended:
  - 4-6 app servers = 1200-1800 RPS capacity
  - DB connections: 200+
  - Load balancer with health checks
  - Read replicas for reports
```

---

## 🔄 CI/CD Integration

### GitHub Actions

```yaml
name: Load Tests

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:

jobs:
  load_test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup K6
        run: sudo apt-get install -y k6
      - name: Run Load Test
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
          AUTH_TOKEN: ${{ secrets.TEST_TOKEN }}
        run: |
          cd testing
          ./run-load-tests.sh -s baseline
      - name: Upload Results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: load-test-results
          path: testing/results/
```

### GitLab CI

```yaml
load_test:
  stage: performance
  image: grafana/k6:latest
  script:
    - cd testing && ./run-load-tests.sh -s baseline
  artifacts:
    paths:
      - testing/results/
  only:
    - schedules
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| `LOAD_TESTING_README.md` | Complete load testing guide with examples |
| `1-load-testing.yaml` | Test configuration and SLA definitions |
| `load-test.js` | K6 script implementation |
| `SECURITY-TESTING-README.md` | Security testing procedures |

---

## 🎯 Best Practices

### Before Testing
- ✅ Notify ops team
- ✅ Verify test environment is isolated
- ✅ Backup database
- ✅ Check service health
- ✅ Verify authentication tokens are valid

### During Testing
- ✅ Monitor application logs
- ✅ Watch system resources (CPU, memory)
- ✅ Note any anomalies
- ✅ Don't interrupt test early

### After Testing
- ✅ Analyze results thoroughly
- ✅ Compare against SLAs
- ✅ Check for performance regressions
- ✅ Document findings
- ✅ Create issues for improvements
- ✅ Archive results for trends

---

## 🔐 Security Considerations

- Test credentials are **test-only** and isolated
- Tests run against **staging/test environment only**
- Never run against production without explicit approval
- Credentials stored in environment variables, not in code
- Results contain sensitive performance data - secure accordingly

---

## 📞 Support

### K6 Resources
- **Official Docs:** https://k6.io/docs/
- **Best Practices:** https://k6.io/docs/testing-guides/
- **Community:** https://community.grafana.com/

### TaskFlow Resources
- **Issue Tracker:** GitHub Issues
- **Docs:** See LOAD_TESTING_README.md
- **Monitoring:** See OBSERVABILITY.md

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-08-18 | Initial release with 6 test scenarios |

---

## ✅ Checklist for First Use

- [ ] Install K6: `brew install k6` (macOS) or equivalent
- [ ] Set environment variables (BASE_URL, AUTH_TOKEN, etc.)
- [ ] Verify service is running and healthy
- [ ] Run baseline test: `./testing/run-load-tests.sh -s baseline`
- [ ] Review results in `testing/results/` directory
- [ ] Read LOAD_TESTING_README.md for detailed guide
- [ ] Set up CI/CD integration if needed
- [ ] Add to monitoring dashboards (optional)

---

## 🎓 Learning Path

1. **Read:** Start with this file for overview
2. **Learn:** Review LOAD_TESTING_README.md for comprehensive guide
3. **Explore:** Check 1-load-testing.yaml for test configuration
4. **Run:** Execute `./run-load-tests.sh -s baseline`
5. **Analyze:** Review results and compare against SLAs
6. **Advance:** Try other scenarios (spike, stress, endurance)
7. **Integrate:** Add to CI/CD pipeline for continuous testing

---

## 🚀 Next Steps

1. **Immediate:** Run baseline test to establish performance baseline
2. **Short-term:** Run all test scenarios to understand system behavior
3. **Medium-term:** Integrate into CI/CD for continuous performance monitoring
4. **Long-term:** Build dashboards and trends for capacity planning

---

**Production Status:** ✅ Ready for Deployment
**Last Updated:** August 18, 2026
**Maintained By:** TaskFlow DevOps Team
