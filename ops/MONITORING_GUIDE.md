# TaskFlow Notification System - Performance Monitoring Guide

## Overview

The `8-performance-monitoring.sh` script is a comprehensive performance monitoring and profiling suite for the TaskFlow Notification System. It provides production-ready monitoring across 8 major component categories.

## Quick Start

```bash
# Make script executable
chmod +x ./8-performance-monitoring.sh

# View help
./8-performance-monitoring.sh help

# Run a single monitor
./8-performance-monitoring.sh db           # Database monitoring
./8-performance-monitoring.sh api          # API performance
./8-performance-monitoring.sh email        # Email delivery
./8-performance-monitoring.sh redis        # Redis performance
./8-performance-monitoring.sh system       # System metrics
./8-performance-monitoring.sh deps         # External dependencies

# Run all monitors
./8-performance-monitoring.sh all

# Start continuous monitoring (every 60 seconds)
./8-performance-monitoring.sh watch

# Start continuous monitoring (custom interval)
./8-performance-monitoring.sh watch 30

# Generate reports
./8-performance-monitoring.sh report

# Start alert handler (background)
./8-performance-monitoring.sh alerts &

# Export metrics for Prometheus/Datadog
./8-performance-monitoring.sh export
```

## Architecture

### 8 Component Sections

#### SECTION 1: Database Performance (PostgreSQL)
- **profile_slow_queries** - Identifies queries exceeding threshold (default 100ms)
  - Uses `pg_stat_statements` extension
  - Shows mean, max execution times, call counts
  - Exports to JSON for analysis
  
- **analyze_table_size** - Reports table and index sizes
  - Identifies bloated tables
  - Tracks index overhead
  
- **monitor_connection_pool** - Tracks active connections
  - Monitors connection state
  - Alerts when pool exhaustion approaches
  
- **check_index_usage** - Identifies unused/underused indexes
  - Lists indexes with low scan counts
  - Helps identify dead code in schema

#### SECTION 2: API Performance
- **profile_api_endpoints** - Measures endpoint latency distribution
  - Tests 10 requests per endpoint
  - Calculates P50/P95/P99 percentiles
  - Identifies slow endpoints
  
- **load_test_api** - Synthetic load testing
  - Concurrent request generation
  - Throughput and response time analysis
  - Identifies capacity limits
  
- **trace_slow_requests** - Detailed request tracing
  - Connection time, TTFB, total time breakdown
  - Identifies bottleneck stages
  
- **analyze_bundle_size** - JavaScript/CSS bundle sizing
  - Tracks build artifacts
  - Identifies bloat opportunities

#### SECTION 3: Email Delivery Performance
- **measure_email_latency** - End-to-end delivery latency
  - Send-to-delivery time distribution
  - P50/P95/P99 metrics
  
- **analyze_retry_pattern** - Retry success rates
  - Failed delivery tracking
  - Rate limit detection
  
- **measure_template_render_time** - Template processing
  - Identifies slow template rendering
  - Optimization opportunities
  
- **check_email_throughput** - Messages per second
  - Peak hour analysis
  - Capacity planning insights

#### SECTION 4: Redis Performance
- **monitor_redis_memory** - Memory usage and eviction
  - Heap utilization
  - Eviction rate monitoring
  - Alerts on high memory pressure
  
- **profile_redis_commands** - Command-level profiling
  - Slowlog analysis
  - Command statistics
  
- **check_key_patterns** - Key distribution analysis
  - Pattern sampling
  - Cardinality insights
  
- **measure_persistence** - Persistence metrics
  - RDB save duration
  - Fsync latency

#### SECTION 5: System Performance
- **monitor_cpu_usage** - Per-process CPU tracking
  - Overall system CPU
  - Top consumer processes
  
- **monitor_memory_usage** - Memory consumption analysis
  - Heap usage
  - Memory leak detection via process monitoring
  
- **check_file_descriptors** - Open file tracking
  - Resource leak detection
  - System limit monitoring
  
- **monitor_network_io** - Network throughput
  - Interface statistics
  - Traffic analysis

#### SECTION 6: External Dependencies
- **profile_supabase_queries** - Managed database monitoring
  - Query performance
  - Requires API credentials
  
- **measure_gmail_api_latency** - Third-party API health
  - Gmail service latency
  - Availability monitoring
  
- **check_pubsub_latency** - Message queue performance
  - Publish-to-receive latency
  - Throughput metrics
  
- **monitor_external_services** - Upstream service availability
  - Health checks on external APIs
  - Critical dependency monitoring

#### SECTION 7: Reporting
- **generate_performance_report** - Daily summary
  - Alert counts
  - Metric aggregation
  
- **trend_analysis** - Week-over-week comparison
  - Performance trajectory
  - Regression detection baseline
  
- **identify_regressions** - Anomaly detection
  - Compares to baseline metrics
  - Alerts on 20%+ degradation
  
- **export_metrics_csv** - CSV export
  - Spreadsheet analysis
  - Long-term trending

#### SECTION 8: Continuous Monitoring
- **start_performance_watch** - Loop runner
  - Configurable interval (default 60s)
  - Runs all monitors continuously
  
- **performance_alert_handler** - Alert processor
  - Monitors alert log
  - Integrates with external systems
  
- **performance_metrics_exporter** - Prometheus export
  - Text format metrics
  - Prometheus/Datadog integration

## Configuration

All thresholds and connections are configurable via environment variables:

