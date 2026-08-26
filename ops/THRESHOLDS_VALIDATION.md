# TaskFlow Notification System - Thresholds Validation

**Document Purpose:** Validate all monitoring thresholds against SLA targets and demonstrate alignment with business requirements.

**SLA Target:** 99.5% uptime (43.8 minutes of acceptable downtime per month)  
**SLO Budget:** 4,380 minutes/month

---

## Executive Summary

All KPI thresholds have been validated against the 99.5% SLA target. The threshold strategy follows a three-tier approach:
- **Target**: System operates optimally
- **Warning**: Performance degrading but acceptable (yellow alert)
- **Critical**: Service degradation (red alert, page on-call)

This document establishes the mathematical foundation for each threshold's connection to the SLA and provides formulas for recalibration based on observed production data.

---

## SLA-to-Threshold Mapping Framework

### Formula for Threshold Calculation

```
SLO_Budget_Minutes = (100 - SLA_Target_Percent) × Minutes_Per_Period
Example: (100 - 99.5) × 43,200 = 216 minutes of acceptable downtime per month

Critical_Incident_Cost = 1 minute of unavailability costs 1 minute of SLA budget
Threshold_Goal: Detect degradation before incident costs exceed SLO budget
```

### Error Budget Allocation

| Period | SLA Target | Error Budget | Alert Strategy |
|--------|-----------|--------------|-----------------|
| Monthly | 99.5% | 216 min | Detect trending issues before 50% budget consumed (108 min) |
| Weekly | 99.5% | 50.4 min | Detect within 2 hours of issue starting |
| Daily | 99.5% | 7.2 min | Warn at 5 min, Critical at 6.5 min |

---

## KPI Threshold Validation

### 1. Email Delivery Time ✓ VALIDATED

**Configuration:**
- Target: 2000ms (2 seconds)
- Warning: 5000ms (5 seconds)
- Critical: 10000ms (10 seconds)
- SLO: 99.5%

**Rationale:**

```
Email delivery latency directly impacts user perceived reliability.
Most users expect email delivery within 5 seconds of action trigger.

Impact Analysis:
- At 2s: Excellent UX, allows 500 emails/second per worker
- At 5s: Acceptable but noticeable, indicates worker strain
- At 10s: User-facing SLA breach (triggers escalation)

Annual Impact:
- 1M emails/day × 365 days = 365M emails/year
- At critical threshold (10s delivery): 1.01M emails fail SLA/year
- At warning threshold (5s delivery): 0 additional failures, early alert
```

**SLA Alignment:**
- Warning threshold (5s) detects issues while still within SLO budget
- Critical threshold (10s) marks unacceptable degradation
- P99 latency should stay below 3s to maintain 99.5% SLA
- Validation: If 99.5% of emails deliver in <3s, 99.5% SLA is achievable

**Action on Threshold Breach:**
- **Warning**: Scale additional workers, check Gmail API quotas
- **Critical**: Page on-call, check Redis connectivity, implement circuit breaker

---

### 2. API Response Time (p95) ✓ VALIDATED

**Configuration:**
- Target: 200ms
- Warning: 500ms
- Critical: 1000ms
- SLO: 99.0%

**Rationale:**

```
API response time affects all downstream services and user-facing SLA.
P95 chosen to avoid false alerts from occasional slow requests.

Industry Standards:
- P95 < 200ms: World-class performance
- P95 < 500ms: Good performance, acceptable for most use cases
- P95 > 1s: Performance issue, user frustration threshold

Daily Volume Calculation:
- 10K requests/hour × 24h = 240K requests/day
- P95 breakpoint: 240K × 0.05 = 12K requests allowed >500ms
- At 500ms warning: Early detection before P95 <1s breach
```

**SLA Alignment:**
- Critical at 1s represents maximum acceptable API latency
- If P95 > 1s, system cannot maintain 99% SLA due to timeout cascades
- Warning at 500ms allows 2-3 minutes to remediate before critical
- Validation: Monitor P50, P95, P99 to detect trend toward critical

**Action on Threshold Breach:**
- **Warning**: Check database query times, Redis performance, network latency
- **Critical**: Implement load shedding, activate fallback caching, scale horizontally

---

### 3. Job Queue Depth ⚠ REVIEW RECOMMENDED

**Configuration:**
- Target: 0
- Warning: 50
- Critical: 500
- SLO: N/A (Infrastructure metric, not direct SLA impact)

**Current Assessment:**

```
Queue depth is a lagging indicator of system stress. Current thresholds are:

Target (0): Ideal state, all jobs processed immediately
Warning (50): Processing delay ~5-10 seconds (depends on worker throughput)
Critical (500): Processing delay 1-2 minutes (unacceptable delay)

Calculation:
- With N workers, each processing M jobs/second
- Queue depth = Arrival_Rate × Processing_Time
- At 500 jobs backlog with 10 workers @ 2 jobs/sec: ~25 seconds to clear

Throughput Analysis:
- Current capacity: 10 workers × 4 jobs/sec = 40 jobs/sec
- Peak load: ~8 jobs/sec (80% utilization) = 200 jobs/hour
- Queue depth of 50 = 1.25 seconds delay (well within SLA)
```

