# Phase 6.3 Quick Start Guide

Fast setup and common commands for BI & Dashboards.

## 🚀 Quick Setup (5 minutes)

### 1. Environment Variables

```bash
# Copy and edit
cp .env.example .env.local

# Add these critical vars
RESEND_API_KEY=your-api-key
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
ALERTS_EMAIL_RECIPIENTS=ops@company.com,execs@company.com
CRON_SECRET=$(openssl rand -base64 32)
GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 16)
```

### 2. Start Grafana Stack

```bash
# Start all services
docker-compose -f docker-compose.grafana.yml up -d

# Verify
docker-compose -f docker-compose.grafana.yml ps

# Access Grafana
# http://localhost:3001 (admin/admin)
```

### 3. Configure Grafana

```bash
# Copy dashboards
cp src/dashboards/*.json config/grafana/dashboards/

# Restart Grafana to load
docker-compose -f docker-compose.grafana.yml restart grafana
```

### 4. Deploy to Vercel

```bash
# Set env vars in Vercel dashboard:
# - CRON_SECRET
# - RESEND_API_KEY
# - SLACK_WEBHOOK_URL
# - ALERTS_EMAIL_RECIPIENTS

# Push code
git add .
git commit -m "feat: Phase 6.3 BI & Dashboards"
git push origin main

# Vercel auto-deploys
# Cron jobs auto-start
```

## 📊 Dashboard URLs

After Grafana setup:

- **Sales Dashboard:** http://localhost:3001/d/sales-dashboard
- **Inventory Dashboard:** http://localhost:3001/d/inventory-dashboard
- **Performance Dashboard:** http://localhost:3001/d/performance-dashboard
- **Funnel Dashboard:** http://localhost:3001/d/funnel-dashboard

## 🔌 API Endpoints

### Dashboard Data

```bash
# Get all metrics (JSON)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/dashboard-data?timezone=UTC"

# With date range
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/dashboard-data?startDate=2024-01-01&endDate=2024-01-31"
```

### Export Data

```bash
# Export orders (CSV)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/export?type=orders" -o orders.csv

# Export events
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/export?type=events" -o events.csv

# Export performance metrics
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/export?type=performance" -o performance.csv

# Export inventory
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/export?type=inventory" -o inventory.csv
```

## ⏰ Manual Cron Job Triggers

For testing (dev):

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

In production (Vercel):

```bash
# Replace with your domain
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://your-domain.com/api/cron/daily-digest"
```

## ✅ Testing

### Run Tests

```bash
# All analytics tests
npm test -- analytics.test.ts

# Specific test
npm test -- analytics.test.ts -t "Dashboard Data Endpoint"

# With coverage
npm test -- analytics.test.ts --coverage
```

### Manual Validation

```bash
# 1. Check Docker health
docker-compose -f docker-compose.grafana.yml ps

# 2. Test database connection
docker-compose -f docker-compose.grafana.yml exec postgres \
  psql -U postgres -d taskflow -c "SELECT COUNT(*) FROM activity_log;"

# 3. Verify Grafana data source
# Login to Grafana → Settings → Data Sources → PostgreSQL → Test

# 4. Check dashboard data
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/dashboard-data"

# 5. Test export
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/export?type=orders" -o test.csv
cat test.csv
```

## 🔒 Security Checklist

- [ ] Changed Grafana admin password
- [ ] Set CRON_SECRET env var
- [ ] Secured database password
- [ ] Enabled HTTPS in production
- [ ] Limited API endpoint access
- [ ] Configured email authentication
- [ ] Set Slack webhook securely
- [ ] Enable audit logging

## 📝 Common Tasks

### Change Grafana Admin Password

```bash
# Login as admin with current password
# Click admin icon → Settings → Account → Change password
```

### Add New Email Recipient

```bash
# Edit .env.local
ALERTS_EMAIL_RECIPIENTS=ops@company.com,execs@company.com,newuser@company.com

# Redeploy to Vercel
git add .env.local
git commit -m "chore: add new alert recipient"
git push
```

### Add New Slack Channel

```bash
# Create new webhook at Slack API
# Get webhook URL and add to .env.local
# Create new cron job route (e.g., /api/cron/alerts-channel-2)
# Point to same job with different webhook URL
```

### Monitor Cron Job Logs

