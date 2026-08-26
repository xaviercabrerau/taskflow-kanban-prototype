# TaskFlow Notification System - Thresholds Explained

This document explains the business and technical rationale behind each monitoring threshold, why the values were chosen, and what happens when thresholds are exceeded.

---

## 1. Email Delivery Time (Target: 2s, Warning: 5s, Critical: 10s)

### Why This Metric Matters

Email delivery latency is the most direct measure of system performance from a user perspective. When a user triggers an action that sends an email (order confirmation, password reset, notification), they expect the email to arrive within seconds.

### Why These Values

**Target: 2 seconds**
- User expectation threshold: Most users consider anything under 2s as "instant"
- Worker processing time: Single worker can process email in 100-500ms
- Network latency: Gmail API round-trip = 500-800ms
- Total: Process + Network + Queue = ~1.5-1.8s under normal conditions
- Buffer to 2s = 200-500ms headroom for system variability

**Warning: 5 seconds**
- Acceptable degradation: User starts noticing delay but doesn't perceive system failure
- Indicates worker strain: Suggests queue is backing up or network is slow
- Recovery window: 1-2 minutes at this threshold to auto-scale workers
- SLA implication: Not yet breaching SLA if affecting <0.5% of emails

**Critical: 10 seconds**
- User-facing SLA breach: Any email taking 10+ seconds is unacceptable
- System degradation: Indicates cascading failures (Redis slow, workers stuck, Gmail throttled)
- Immediate action required: Auto-scale workers, investigate blocking processes
- Monthly impact: >1M emails failing to meet delivery target

### Impact When Exceeded

| Threshold | What's Happening | User Impact | Recommended Action |
|-----------|------------------|-------------|-------------------|
| Normal (2s) | System healthy | Emails arrive instantly | Monitor trends |
| Warning (5s) | Worker strain, queue building | Emails feel slow, user anxiety | Investigate, scale workers |
| Critical (10s) | Major system issue | SLA is breaching, customer support calls incoming | Page on-call, implement circuit breaker |

### Tuning Guidance

- **If warning fires 10+ times/day**: Lower warning threshold to 3s
- **If warning never fires**: Raise to 7s (but keep critical at 10s)
- **If critical fires 2+ times/month**: Root cause analysis needed, not threshold issue

---

## 2. API Response Time - p95 (Target: 200ms, Warning: 500ms, Critical: 1s)

### Why This Metric Matters

API response time affects all downstream services and determines whether the notification system can keep up with request volume. We monitor p95 (95th percentile) rather than average to avoid being misled by occasional slow requests.

### Why p95 Instead of Average

- **Average** is misleading: 1 very slow request can skew average, but 95% of users get fast service
- **p95** shows typical user experience: "95% of users experience this latency or better"
- **p99** available for deeper analysis: Catches outliers and systematic issues

### Why These Values

**Target: 200ms**
- Industry standard: Netflix, Google, Amazon all target <200ms for similar services
- User perception: <200ms feels "instant" to human perception
- SLA requirement: Allows cascading timeouts in dependent services
  - If our API is 200ms + downstream service 200ms = 400ms total
  - If our API is 200ms + database 100ms = 300ms total
- Achievable: With proper indexing, caching, connection pooling

**Warning: 500ms**
- Degradation signal: Something is slower but not critical
- Common causes: Database query slow, Redis responding slowly, network jitter
- Recovery window: 1-2 minutes to identify and fix root cause
- SLA impact: If affecting <0.5% of requests, still within SLA

**Critical: 1 second**
- Unacceptable performance: User-facing timeout thresholds typically 5-10 seconds
- If our API is 1s + database 1s + network = 2-3 seconds total
- Cascading failure risk: Dependent services timeout, cascading effect
- Immediate action: Implement load shedding, activate fallback caching

### Impact When Exceeded

| Threshold | Database Performance | Cache Hit Rate | Network | User Experience | Action |
|-----------|-------------------|-----------------|---------|-----------------|--------|
| 200ms | Index hit, <1ms | 95%+ | <50ms latency | Instant | Maintain |
| 500ms | 50-100ms query | 80% hit rate | 100-150ms latency | Perceptible delay | Investigate |
| 1000ms | 200-400ms query | 50% hit rate | 200+ ms latency | Noticeable slowness | Page on-call |

### Tuning Guidance

- **If p95 consistently 150ms**: Lower warning to 400ms for earlier detection
- **If p95 consistently 900ms**: Investigate root cause (caching, query, connection pool)
- **If critical fires weekly**: Database scaling or query optimization needed
- **If critical never fires but warning is 50% of day**: Raise warning threshold

---

## 3. Job Queue Depth (Target: 0, Warning: 50, Critical: 500)

### Why This Metric Matters

