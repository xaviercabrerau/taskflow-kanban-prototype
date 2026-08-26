# Phase 6.3: BI & Dashboards - Implementation Guide

Production-ready Business Intelligence and Analytics layer with Grafana dashboards, scheduled reports, and data export APIs.

## Overview

Phase 6.3 implements a complete BI and analytics solution with:

- **Grafana Integration**: 4 pre-built dashboards (Sales, Inventory, Performance, Funnel)
- **Scheduled Reports**: Daily email digest, weekly Slack alerts, monthly PDF reports
- **Data Export APIs**: CSV export with filtering and date range support
- **Alert Rules**: Critical alerts and monitoring channels
- **Integration Tests**: Comprehensive test coverage for analytics functionality

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Analytics Layer (Phase 6.3)              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Grafana Dashboards (Docker)                 │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  • Sales Dashboard      (Revenue, Orders, Funnel)   │  │
│  │  • Inventory Dashboard  (Stock levels, Reorders)    │  │
│  │  • Performance Dashboard (API health, Latency)      │  │
│  │  • Funnel Dashboard     (Conversion, Cohorts)       │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ▲                                  │
│                          │ SQL Queries                      │
│                          │                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         PostgreSQL / Supabase Database              │  │
│  │  (activity_log table with structured events)        │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ▲                                  │
│          ┌───────────────┼───────────────┐                 │
│          │               │               │                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Cron Jobs    │  │ API Endpoints│  │ Real-time    │     │
│  ├──────────────┤  ├──────────────┤  │ Events       │     │
│  │ Daily Digest │  │ /api/        │  └──────────────┘     │
│  │ Weekly Alert │  │ analytics/   │                        │
│  │ Monthly PDF  │  │ dashboard    │                        │
│  │              │  │ /api/        │                        │
│  │              │  │ analytics/   │                        │
│  │              │  │ export       │                        │
│  └──────────────┘  └──────────────┘                        │
│       │                    │                               │
│       ▼                    ▼                               │
│  ┌──────────────┐  ┌──────────────────┐                   │
│  │ Email        │  │ JSON/CSV Files   │                   │
│  │ Slack        │  │ (Frontend)       │                   │
│  │ PDF Reports  │  └──────────────────┘                   │
│  └──────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Setup & Installation

### 1. Docker Setup for Grafana

Start Grafana and PostgreSQL locally:

```bash
# Navigate to project directory
cd /path/to/taskflow-kanban-prototype

# Start containers
docker-compose -f docker-compose.grafana.yml up -d

# Verify containers running
docker-compose -f docker-compose.grafana.yml ps

# Access Grafana
# URL: http://localhost:3001
# User: admin
# Password: admin (change in production)
```

### 2. Grafana Configuration

**Add PostgreSQL Data Source:**