```bash
# Local (Next.js dev)
npm run dev
# Watch console for cron job output

# Production (Vercel)
vercel logs --follow
# Filter by "api/cron" or job name
```

### Check Failed Jobs

```bash
# Query database directly
PGPASSWORD=postgres psql -h localhost -U postgres -d taskflow << EOF
SELECT * FROM activity_log 
WHERE action LIKE '%failed%'
ORDER BY created_at DESC LIMIT 10;
EOF

# Or via Supabase Studio
# https://app.supabase.com/project/[project]/editor/[table]
```

### Export All Data for Backup

```bash
# Full activity log
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/export?type=events&includeDetails=true" \
  -o backup-events-$(date +%Y%m%d).csv

# All orders
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/analytics/export?type=orders&includeDetails=true" \
  -o backup-orders-$(date +%Y%m%d).csv
```

## 🐛 Troubleshooting

### Docker Issues

```bash
# View logs
docker-compose -f docker-compose.grafana.yml logs grafana
docker-compose -f docker-compose.grafana.yml logs postgres

# Restart services
docker-compose -f docker-compose.grafana.yml restart

# Full rebuild
docker-compose -f docker-compose.grafana.yml down -v
docker-compose -f docker-compose.grafana.yml up -d
```

### Database Connection Issues

```bash
# Test connection
psql -h localhost -U postgres -d taskflow -c "SELECT version();"

# If connection fails, check:
# 1. Docker status: docker ps
# 2. Ports: lsof -i :5432
# 3. Firewall: sudo ufw status
```

### Email Not Sending

```bash
# Check API key
echo $RESEND_API_KEY

# Test Resend API directly
curl -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "alerts@taskflow.app",
    "to": "test@example.com",
    "subject": "Test Email",
    "html": "<p>Test</p>"
  }'

# Check activity log for failures
```

### Slack Not Sending

```bash
# Test webhook directly
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-type: application/json' \
  -d '{"text": "Test message"}'

# Check webhook URL is correct
echo $SLACK_WEBHOOK_URL
```

### Dashboard Queries Not Working

```bash
# Verify data in database
PGPASSWORD=postgres psql -h localhost -U postgres -d taskflow << EOF
SELECT COUNT(*) as total_events FROM activity_log;
SELECT DISTINCT action FROM activity_log LIMIT 5;
SELECT * FROM activity_log LIMIT 1;
EOF

# Check Grafana data source
# Settings → Data Sources → PostgreSQL → Test

# Check dashboard queries
# Edit dashboard → Panel edit → Run Query
```

## 📈 Performance Tips

1. **Dashboard Load Time:** Use shorter date ranges
2. **Export Speed:** Export in batches (max 90 days)
3. **Query Performance:** Add indexes on frequently used columns
4. **Memory Usage:** Limit retention of old activity logs
5. **API Latency:** Cache dashboard responses (frontend)

## 📚 Full Documentation

- **Setup Guide:** `PHASE_6_3_BI_DASHBOARDS.md`
- **Implementation:** `PHASE_6_3_IMPLEMENTATION_SUMMARY.md`
- **API Reference:** `PHASE_6_3_BI_DASHBOARDS.md#api-endpoints`
- **Testing:** `PHASE_6_3_BI_DASHBOARDS.md#testing`

## 🎯 Next Steps

1. [ ] Deploy to production
2. [ ] Verify cron jobs run successfully
3. [ ] Check first email digest
4. [ ] Verify Slack message
5. [ ] Monitor dashboard accuracy
6. [ ] Set up backup strategy
7. [ ] Document team access
8. [ ] Schedule regular reviews

## ⚡ Emergency Contacts

- **Email Issues:** Check Resend dashboard (https://resend.com)
- **Slack Issues:** Check webhook validity (https://api.slack.com)
- **Database Issues:** Check Supabase status (https://status.supabase.com)
- **Deployment Issues:** Check Vercel logs (vercel logs)

## 💡 Quick Tips

- Use `timezone=UTC` for consistent reporting
- Export in CSV before sharing with non-technical stakeholders
- Set up Grafana alerts for critical metrics
- Schedule regular dashboard reviews
- Backup Grafana dashboard configurations weekly
- Monitor activity_log growth (archive old logs quarterly)

---

**Last Updated:** January 20, 2025  
**Status:** Ready for Production
