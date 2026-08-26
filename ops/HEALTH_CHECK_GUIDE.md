# TaskFlow Notification System - Health Check Guide

## Overview

The `2-health-check-utils.sh` script provides comprehensive monitoring and diagnostics for the TaskFlow Notification System. It checks all critical infrastructure components and provides color-coded health status with actionable insights.

## Quick Start

```bash
# Run full health check
./2-health-check-utils.sh

# Continuous monitoring (ideal for dashboards)
./2-health-check-utils.sh watch

# JSON output for integration with monitoring systems
./2-health-check-utils.sh json | jq .

# Check specific component only
./2-health-check-utils.sh check_redis_health
```

## Features

### Color-Coded Health Status
- 🟢 **Green (✓)**: Component healthy and responsive
- 🟡 **Yellow (⚠)**: Component operational but degraded or slow
- 🔴 **Red (✗)**: Component unavailable or critical issue

### Comprehensive Coverage

| Component | Checks | Thresholds |
|-----------|--------|-----------|
| **Redis** | Connection, latency, memory, clients | <50ms healthy, <200ms warning, >200ms critical |
| **Supabase** | API connectivity, database access | <500ms healthy, <2000ms warning |
| **Gmail API** | Service account validity, scope verification | N/A (file-based) |
| **Google Pub/Sub** | Topic existence, subscription count | N/A (existence check) |
| **BullMQ Queue** | Queue depth, failed jobs, processing jobs | <1000 healthy, <10000 warning |
| **Notifications DB** | Query latency, table stats, record counts | <500ms healthy |

### Exit Codes

```
0 = All systems healthy ✓
1 = Warnings present (operational but degraded)
2 = Critical issues (service unavailable)
```

## Configuration

### Required Environment Variables

```bash
# Redis
export REDIS_URL="redis://:password@host:6379"

# Supabase
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"

# Gmail API
export GMAIL_SERVICE_ACCOUNT="/path/to/service-account.json"
export GOOGLE_CLOUD_PROJECT="your-gcp-project"

# Google Cloud Pub/Sub
export PUBSUB_TOPIC="projects/your-project/topics/your-topic"

# BullMQ (optional, defaults to "notifications")
export BULLMQ_QUEUE_NAME="notifications"
```

### Loading from .env

```bash
# Create .env.local with your configuration
source .env.local
./2-health-check-utils.sh
```

## Usage Examples

### 1. Daily Automated Health Check

```bash
# Add to crontab for daily 2 AM check
0 2 * * * /path/to/2-health-check-utils.sh >> /var/log/taskflow-health.log 2>&1

# Alert on critical issues
0 2 * * * if ! /path/to/2-health-check-utils.sh > /dev/null; then \
    mail -s "TaskFlow Health Alert" ops@example.com < /var/log/taskflow-health.log; fi
```

### 2. Integration with Monitoring Dashboards

```bash
# Prometheus integration (scrape JSON every 30s)
curl -s http://localhost:8080/health/json | jq '.services'

# Send to CloudWatch
./2-health-check-utils.sh json | jq '.services | to_entries[] | 
  {MetricName: .key, Value: (.value.latency_ms // 0)}'
```

### 3. Live Monitoring Setup

```bash
# Terminal 1: Continuous monitoring
./2-health-check-utils.sh watch

# Terminal 2: Export JSON stream to file for archival
while true; do 
  ./2-health-check-utils.sh json >> /var/log/taskflow-health.jsonl
  sleep 300  # Every 5 minutes
done
```

### 4. Component-Specific Debugging

```bash
# Check only Redis
./2-health-check-utils.sh check_redis_health

# Check database queries
./2-health-check-utils.sh check_notifications_db

# Check queue health
./2-health-check-utils.sh check_bullmq_health
```

### 5. Monitoring System Integration

**Datadog Agent**:
```yaml
# /etc/datadog-agent/conf.d/custom.yaml
init_config:

instances:
  - name: taskflow_health
    command: /path/to/2-health-check-utils.sh json
    timeout: 15
    tags:
      - "service:taskflow"
      - "component:notification-system"
```

**Prometheus Push Gateway**:
```bash
#!/bin/bash
RESULTS=$(/path/to/2-health-check-utils.sh json)

# Parse and push metrics
echo "$RESULTS" | jq -r '.services | to_entries[] | 
  "taskflow_health_status{service=\"\(.key)\"} \(if .value.status == \"healthy\" then 1 else 0 end)"' | \
  curl --data-binary @- http://localhost:9091/metrics/job/taskflow
```

## Understanding the Output