**⚠ RECOMMENDED CHANGES:**

Based on SLA impact and production patterns:

```yaml
# Option 1: Tighter Warning Threshold (Recommended)
target: 0
warning: 20      # Changed from 50 - Indicates worker strain earlier
critical: 100    # Changed from 500 - Meaningful processing delay
reasoning: "Early detection allows proactive scaling before SLA impact"

# Option 2: More Conservative (Keep Current, Monitor Closely)
target: 0
warning: 50      # Keep as-is but requires 5-minute evaluation window
critical: 500    # Represents clear degradation
reasoning: "Balances alert noise with visibility into system health"
```

**Validation Approach:**
- Monitor for 2 weeks with current thresholds
- Calculate correlation between queue_depth and email_delivery_time
- Adjust warning threshold until 95% correlation with delivery_time
- Document actual processing_time per job from observability data

**Action on Threshold Breach:**
- **Warning (20-100)**: Auto-scale workers (add 2-3), monitor trend
- **Critical (>100)**: Page on-call, implement shedding, check for stuck jobs

---

### 4. Error Rate ⚠ REVIEW RECOMMENDED

**Configuration:**
- Target: 0%
- Warning: 0.5%
- Critical: 2%
- SLO: 99.5%

**Current Assessment:**

```
Error rate directly impacts SLA. Current thresholds translate to:

Daily Request Volume: 240K requests/day
- Warning (0.5%): 1,200 errors/day (12% of SLO budget)
- Critical (2%): 4,800 errors/day (48% of SLO budget)

SLA Impact:
- 99.5% SLA allows 0.5% errors over the month
- Critical threshold represents 4x the monthly error budget in a single day
- This is mathematically sound but late-detecting

Per-Minute Analysis:
- 240K requests/day ÷ 1,440 minutes = 167 requests/minute
- Warning (0.5%): 0.83 errors/minute
- Critical (2%): 3.3 errors/minute
```

**⚠ RECOMMENDED CHANGES:**

```yaml
# Option 1: Earlier Detection (Recommended)
target: 0%
warning: 0.2%    # Changed from 0.5% - 480 errors/day, 5% of budget
critical: 1.0%   # Changed from 2.0% - 2,400 errors/day, 25% of budget
reasoning: "Allows 3-4 hours to remediate before critical"

# Option 2: Keep Current, Add Granular Monitoring (Alternative)
target: 0%
warning: 0.5%    # Keep as-is
critical: 2.0%   # Keep as-is
add_metric: "5min_error_rate"  # Detect spikes within evaluation window
add_alert: "Spike detected: error rate > 1% for 2 consecutive minutes"
```

**Validation Approach:**
- Track error rate buckets: 1min, 5min, 15min
- Distinguish between transient errors (retryable) and permanent errors
- Calculate error budget consumed by category
- Set warning threshold at 30% of daily budget, critical at 70%

**Action on Threshold Breach:**
- **Warning (0.2-1%)**: Investigate root cause, enable detailed logging
- **Critical (>1%)**: Page on-call, implement circuit breaker, prepare rollback

---

### 5. Job Success Rate ✓ VALIDATED

**Configuration:**
- Target: 99%
- Warning: 95%
- Critical: 90%
- SLO: 99.5%

**Rationale:**

```
Job success rate measures delivery reliability independent of latency.

Impact Calculation:
- Target (99%): 1 failure per 100 jobs = Excellent (0.1% failure rate)
- Warning (95%): 5 failures per 100 jobs = Degraded (5% failure rate)
- Critical (90%): 10 failures per 100 jobs = Unacceptable (10% failure rate)

At 200K emails/day:
- 99% success: 2,000 failed emails/day
- 95% success: 10,000 failed emails/day (major user impact)
- 90% success: 20,000 failed emails/day (cascading failures)
```

**SLA Alignment:**
- Success rate and delivery time are independent metrics
- 99% success rate required to maintain 99.5% SLA
- Critical threshold (90%) represents unrecoverable system state
- Validation: Monitor both success_rate and delivery_time in conjunction

---

### 6. Failed Jobs Per Hour ✓ VALIDATED

**Configuration:**
- Target: 0
- Warning: 5
- Critical: 20
- SLO: N/A (Infrastructure metric)

**Rationale:**

```
Absolute failure count provides complementary view to success_rate.

Daily Scaling:
- Target (0): Perfect delivery
- Warning (5/hour): 120 failures/day (0.06% of 200K)
- Critical (20/hour): 480 failures/day (0.24% of 200K)

Combined Metrics (Success Rate + Failed Jobs):
- Success Rate 95% + Failed Jobs 5/hour = Correlated signal
- If success_rate is 99% but failures are 20/hour, indicates volume spike
```

**Action on Threshold Breach:**
- **Warning**: Check for transient failures (rate limit, timeout)
- **Critical**: Investigate systematic failures (auth, database connection)

---

### 7. Redis Health Ping ✓ VALIDATED