1. Open Grafana (http://localhost:3001)
2. Settings → Data Sources → Add Data Source
3. Select PostgreSQL
4. Configure:
   - Host: `postgres:5432`
   - Database: `taskflow`
   - User: `postgres`
   - Password: `postgres`
   - SSL Mode: `disable`
5. Test & Save

**Import Dashboards:**

```bash
# Copy dashboard JSON files
cp src/dashboards/*.json config/grafana/dashboards/

# Restart Grafana to load dashboards
docker-compose -f docker-compose.grafana.yml restart grafana
```

Dashboards auto-load from `/var/lib/grafana/dashboards/`

### 3. Environment Configuration

Add to `.env.local`:

```bash
# Email Reporting (Resend)
RESEND_API_KEY=your-resend-api-key
ALERTS_FROM_ADDRESS=alerts@taskflow.app
ALERTS_EMAIL_RECIPIENTS=executive@company.com,ops@company.com

# Slack Alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Cron Security
CRON_SECRET=$(openssl rand -base64 32)

# Grafana
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 16)

# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-secure-password
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=taskflow
```

### 4. Deploy Cron Jobs to Vercel

The `vercel.json` includes cron schedules:

```json
{
  "crons": [
    { "path": "/api/cron/daily-digest", "schedule": "0 9 * * *" },
    { "path": "/api/cron/weekly-alert", "schedule": "0 8 * * 1" },
    { "path": "/api/cron/monthly-report", "schedule": "0 23 28-31 * *" }
  ]
}
```

Set `CRON_SECRET` environment variable in Vercel project settings.

## API Endpoints

### 1. Dashboard Data Endpoint

**GET** `/api/analytics/dashboard-data`

Returns aggregated metrics for all dashboards in JSON format.

**Query Parameters:**
- `startDate`: ISO date string (default: 30 days ago)
- `endDate`: ISO date string (default: now)
- `timezone`: IANA timezone (default: system timezone)

**Example Request:**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/dashboard-data?timezone=America/New_York"
```

**Response:**

```json
{
  "data": {
    "sales": {
      "todayRevenue": 15234.50,
      "totalOrders": 45,
      "avgOrderValue": 338.54,
      "last30DaysRevenue": 450000.00,
      "revenueByBranch": [
        { "branch": "NYC", "revenue": 200000.00 },
        { "branch": "LA", "revenue": 250000.00 }
      ],
      "conversionFunnel": [
        { "stage": "Visitor", "users": 5000 },
        { "stage": "Customer", "users": 150 }
      ]
    },
    "inventory": {
      "stockHealth": 85,
      "stockOutEvents": 2,
      "criticalItems": 5,
      "reorderCount": 10
    },
    "performance": {
      "apiRequestsPerSecond": 42,
      "avgResponseTime": 245,
      "errorRate": 0.5,
      "p99Latency": 1200,
      "uptime": 99.95
    },
    "funnel": {
      "visitorToCustomer": 3.0,
      "customerRetention": 65.0,
      "topDevices": [
        { "device": "desktop", "percentage": 60 }
      ],
      "topBrowsers": []
    }
  },
  "timestamp": "2024-01-20T10:30:00Z",
  "timezone": "America/New_York"
}
```

### 2. Data Export Endpoint

**GET** `/api/analytics/export`

Exports analytics data as CSV with filters and date range support.

**Query Parameters:**
- `type`: `orders` | `events` | `performance` | `inventory` (required)
- `startDate`: ISO date string (default: 30 days ago)
- `endDate`: ISO date string (default: now)
- `includeDetails`: `true` | `false` (include raw JSON details)

**Limits:**
- Maximum date range: 90 days
- Maximum rows: 10,000 per export
- Requires authentication

**Example Request:**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/export?type=orders&includeDetails=true" \
  -o orders.csv
```

**CSV Format (Orders):**

```
timestamp,order_id,amount,branch,status
2024-01-20T10:30:00Z,ORD-001,150.00,NYC,completed
2024-01-20T10:31:00Z,ORD-002,250.00,LA,completed
```

## Scheduled Reports

### Daily Digest (9 AM UTC)

**Includes:**
- Today's revenue
- Total orders & avg order value
- Inventory alerts (stock-outs, critical items)
- System health (uptime, errors)
- Trend comparison (vs. 7-day average)

**Recipients:** Configured in `ALERTS_EMAIL_RECIPIENTS`

**Template:** HTML email via Resend API

### Weekly Alert (Monday 8 AM UTC)

**Includes:**
- Weekly revenue & change %
- Total orders & change %
- Critical issues count
- Revenue vs. previous week
- Action links to dashboards

**Recipient:** Slack `#analytics` channel

**Template:** Slack Block Kit with formatted metrics

### Monthly PDF Report (Last day of month, 11 PM UTC)

**Includes:**
- Executive summary
- Revenue metrics & target attainment
- Top 5 products by revenue
- Top 5 branches by revenue
- System uptime & alerts
- Operational metrics

**Recipients:** Configured in `ALERTS_EMAIL_RECIPIENTS`

**Delivery:** Email with PDF attachment (signed URL)

## Grafana Dashboards

### Sales Dashboard

**Key Metrics:**
- Today Revenue (gauge)
- Total Orders (stat)
- Average Order Value (stat)
- Revenue last 30 days (line chart)
- Revenue by branch (pie chart)
- Conversion funnel (bar chart)

**Query Timezone:** Adjustable via template variable

### Inventory Dashboard

**Key Metrics:**
- Stock health % (gauge)
- Stock-out events (stat)
- Stock levels by product (line chart)
- Reorder events by status (pie chart)
- Stock health heatmap (table)

**Alerts:**
- Critical when stock < min threshold
- Warning when approaching min

### Performance Dashboard

**Key Metrics:**
- API requests/sec (stat)
- Avg response time (stat)
- Error rate % (stat)
- p99 latency (stat)
- Request volume (hourly)
- Response time trend
- Error rate trend (24h)

**Thresholds:**
- Green: < 500ms latency, < 1% errors
- Yellow: 500-1000ms, 1-5% errors
- Red: > 1000ms, > 5% errors

### Funnel Dashboard

**Key Metrics:**
- Customer acquisition funnel (table)
- Dropout analysis (bar chart)
- Cohort analysis by signup (line chart)
- Device breakdown (pie chart)
- Browser breakdown (pie chart)
- OS distribution (table)

## Testing

### Run Integration Tests

```bash
# All analytics tests
npm test -- analytics.test.ts

# Specific test suite
npm test -- analytics.test.ts -t "Dashboard Data Endpoint"

# With coverage
npm test -- analytics.test.ts --coverage
```

### Manual Testing

**Test Dashboard Data Endpoint:**

```bash
# With authentication
curl -H "Authorization: Bearer your-jwt-token" \
  "http://localhost:3000/api/analytics/dashboard-data?timezone=UTC"

# Test date range
curl -H "Authorization: Bearer your-jwt-token" \
  "http://localhost:3000/api/analytics/dashboard-data?startDate=2024-01-01&endDate=2024-01-31"
```

**Test Export Endpoint:**

```bash
# Export orders as CSV
curl -H "Authorization: Bearer your-jwt-token" \
  "http://localhost:3000/api/analytics/export?type=orders" -o orders.csv

# With date range
curl -H "Authorization: Bearer your-jwt-token" \
  "http://localhost:3000/api/analytics/export?type=performance&startDate=2024-01-01&endDate=2024-01-08"
```

**Test Cron Jobs (Development):**

```bash
# Daily digest
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/daily-digest"

# Weekly alert
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/weekly-alert"

# Monthly report
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/monthly-report"
```

## Monitoring & Observability

### Activity Logging

All analytics access is logged to `activity_log` table:

```sql
SELECT * FROM activity_log 
WHERE action IN ('analytics_dashboard_accessed', 'analytics_export', 'daily_digest_sent')
ORDER BY created_at DESC;
```

### Error Tracking

Failed jobs are logged:

```sql
SELECT * FROM activity_log 
WHERE action IN ('daily_digest_failed', 'weekly_alert_failed', 'monthly_report_failed')
ORDER BY created_at DESC;
```

### Performance Monitoring

Track analytics performance:

```sql
-- Average response time for analytics endpoints
SELECT 
  AVG(CAST(details->>'response_time_ms' AS NUMERIC)) as avg_response_time
FROM activity_log 
WHERE action = 'api_request' 
  AND details->>'endpoint' LIKE '%/api/analytics%'
  AND created_at >= NOW() - INTERVAL '24 hours';
```

## Production Checklist

- [ ] Set strong Grafana admin password
- [ ] Configure persistent Grafana storage
- [ ] Set up email authentication (Resend)
- [ ] Configure Slack webhook
- [ ] Add email recipients to environment
- [ ] Generate and secure CRON_SECRET
- [ ] Enable HTTPS for all endpoints
- [ ] Set up Grafana backups
- [ ] Configure database backups
- [ ] Test all cron jobs
- [ ] Document dashboard queries for your team
- [ ] Set up monitoring for failed jobs
- [ ] Configure rate limiting for export endpoint
- [ ] Enable audit logging for sensitive exports

## Database Schema Requirements

The analytics layer requires:

1. **activity_log table** with columns:
   - `id`: UUID
   - `created_at`: timestamp
   - `action`: text (enum-like)
   - `actor_id`: text/UUID
   - `entity_type`: text
   - `entity_id`: text/UUID
   - `details`: jsonb
   - `status_code`: integer

2. **Indexes:**
   ```sql
   CREATE INDEX idx_activity_log_created_at ON activity_log(created_at);
   CREATE INDEX idx_activity_log_action ON activity_log(action);
   CREATE INDEX idx_activity_log_actor_id ON activity_log(actor_id);
   ```

## Cost Considerations

- **Grafana**: Free/Self-hosted (~$50/mo for Grafana Cloud)
- **Email**: Resend ($0.20 per 1000 emails, free tier available)
- **Storage**: PDF reports in Supabase Storage (~$5/mo)
- **Database**: Queries on PostgreSQL (included with Supabase)
- **Vercel**: Cron jobs included with Pro plan

**Total Estimated Monthly Cost:** $50-100

## Troubleshooting

### Dashboards not loading

1. Check PostgreSQL connection in Grafana
2. Verify data source configuration
3. Check PostgreSQL logs: `docker logs taskflow-postgres`
4. Restart Grafana: `docker-compose restart grafana`

### Cron jobs not running

1. Verify `CRON_SECRET` is set in Vercel environment
2. Check Vercel project settings → Cron Jobs
3. View logs: `vercel logs`
4. Manually trigger to test: `curl -X POST ...`

### Export endpoint timeout

1. Reduce date range (max 90 days)
2. Use smaller batch exports
3. Check database performance
4. Increase API timeout

### Email reports not sending

1. Verify `RESEND_API_KEY` is set
2. Check email recipients in `.env.local`
3. Verify domain setup in Resend dashboard
4. Check activity_log for send failures

## Future Enhancements

- [ ] Custom dashboard builder UI
- [ ] Real-time alerts via webhooks
- [ ] Predictive analytics (ML models)
- [ ] Custom report scheduling
- [ ] Data warehouse integration (BigQuery/Snowflake)
- [ ] Advanced retention policies
- [ ] Role-based dashboard access
- [ ] Dashboard versioning & rollback

## References

- [Grafana Documentation](https://grafana.com/docs/)
- [Supabase PostgreSQL](https://supabase.com/docs/guides/database)
- [Resend Email API](https://resend.com/docs)
- [Slack Webhooks](https://api.slack.com/messaging/webhooks)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