### Text Report
```
TaskFlow Notification System - Health Check Report
2026-08-18 11:29:10

━━━ Checking Redis ━━━
✓ Connectivity OK (12ms)
✓ Memory usage: 256.5K
✓ Connected clients: 5
...

━━━ SUMMARY ━━━
Components Checked: 6
✓ Healthy: 6   

Overall Status: 
✓ All systems operational
```

### JSON Report
```json
{
  "timestamp": "2026-08-18T11:29:10Z",
  "overall_status": 0,
  "status_name": "healthy",
  "services": {
    "redis": {
      "status": "healthy",
      "latency_ms": 12,
      "message": "Connected"
    },
    "supabase": {
      "status": "healthy",
      "latency_ms": 245,
      "message": "Connected"
    },
    ...
  }
}
```

## Performance Thresholds

### Tuning Thresholds

Edit the constants at the top of the script:

```bash
# Performance thresholds (milliseconds)
readonly REDIS_LATENCY_WARN=50
readonly REDIS_LATENCY_CRITICAL=200
readonly SUPABASE_LATENCY_WARN=500
readonly SUPABASE_LATENCY_CRITICAL=2000
readonly GMAIL_LATENCY_WARN=1000
readonly GMAIL_LATENCY_CRITICAL=5000

# Queue size thresholds
readonly BULLMQ_QUEUE_WARN=1000
readonly BULLMQ_QUEUE_CRITICAL=10000
readonly BULLMQ_FAILED_WARN=10
readonly BULLMQ_FAILED_CRITICAL=100
```

Adjust based on your SLA requirements and expected latencies.

## Troubleshooting

### Command Not Found Errors

If you see "command not found" for `redis-cli`, `curl`, `gcloud`, etc.:

```bash
# Install required tools
brew install redis curl      # macOS
apt-get install redis-tools curl  # Ubuntu/Debian

# Install Google Cloud CLI
curl https://sdk.cloud.google.com | bash
```

### Permission Denied

```bash
# Make script executable
chmod +x 2-health-check-utils.sh

# Run with bash explicitly
bash 2-health-check-utils.sh
```

### Missing Environment Variables

```bash
# Verify all required variables are set
env | grep -E "REDIS_URL|SUPABASE|GMAIL|PUBSUB|BULLMQ"

# Load from environment file
source ~/.env.local
./2-health-check-utils.sh
```

### Connection Timeouts

If checks timeout, increase connection timeout:
- Edit `--connect-timeout` values in the script (default: 5s)
- Check network connectivity: `ping host`, `curl -I https://api.example.com`
- Verify credentials are correct in environment variables

## Advanced Configuration

### Custom Health Check

Add your own checks by extending the script:

```bash
check_custom_service() {
    local check_name="Custom Service"
    echo -e "\n${BLUE}━━━ Checking ${check_name} ━━━${NC}"
    
    # Your check logic here
    local status="healthy"  # or "warning"/"critical"
    local latency=42
    
    print_status "OK" "Service responding" "$latency"
    store_result "custom" "$status" "$latency" "Message"
    
    return 0
}

# Add to full_health_check()
check_custom_service
```

### Alerting Setup

```bash
#!/bin/bash
# health-check-alert.sh

STATUS=$(/path/to/2-health-check-utils.sh)
EXIT_CODE=$?

if [[ $EXIT_CODE -eq 2 ]]; then
    # Send critical alert
    slack_alert "🚨 TaskFlow critical issues: $(echo "$STATUS" | grep "✗")"
    pagerduty_trigger "TaskFlow Notification System Critical"
elif [[ $EXIT_CODE -eq 1 ]]; then
    # Send warning
    slack_alert "⚠️ TaskFlow warnings: $(echo "$STATUS" | grep "⚠")"
fi
```

## Best Practices

1. **Baseline Your Metrics**: Run the health check continuously for 24-48 hours to establish normal latency baselines
2. **Implement Alerting**: Integrate with your monitoring system (Datadog, New Relic, Prometheus)
3. **Archive Results**: Store JSON output for trend analysis and capacity planning
4. **Regular Reviews**: Check alerts and logs weekly for patterns
5. **Load Test Before Adjusting**: Before changing thresholds, load test to understand what's normal for your system

## Monitoring System Integration

See `/ops/1-monitoring-alerts.yaml` for Datadog, CloudWatch, and other integrations.

See `/ops/3-runbooks.md` for incident response procedures.

## Support

For issues or questions:
- Check `/ops/MONITORING_GUIDE.md` for broader monitoring strategy
- Review `/ops/8-performance-monitoring.sh` for detailed metrics
- See commit history for recent changes: `git log --oneline ops/`