```bash
# Performance thresholds
export SLOW_QUERY_MS=100          # Slow query threshold (ms)
export SLOW_API_MS=500            # Slow API threshold (ms)
export SLOW_EMAIL_MS=2000         # Slow email threshold (ms)
export SLOW_REDIS_MS=10           # Slow Redis command threshold (ms)
export CPU_THRESHOLD=80           # CPU warning threshold (%)
export MEM_THRESHOLD=85           # Memory warning threshold (%)
export MAX_CONNECTIONS=100        # Max database connections

# Database configuration
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=taskflow
export DB_USER=postgres
export PGPASSWORD=your_password

# Redis configuration
export REDIS_HOST=localhost
export REDIS_PORT=6379

# API configuration
export API_BASE_URL=http://localhost:3000

# Gmail configuration
export GMAIL_ACCESS_TOKEN=your_token
export GMAIL_API_ENDPOINT=https://gmail.googleapis.com/gmail/v1

# Output configuration
export LOG_DIR=./monitoring-logs
export METRICS_DIR=./metrics
export BASELINE_FILE=./baseline.json
```

## Output Structure

```
monitoring-logs/
├── monitoring.log              # All log entries
├── alerts.log                  # Alert history

metrics/
├── slow_queries.json           # Query performance data
├── api_latency.json           # API latency percentiles
├── connection_pool.json       # Connection pool metrics
├── load_test.log              # Load test results
├── email_latency.json         # Email delivery metrics
├── performance_report_YYYYMMDD.txt  # Daily summary
├── metrics_export_*.csv       # CSV export for analysis
└── prometheus_metrics.txt     # Prometheus format
```

## Alerting

The script supports three alert levels:

```bash
CRITICAL  - System down, immediate action required
WARNING   - Performance degraded, should investigate
INFO      - Status updates, informational
```

### Integration Points

To integrate with external alerting systems (Slack, PagerDuty, etc.), modify the `alert()` function:

```bash
alert() {
    local severity=$1
    local message=$2
    
    # Send to Slack
    curl -X POST -d "payload={\"text\":\"[$severity] $message\"}" $SLACK_WEBHOOK_URL
    
    # Send to PagerDuty
    curl -X POST -d "{\"routing_key\":\"...\",\"dedup_key\":\"...\",\"links\":[...]}" \
        https://events.pagerduty.com/v2/enqueue
    
    # Your custom integration...
}
```

## Usage Patterns

### Development Environment
```bash
# Monitor with relaxed thresholds
SLOW_QUERY_MS=500 SLOW_API_MS=1000 ./8-performance-monitoring.sh watch 30
```

### Staging Environment
```bash
# Standard thresholds, continuous monitoring
./8-performance-monitoring.sh watch 60
```

### Production Environment
```bash
# Strict thresholds with alerting
SLOW_QUERY_MS=50 SLOW_API_MS=200 ./8-performance-monitoring.sh alerts &
./8-performance-monitoring.sh watch 30
```

### Capacity Planning
```bash
# Run load test with various concurrency levels
./8-performance-monitoring.sh api /api/notifications 50 60
./8-performance-monitoring.sh api /api/notifications 100 60
./8-performance-monitoring.sh api /api/notifications 200 60
```

### Regression Testing
```bash
# Establish baseline
./8-performance-monitoring.sh all
cp baseline.json baseline.json.before

# Deploy changes

# Compare metrics
./8-performance-monitoring.sh all
# Script will alert on 20%+ regressions
```

## Performance Tips

### Database
- Monitor `pg_stat_statements` - requires extension installation
- Regular VACUUM/ANALYZE recommended
- Consider connection pooling (pgBouncer)

### API
- Load testing should match production traffic patterns
- Use P99 for SLA calculation (not average)
- Monitor upstream database connections

### Email
- Check retry logs regularly
- Monitor Gmail API quota usage
- Consider batching for high throughput

### Redis
- Monitor memory eviction rate
- Use persistence for data durability
- Consider cluster mode for HA

### System
- Set up process limits before hitting OS limits
- Monitor disk space (not in current script)
- Watch network saturation

## Integration with Other Tools

### Prometheus
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'taskflow-metrics'
    static_configs:
      - targets: ['localhost:9100']
    metric_path: '/opt/metrics/prometheus_metrics.txt'
```

### Grafana
Import JSON dashboards to visualize metrics from `metrics/` directory.

### ELK Stack
Forward logs from `monitoring-logs/` to Elasticsearch for long-term analysis.

### DataDog
Install DataDog agent and configure to scrape metrics directory.

## Troubleshooting

### Database connection errors
```bash
# Test database connection
PGPASSWORD=pwd psql -h localhost -d taskflow -U postgres -c "SELECT 1"
```

### Redis connection errors
```bash
# Test Redis connection
redis-cli -h localhost ping
```

### Gmail API failures
```bash
# Verify API credentials
curl -H "Authorization: Bearer $GMAIL_ACCESS_TOKEN" \
  https://gmail.googleapis.com/gmail/v1/users/me/profile
```

### Missing dependencies
```bash
# Install required tools
# macOS
brew install postgresql redis jq curl

# Linux
apt-get install postgresql-client redis-tools jq curl
```

## Next Steps

1. **Deploy to staging** - Validate all monitors work in your environment
2. **Establish baselines** - Run for 24-48 hours to establish normal behavior
3. **Configure alerts** - Integrate with your alerting system
4. **Set up dashboards** - Visualize metrics in Grafana/DataDog
5. **Automate exports** - Schedule CSV exports for trend analysis
6. **Document runbooks** - Create incident response guides for each alert type

## References

- PostgreSQL Performance: https://www.postgresql.org/docs/current/performance.html
- Redis Monitoring: https://redis.io/docs/management/sentinel/#monitoring-redis-instances
- Load Testing Best Practices: https://www.nginx.com/blog/load-testing-best-practices/
- SRE Metrics: https://www.oreilly.com/library/view/the-sre-book/9781491929935/