Queue depth is an indirect measure of system health. It shows how many jobs are waiting to be processed and indicates whether workers can keep up with incoming demand.

### Why These Values

**Target: 0**
- Ideal state: All jobs are processed immediately after being enqueued
- Practically achievable: During normal business hours
- Peak times: May temporarily spike to 10-20 but recovers within seconds

**Warning: 50**
- Early detection: Indicates workers are struggling to keep up
- Processing delay: ~5-10 seconds (depends on job complexity)
- Automatic action: Triggers auto-scaling to add 2-3 workers
- Recovery time: Usually recovers within 2-3 minutes with additional workers

**Critical: 500**
- Major system issue: Represents 1-2 minutes of processing delay
- Indicates: Multiple workers stuck, job processing stalled, or spike in traffic
- Automatic action: Triggers aggressive scaling + investigation
- Manual action: Check for stuck workers, consider graceful shutdown + restart

### Why Not Lower?

We don't set warning at 20 (too noisy) because:
- Normal variance creates temporary queue depth of 10-30
- False alerts create alarm fatigue for on-call engineers
- System recovers from 50-100 queue depth automatically within 1-2 minutes
- But we recommend monitoring and may adjust based on production data

### Impact When Exceeded

| Queue Depth | Typical Cause | User Impact | Action |
|------------|---------------|-------------|--------|
| 0-20 | Normal operation | None | Monitor |
| 20-50 | Traffic spike | Slight delay (5-10s) | Auto-scale |
| 50-200 | Worker issue or sustained spike | Noticeable delay (30-60s) | Investigate |
| 200-500 | Multiple failures | Major delays (1-2 min) | Page on-call |
| 500+ | System degradation | Unacceptable delay (>2 min) | Emergency response |

### Tuning Guidance

- **If warning fires 5+ times/day**: Consider lowering warning to 30 after 2 weeks of data
- **If warning never fires**: Raise to 75
- **If critical fires with <50 queue depth**: Indicates job processing is stuck (not a queue issue)

---

## 4. Error Rate (Target: 0%, Warning: 0.5%, Critical: 2%)

### Why This Metric Matters

Error rate measures the percentage of API requests that fail (return 5xx errors). It directly impacts SLA and customer satisfaction.

### Why These Values

**Target: 0%**
- Ideal state: All requests succeed
- Practically: Impossible to achieve 100%, but aim for <0.1%
- Monthly: 0.5% error rate = 1,440 error requests per 1M requests

**Warning: 0.5%**
- Acceptable degradation: Represents maximum allowed error rate for SLA
- Impact: 0.5% of 100K requests/day = 500 error requests
- Recovery window: 2-3 minutes to investigate and fix
- Recommendation: Investigate cause, it's consuming SLA budget

**Critical: 2%**
- Severe system issue: Represents 4x the acceptable error rate
- Impact: 2,000 error requests in 100K request day
- SLA consequence: Impossible to maintain SLA if sustained for >5 minutes
- Immediate action: Page on-call, prepare for escalation

### Why These Thresholds Are Conservative

Current thresholds may be too conservative (late-detecting). Consider:
- 0.5% warning = alerts only after consuming 100% of daily error budget
- Better approach: 0.2% warning = alerts at 40% of budget, time to fix
- Recommendation: Monitor for 2 weeks, then adjust if too many false alerts

### Impact When Exceeded

| Error Rate | Requests/Hour | Failures/Hour | SLA Impact | Action |
|-----------|--------------|---------------|-----------|--------|
| <0.1% | 10K | <10 | Minimal | Monitor |
| 0.5% | 10K | 50 | Consuming budget | Investigate |
| 1.0% | 10K | 100 | Major issue | Page on-call |
| 2.0% | 10K | 200 | SLA breach | Emergency |

### Common Causes

- **Database connection pool exhausted**: Add connections or increase timeout
- **Redis unavailable**: Check Redis health, failover if needed
- **Gmail API throttling**: Check rate limits, implement backoff
- **Cascading failure**: One service down causing upstream failures
- **Code deployment issue**: Check recent changes, consider rollback

### Tuning Guidance

- **If warning fires 1-2 times/day**: Raise to 0.7% (high alert fatigue)
- **If warning never fires**: Lower to 0.3% (earlier detection)
- **If critical fires more than weekly**: Requires root cause analysis, not threshold adjustment
- **If both warning and critical fire**: System has cascading failures

---

## 5. Job Success Rate (Target: 99%, Warning: 95%, Critical: 90%)

### Why This Metric Matters

Job success rate measures what percentage of email jobs actually deliver successfully. Unlike error_rate (API level), this measures delivery reliability at the job level.

### Why These Values

**Target: 99%**
- Industry standard: 99% is standard for reliability-critical systems
- Impact: 1 failure per 100 jobs = 2K failures per 200K emails/day
- Practical: Achievable through retries and proper error handling