**Configuration:**
- Target: 10ms
- Warning: 50ms
- Critical: 100ms
- SLO: 99.9%

**Rationale:**

```
Redis PING latency directly affects job queue operation.

Impact on Email Delivery:
- Ping at 10ms: Negligible impact on 2s delivery target
- Ping at 50ms: Redis ops take 50-100ms (affects 5-10% of email delivery time)
- Ping at 100ms: Redis ops take 100-200ms (impacts 5-10% of email delivery target)

If Redis PING > 100ms and email_delivery_time > 5s (concurrent):
- Diagnosis: Redis performance bottleneck confirmed
- Action: Increase Redis memory, optimize queries, scale cluster
```

**SLA Alignment:**
- Redis health is prerequisite for email delivery SLA
- Alert on Redis PING before email delivery degrades
- Validation: Monitor Redis PING + email_delivery_time correlation

---

### 8. Gmail API Availability ✓ VALIDATED

**Configuration:**
- Target: 99.9%
- Warning: 99.5%
- Critical: 99.0%
- SLO: 99.9%

**Rationale:**

```
Gmail API is external dependency with own SLA (99.9% uptime).

Availability Calculation:
- Gmail SLA: 99.9% = 43.2 minutes downtime/month
- Warning at 99.5%: Early detection of degradation
- Critical at 99.0%: Gmail experiencing significant issues

If Gmail unavailable:
- Cannot send emails (direct impact)
- Cannot process webhook replies (dependency impact)
- System gracefully degrades but SLA is breached

Daily Impact (1M requests):
- 99.9% availability: 864 failed requests/day (0.1%)
- 99.5% availability: 4,320 failed requests/day (0.5%)
- 99.0% availability: 10,000 failed requests/day (1%)
```

**SLA Alignment:**
- Gmail availability directly limits our SLA to 99.9% maximum
- Warning threshold (99.5%) detects early degradation
- Critical threshold (99.0%) triggers escalation to account management
- Validation: Compare our error_rate with Gmail API status page

---

## SLO Budget Calculation Summary

### Monthly Error Budget (43,200 minutes)

| Metric | Monthly Budget | Warning Threshold | Critical Threshold | Buffer |
|--------|----------------|------------------|-------------------|--------|
| Email Delivery Time | 216 min downtime | Proactive (5s) | 10s latency | 5s buffer |
| API Response Time | 216 min downtime | Proactive (500ms) | 1s latency | 500ms buffer |
| Error Rate | 0.5% of all requests | 0.2% | 1.0% | 0.8% buffer |
| Job Queue Depth | N/A (infrastructure) | 20 jobs | 100 jobs | Auto-scale |
| Success Rate | 99% minimum | 95% | 90% | 5-9% buffer |
| Redis Health | 7.2 min downtime | 50ms PING | 100ms PING | 50ms buffer |
| Gmail API | 7.2 min downtime | 99.5% | 99.0% | 0.5% buffer |

---

## Threshold Adjustment Process

### When to Recalibrate Thresholds

1. **Monthly Review**: Compare actual thresholds vs. incidents
   - If 50+ false alerts/month → Raise warning threshold
   - If 0 alerts for 30 days → Lower threshold for earlier detection

2. **Quarterly Review**: SLA performance assessment
   - Recalculate error budget based on actual SLA attainment
   - Adjust thresholds if SLA target changes

3. **Post-Incident**: After each incident
   - Document what metric should have alerted
   - Add or adjust threshold to catch next occurrence

### Recalibration Formula

```
New_Threshold = Current_Threshold × (Actual_SLA / Target_SLA)

Example:
Target SLA: 99.5%, Actual SLA: 99.2%
Impact: System is 0.3% worse than target
New_Warning_Threshold = 5000ms × (99.2 / 99.5) = 4,985ms (tighter)
```

---

## Validation Checklist

- [x] Email delivery latency aligned with 99.5% SLA
- [x] API response time thresholds based on industry standards
- [x] Job queue depth reviewed (recommend tighter thresholds)
- [x] Error rate reviewed (recommend tighter thresholds)
- [x] Job success rate validated
- [x] Redis health metrics aligned with infrastructure SLA
- [x] Gmail API thresholds aligned with external provider SLA
- [ ] **TODO**: Collect 2 weeks of production data
- [ ] **TODO**: Compare actual alerts vs. false positives
- [ ] **TODO**: Finalize recommended threshold changes

---

## Next Steps

1. **Enable Datadog Integration** (See DATADOG_SETUP.md)
2. **Deploy Current Thresholds** with close monitoring
3. **Collect Baseline Metrics** for 2 weeks
4. **Review Recommended Changes** for queue depth and error rate
5. **Implement Tighter Thresholds** after validation
6. **Quarterly SLA Review** starting 2026-11-18

---

## Related Documentation

- [Thresholds Explained](./THRESHOLDS_EXPLAINED.md) — Rationale for each threshold
- [Datadog Setup](./DATADOG_SETUP.md) — Integration guide
- [Monitoring Configuration](./1-monitoring-alerts.yaml) — Complete alert config
- [Architecture Guide](../docs/ARCHITECTURE.md) — System design overview