**Warning: 95%**
- Degradation signal: 5 failures per 100 jobs
- Impact: 10K failures per 200K emails/day
- User impact: Noticeable delivery failures, support tickets likely
- Action: Investigate delivery pipeline, check Gmail API

**Critical: 90%**
- System failure: 10 failures per 100 jobs
- Impact: 20K failures per 200K emails/day (10% of volume failing)
- User experience: Widespread delivery failures, major incident
- Action: Page on-call immediately, prepare customer communication

### Difference from Error Rate

- **error_rate** = API request failures (5xx responses)
- **job_success_rate** = Email delivery failures (job completed but delivery failed)

Both needed because:
- API can respond successfully (200) but delivery fails
- Example: Gmail API rate limit hit, our API returns 200, but email never sends

### Impact When Exceeded

| Success Rate | Failures/Day (200K emails) | User Impact | Action |
|-------------|--------------------------|-------------|--------|
| 99%+ | <2K | Minimal, normal retry recovers | Monitor |
| 95% | ~10K | Users notice failures, support calls | Investigate cause |
| 90% | ~20K | Major incident, widespread failures | Page on-call |
| 85%- | 30K+ | Cascading failures, likely outage | Emergency response |

### Tuning Guidance

- **If warning fires daily**: Lower warning to 97% (earlier detection)
- **If warning never fires**: Raise to 93% (you're exceptionally reliable)
- **If critical fires**: Requires incident response, not threshold adjustment
- **Track per-type**: Monitor success rate by email type (transactional, marketing, etc.)

---

## 6. Failed Jobs Per Hour (Target: 0, Warning: 5, Critical: 20)

### Why This Metric Matters

Absolute failure count provides complementary view to success_rate percentage. Useful for detecting spikes and trends.

### Why These Values

**Target: 0**
- Ideal state: No email delivery failures
- Practical: Some percentage is unavoidable (bad email addresses, spam filters)

**Warning: 5 failures/hour**
- Represents: ~120 failures/day (0.06% of 200K emails)
- Indicates: Transient failures or minor issue
- Action: Monitor trend, check for patterns (specific email type, recipient domain)

**Critical: 20 failures/hour**
- Represents: ~480 failures/day (0.24% of 200K)
- Indicates: Systematic failure, not transient
- Action: Investigate root cause (authentication, quota, database)

### Combined with Success Rate

Use both metrics together:
- Success rate 99% = reliable
- Success rate 95% + failures 5/hour = consistent issue
- Success rate 95% + failures 20/hour = spiking/cascading
- Success rate 99% + failures 20/hour = sudden spike (investigate)

### Tuning Guidance

- **If warning fires but success_rate >95%**: Threshold working as designed, monitor
- **If both warning and success_rate <95%**: Indicates systematic issue, escalate
- **If critical fires but success_rate >99%**: Indicates spike, likely transient

---

## 7. Redis Ping Latency (Target: 10ms, Warning: 50ms, Critical: 100ms)

### Why This Metric Matters

Redis is critical infrastructure for job queuing and session management. PING latency directly correlates with job processing speed.

### Why These Values

**Target: 10ms**
- Local network latency: Typical local latency is 1-5ms
- Target accounts for: 2x network latency + Redis processing
- Healthy state: Should see <10ms consistently

**Warning: 50ms**
- Network issue: Indicates 5-10x normal latency
- Possible causes: High network traffic, Redis CPU spiking, memory pressure
- Impact: Email delivery time increases by 50-100ms
- Action: Check Redis metrics, consider scaling

**Critical: 100ms**
- Severe degradation: 10x normal latency
- Impact: Email delivery time increases by 100-200ms
- Root causes: Redis swapping, network congestion, connection pool exhaustion
- Action: Page on-call, may need Redis restart or failover

### Connection to Email Delivery SLA

- Email delivery target: 2000ms
- Queue write/read: 4 Redis operations = 4 × 100ms = 400ms
- At warning (50ms): 200ms Redis time = 10% of delivery budget
- At critical (100ms): 400ms Redis time = 20% of delivery budget
- If Redis at 100ms + Gmail API slow = SLA breach

### Tuning Guidance

- **If warning fires but email_delivery_time <2s**: Redis not critical path
- **If warning + email_delivery_time >5s**: Redis is bottleneck, scale up
- **If critical fires**: Likely cascading failure, investigate connection pool
- **If PING latency spikes but thresholds not hit**: Monitor for trend toward critical

---

## 8. Gmail API Availability (Target: 99.9%, Warning: 99.5%, Critical: 99.0%)

### Why This Metric Matters

Gmail API is an external dependency beyond our control. Its availability directly limits our SLA maximum.

### Why These Values

**Target: 99.9%**
- Gmail's published SLA: 99.9% uptime = 43.2 min downtime/month
- Our target: Match their SLA
- Dependency principle: We can't exceed our dependency's SLA

**Warning: 99.5%**
- Degradation from target: 0.4% worse than expected
- Indicates: Gmail experiencing issues
- Expected duration: Typically lasts 5-30 minutes
- Action: Monitor their status page, prepare customer communication

**Critical: 99.0%**
- Major degradation: 0.9% worse than SLA target
- Indicates: Gmail experiencing significant outage
- Expected impact: Our delivery rate drops significantly
- Action: Page on-call, escalate to account management, update status page

### Example Scenarios

| Scenario | Gmail Availability | Our Error Rate | Action |
|----------|------------------|-----------------|--------|
| Normal | 99.9% | 0.1% | Monitor |
| Gmail degraded | 99.5% | 0.5-1% | Alert and monitor |
| Gmail major issue | 99.0% | 2-5% | Page on-call, escalate |
| Gmail outage | 95% | 5%+ | Emergency response, consider fallback |

### Metrics We Can't Control

- Gmail's uptime depends on their infrastructure
- We monitor for awareness and customer communication
- We implement fallback strategies (retry with backoff, queuing)
- We document incident for post-mortem analysis

### Tuning Guidance

- **Don't tune these thresholds**: Match Gmail's SLA
- **Do monitor trend**: If warning fires 2+ times/month, assess Gmail's reliability
- **Do implement fallback**: Queue emails locally, implement exponential backoff
- **Do communicate**: When Gmail is down, proactively notify users

---

## Cross-Metric Analysis

### Healthy System State

All metrics should show this pattern:
- Email delivery time: <2s (most emails), <5s (99%)
- API response time: p95 <200ms, p99 <500ms
- Job queue depth: 0-20 jobs
- Error rate: <0.1%
- Job success rate: >99%
- Redis PING: 5-15ms
- Gmail API: 99.9%+ available

### Warning State

Multiple metrics exceed warning thresholds:
- Email delivery time: 5-8s (slow)
- API response time: p95 300-400ms (degrading)
- Job queue depth: 50-100 (building)
- Error rate: 0.3-0.5% (rising)
- Job success rate: 95-98% (declining)
- Redis PING: 30-50ms (slow)

**Action**: Investigate root cause, assess which metric is primary indicator

### Critical State

Multiple metrics exceed critical thresholds:
- Email delivery time: >10s (unacceptable)
- API response time: p95 >1s (severe)
- Job queue depth: >500 (overwhelming)
- Error rate: >2% (cascading failure)
- Job success rate: <90% (systematic issue)
- Redis PING: >100ms (infrastructure failure)

**Action**: Immediate incident response required

---

## Threshold Change Process

### Why Thresholds Change

1. **System matures**: After 3-6 months, you have more accurate baseline data
2. **Scale changes**: Traffic patterns change, thresholds need adjustment
3. **SLA changes**: If SLA target changes, thresholds must change
4. **Learning from incidents**: Each incident reveals optimal threshold

### Threshold Adjustment Approval Process

1. **Collect data**: 2+ weeks of production metrics
2. **Analyze trends**: Are thresholds too tight (noise) or too loose (late detection)?
3. **Calculate new thresholds**: Use formulas in THRESHOLDS_VALIDATION.md
4. **Get approval**: Team lead signs off on changes
5. **Deploy gradually**: Update 1-2 thresholds per week
6. **Monitor impact**: Track alert frequency and accuracy

### When to NOT Change Thresholds

- **During incident**: Don't adjust threshold in middle of crisis
- **Based on one incident**: Wait for pattern of 2-3 similar incidents
- **To eliminate a specific alert**: That alert may be correct
- **Without data**: Always collect baseline data first

---

## Quick Reference

### Health Indicators (All Should Be Green)

```
✓ Email delivery time: <2s for 99% of emails
✓ API response time p95: <200ms
✓ Job queue depth: 0-20 jobs (occasional spikes to 50 OK)
✓ Error rate: <0.1%
✓ Job success rate: >99%
✓ Redis PING: <20ms
✓ Gmail API: >99.9% available
```

### Action Thresholds

| Threshold Type | Meaning | Action |
|---|---|---|
| Target | Optimal performance | Maintain and monitor |
| Warning | Degradation, but acceptable | Investigate root cause |
| Critical | Unacceptable, SLA breach | Page on-call immediately |

---

## Related Documentation

- [Thresholds Validation](./THRESHOLDS_VALIDATION.md) — SLA alignment and math
- [Datadog Setup](./DATADOG_SETUP.md) — How to see these metrics
- [Monitoring Configuration](./1-monitoring-alerts.yaml) — Alert definitions
