# TaskFlow Notification System - Datadog Integration Setup

**Complete guide for setting up Datadog monitoring for the TaskFlow Notification System.**

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Create Datadog Account](#step-1-create-datadog-account)
3. [Step 2: Generate API Keys](#step-2-generate-api-keys)
4. [Step 3: Configure Environment Variables](#step-3-configure-environment-variables)
5. [Step 4: Install Datadog Agent](#step-4-install-datadog-agent)
6. [Step 5: Enable Custom Metrics](#step-5-enable-custom-metrics)
7. [Step 6: Import Dashboard JSON](#step-6-import-dashboard-json)
8. [Step 7: Configure Alerts](#step-7-configure-alerts)
9. [Step 8: Verify Integration](#step-8-verify-integration)
10. [Troubleshooting](#troubleshooting)
11. [Cost Optimization](#cost-optimization)

---

## Prerequisites

Before starting, ensure you have:

- [ ] Datadog account access (or ability to create one)
- [ ] Vercel project with admin access
- [ ] Environment variable management access
- [ ] Gmail API credentials (already configured in TaskFlow)
- [ ] Redis access (for job queue monitoring)
- [ ] Supabase project access (for notification logs)
- [ ] Slack workspace with bot permissions (for alerts)

---

## Step 1: Create Datadog Account

### Option A: Create New Account (if you don't have one)

1. Go to https://www.datadoghq.com/
2. Click **Sign Up** in the top right
3. Choose your organization type (select "Business" for company account)
4. Fill in company details:
   - Company name: "Your Organization"
   - Email: Use company email
   - Password: Create strong password
5. Verify email address
6. Select your region:
   - US: https://app.datadoghq.com (US1) or https://us3.datadoghq.com (US3)
   - EU: https://app.datadoghq.eu (EU)
   - We recommend US1 for fastest performance
7. Click **Get Started**

### Option B: Use Existing Account

1. Go to https://app.datadoghq.com/ (US1) or your regional endpoint
2. Log in with existing credentials
3. Skip to Step 2

### Initial Setup

After login, Datadog shows onboarding wizard:
- Select "Infrastructure Monitoring" (we'll also enable APM)
- Choose "Containerized" or "Serverless" (TaskFlow uses Vercel, so select "Serverless")
- Select "Node.js" as primary language
- Continue to API key generation

---

## Step 2: Generate API Keys

### 2.1 Create Organization API Key

1. In Datadog, go to **Settings** → **API Keys**
2. Click **New Key** in the "API Keys" section
3. Enter name: `taskflow-notification-system`
4. Click **Create**
5. Copy the key (shown as `dd_XXXXXXXXXX...`)
6. Save it securely (you'll need this in Step 3)

**⚠ Security Note**: This is a sensitive credential. Use Vercel secrets, not git.

### 2.2 Create Application Key

1. In same settings page, go to **Application Keys** tab
2. Click **New Application Key**
3. Enter name: `taskflow-notification-monitoring`
4. Select permissions:
   - [ ] Admin
   - [x] Read (for dashboards, monitors)
   - [x] Write (for monitors, dashboards)
5. Click **Create**
6. Copy the key
7. Save it securely

### 2.3 Verify Key Permissions

Test your keys with curl:

```bash
# Test API key
curl -X GET "https://api.datadoghq.com/api/v1/validate" \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APP_KEY}"

# Response should show {"valid": true}
```

---

## Step 3: Configure Environment Variables

### 3.1 Add to Vercel Project

1. Go to your Vercel project settings
2. Navigate to **Settings** → **Environment Variables**
3. Add the following variables:

```
Name: DD_API_KEY
Value: <your-api-key-from-step-2>
Environments: Production, Preview, Development
Encrypt: Yes

Name: DD_APP_KEY
Value: <your-app-key-from-step-2>
Environments: Production, Preview, Development
Encrypt: Yes

Name: DATADOG_ENABLED
Value: true
Environments: Production
Encrypt: No

Name: DATADOG_SITE
Value: datadoghq.com
Environments: Production, Preview, Development
Encrypt: No

Name: DATADOG_SERVICE
Value: taskflow-notification-system
Environments: Production, Preview, Development
Encrypt: No

Name: DATADOG_ENV
Value: production
Environments: Production
Encrypt: No
```

### 3.2 Add to Local Development (.env.local)

Create or update `.env.local`:

```env
# Datadog Configuration
DD_API_KEY=your-api-key-here
DD_APP_KEY=your-app-key-here
DATADOG_ENABLED=false
DATADOG_SITE=datadoghq.com
DATADOG_SERVICE=taskflow-notification-system-dev
DATADOG_ENV=development
```

**⚠ Never commit .env.local to git!**

---

## Step 4: Install Datadog Agent

### 4.1 For Vercel Deployment (Serverless)

1. Install Datadog Node.js library:

```bash
npm install dd-trace --save-prod
```

2. Update your Next.js configuration (`next.config.js`):

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // ... existing config

  // Datadog APM Configuration
  env: {
    DD_API_KEY: process.env.DD_API_KEY,
    DD_APP_KEY: process.env.DD_APP_KEY,
    DATADOG_ENABLED: process.env.DATADOG_ENABLED,
  },

  // Add serverless tracing if using Datadog Serverless
  // Requires: npm install @datadog/serverless-plugin-node
  experimental: {
    serverComponentsExternalPackages: ['dd-trace'],
  },
};

module.exports = nextConfig;
```

3. Create `lib/datadog.ts`:

```typescript
// lib/datadog.ts
import tracer from 'dd-trace';

export const initDatadog = () => {
  if (process.env.DATADOG_ENABLED !== 'true') {
    console.log('Datadog tracing disabled');
    return;
  }

  tracer.init({
    service: process.env.DATADOG_SERVICE || 'taskflow-notification-system',
    env: process.env.DATADOG_ENV || 'production',
    logInjection: true,
    runtimeMetrics: true,
  });

  console.log('Datadog APM initialized');
};

export default tracer;
```

4. Initialize in your app entry point (`app/layout.tsx` or `pages/_app.tsx`):

```typescript
import { initDatadog } from '@/lib/datadog';

// Initialize Datadog early
if (typeof window === 'undefined') {
  initDatadog();
}

export default function RootLayout(...) {
  // ... rest of layout
}
```

### 4.2 For Local Development (Optional)

For testing locally with Datadog:

```bash
# Start Datadog Agent in Docker
docker run -d \
  --name datadog-agent \
  -e DD_API_KEY=${DD_API_KEY} \
  -e DD_SITE=datadoghq.com \
  -e DD_LOGS_ENABLED=true \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -p 8126:8126/udp \
  gcr.io/datadoghq/agent:latest
```

---

## Step 5: Enable Custom Metrics

### 5.1 Add Metric Reporting for Key KPIs

Update your email delivery code to report metrics:

```typescript
// src/lib/metrics.ts
import tracer from '@/lib/datadog';

interface MetricData {
  [key: string]: number | string;
}

export const recordMetric = (name: string, value: number, tags: Record<string, string> = {}) => {
  if (process.env.DATADOG_ENABLED !== 'true') return;

  const span = tracer.scope().active();
  if (span) {
    Object.entries(tags).forEach(([key, val]) => {
      span.setTag(key, val);
    });
    span.setMetric(name, value);
  }
};

// Specific metric recorders
export const recordEmailDeliveryTime = (deliveryTimeMs: number, status: 'success' | 'failed') => {
  recordMetric('taskflow.email.delivery_time', deliveryTimeMs, { status });
};

export const recordJobQueueDepth = (depth: number) => {
  recordMetric('taskflow.queue.depth', depth, { queue_type: 'email' });
};

export const recordJobProcessingTime = (processingTimeMs: number, status: 'success' | 'failed') => {
  recordMetric('taskflow.job.processing_time', processingTimeMs, { status });
};

export const recordGmailAPICall = (status: 'success' | 'failed', responseTimeMs: number) => {
  recordMetric('taskflow.gmail.api_call', responseTimeMs, { status });
};

export const recordNotificationLog = (type: string, status: string, deliveryTimeMs?: number) => {
  recordMetric('taskflow.notification.sent', 1, { type, status });
  if (deliveryTimeMs) {
    recordMetric('taskflow.notification.delivery_time', deliveryTimeMs, { type });
  }
};
```

### 5.2 Integrate Metrics into Email Sending

Update your email sending endpoint:

```typescript
// src/app/api/send-email/route.ts
import { recordEmailDeliveryTime, recordJobQueueDepth } from '@/lib/metrics';

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // ... email sending logic

    const deliveryTime = Date.now() - startTime;
    recordEmailDeliveryTime(deliveryTime, 'success');

    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    const deliveryTime = Date.now() - startTime;
    recordEmailDeliveryTime(deliveryTime, 'failed');

    return Response.json({ error: 'Failed to send' }, { status: 500 });
  }
}
```

### 5.3 Track Redis Queue Depth

```typescript
// src/lib/queue-monitor.ts
import Redis from 'ioredis';
import { recordJobQueueDepth } from './metrics';

const redis = new Redis(process.env.REDIS_URL);

export const monitorQueueDepth = async () => {
  if (process.env.DATADOG_ENABLED !== 'true') return;

  const depth = await redis.llen('taskflow:queue:email:waiting');
  recordJobQueueDepth(depth);
};

// Call this every 30 seconds
setInterval(monitorQueueDepth, 30000);
```

---

## Step 6: Import Dashboard JSON

### 6.1 Create Main Dashboard

1. Go to **Dashboards** → **New Dashboard**
2. Name it: `TaskFlow Notification System - Main Dashboard`
3. Set tags: `taskflow`, `production`, `email`
4. Click **Create**

### 6.2 Add Dashboard Widgets

Add the following widgets using the JSON definitions below:

**Widget 1: Email Delivery Time (Gauge)**

```json
{
  "type": "gauge",
  "requests": [
    {
      "q": "avg:taskflow.email.delivery_time{env:prod}",
      "aggregator": "avg"
    }
  ],
  "title": "Email Delivery Time (avg)",
  "gauge": {
    "min": 0,
    "max": 15000
  },
  "autoscale": true,
  "precision": 0,
  "unit": "ms"
}
```

**Widget 2: API Response Time (p95)**

```json
{
  "type": "gauge",
  "requests": [
    {
      "q": "p95:trace.web.request{service:notification-api,env:prod}",
      "aggregator": "avg"
    }
  ],
  "title": "API Response Time (p95)",
  "gauge": {
    "min": 0,
    "max": 2000
  },
  "unit": "ms"
}
```

**Widget 3: Job Queue Depth (Time Series)**

```json
{
  "type": "timeseries",
  "requests": [
    {
      "q": "avg:taskflow.queue.depth{env:prod}",
      "display_type": "line",
      "style": {
        "palette": "dog_classic"
      }
    }
  ],
  "title": "Job Queue Depth Trend",
  "yaxis": {
    "label": "Jobs",
    "scale": "linear"
  }
}
```

**Widget 4: Error Rate (%)**

```json
{
  "type": "gauge",
  "requests": [
    {
      "q": "sum:trace.web.request{http.status_code:5xx,env:prod}.as_count()/sum:trace.web.request{env:prod}.as_count()*100",
      "aggregator": "avg"
    }
  ],
  "title": "Error Rate",
  "gauge": {
    "min": 0,
    "max": 5
  },
  "unit": "%"
}
```

**Widget 5: Email Success Rate (%)**

```json
{
  "type": "gauge",
  "requests": [
    {
      "q": "avg:taskflow.notification.success_rate{env:prod}",
      "aggregator": "avg"
    }
  ],
  "title": "Email Job Success Rate",
  "gauge": {
    "min": 85,
    "max": 100
  },
  "unit": "%"
}
```

### 6.3 Save Dashboard

1. Click **Save** in top-right
2. Confirm name: `TaskFlow Notification System - Main Dashboard`
3. Dashboard is now live and ready for monitoring

---

## Step 7: Configure Alerts

### 7.1 Create Alert from Monitoring Config

The file `ops/1-monitoring-alerts.yaml` contains all alert definitions. Configure them in Datadog:

1. Go to **Monitors** → **New Monitor**
2. Choose **Metric** as monitor type
3. For each alert in the YAML file:

**Example: Email Delivery Time Critical Alert**

```
Monitor Type: Metric Alert
Metric: avg:taskflow.email.delivery_time{env:prod}
Alert Condition: avg() > 10000 over last 5m
Notification Channels: 
  - Slack: @taskflow-oncall
  - PagerDuty: TaskFlow Service
  - Email: ops-team@example.com
```

### 7.2 Bulk Import Using API

Use this script to create all monitors:

```bash
#!/bin/bash
# scripts/import-datadog-alerts.sh

API_KEY="${DD_API_KEY}"
APP_KEY="${DD_APP_KEY}"
SITE="${DATADOG_SITE:-datadoghq.com}"

# Email Delivery Time - Critical
curl -X POST "https://api.${SITE}/api/v1/monitor" \
  -H "DD-API-KEY: ${API_KEY}" \
  -H "DD-APPLICATION-KEY: ${APP_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "metric alert",
    "name": "Email Delivery Time Exceeds Critical Threshold",
    "query": "avg:taskflow.email.delivery_time{env:prod} > 10000",
    "message": "Email delivery time is above 10s: {{value}}ms. Runbook: https://example.com/runbooks/email-delivery",
    "tags": ["email", "delivery", "p0"],
    "priority": 1,
    "notify_no_data": false,
    "renotify_interval": 60
  }'

# Email Delivery Time - Warning
curl -X POST "https://api.${SITE}/api/v1/monitor" \
  -H "DD-API-KEY: ${API_KEY}" \
  -H "DD-APPLICATION-KEY: ${APP_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "metric alert",
    "name": "Email Delivery Time Warning",
    "query": "avg:taskflow.email.delivery_time{env:prod} > 5000",
    "message": "Email delivery time is elevated: {{value}}ms. Consider scaling workers.",
    "tags": ["email", "delivery"],
    "priority": 2,
    "notify_no_data": false
  }'

# Add more alerts following this pattern...
```

---

## Step 8: Verify Integration

### 8.1 Test Metric Collection

1. Deploy your updated code to Vercel:

```bash
git add .
git commit -m "feat: Add Datadog monitoring integration"
git push origin main
```

2. Vercel automatically deploys to production
3. Monitor your application to generate some traffic

### 8.2 Check Metrics in Datadog

1. Go to **Metrics** → **Explorer**
2. Search for `taskflow.` to find your custom metrics
3. You should see:
   - `taskflow.email.delivery_time`
   - `taskflow.queue.depth`
   - `taskflow.notification.sent`
   - etc.

### 8.3 Verify Dashboard

1. Go to **Dashboards** → `TaskFlow Notification System - Main Dashboard`
2. Verify all widgets are showing data (not "No data")
3. All graphs should be populated after 5-10 minutes

### 8.4 Test Alert Firing

To verify alerts work without causing real incident:

```bash
# Trigger a test metric that exceeds warning threshold
curl -X POST "https://api.datadoghq.com/api/v1/series" \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -d '{
    "series": [
      {
        "metric": "taskflow.email.delivery_time",
        "points": [[1692374400, 6000]],
        "tags": ["env:prod"],
        "type": "gauge"
      }
    ]
  }'

# Check that alert triggers in Datadog
# Then verify Slack/PagerDuty notification was sent
```

---

## Step 9: Connect Notification Channels

### 9.1 Slack Integration

1. In Datadog, go to **Integrations** → **Slack**
2. Click **Install** (or **Reinstall** if already connected)
3. Authorize Datadog Slack app
4. In monitor configuration, select Slack channel:
   ```
   Notification: @slack-#alerts-taskflow
   ```

### 9.2 PagerDuty Integration

1. In Datadog, go to **Integrations** → **PagerDuty**
2. Click **Installation Instructions**
3. In PagerDuty, create service `TaskFlow Notification System`
4. Get integration key from PagerDuty
5. Add to Datadog PagerDuty integration
6. In monitor configuration:
   ```
   Notification: @pagerduty-taskflow_service
   ```

### 9.3 Email Notifications

1. In monitor configuration, add email recipients:
   ```
   Notification: ops-team@example.com, engineering-lead@example.com
   ```

---

## Step 10: Ongoing Monitoring

### Daily Checklist

- [ ] Review dashboard for anomalies
- [ ] Check for any firing alerts
- [ ] Monitor email delivery metrics
- [ ] Verify API response times are healthy

### Weekly Review

- [ ] Analyze metrics trends
- [ ] Review alert frequency (adjust if too noisy)
- [ ] Check Slack/PagerDuty notification history
- [ ] Update runbooks if needed

### Monthly Review

- [ ] Calculate actual SLA attainment (should be 99.5%+)
- [ ] Review cost (see Cost Optimization section)
- [ ] Adjust thresholds if needed (see THRESHOLDS_VALIDATION.md)
- [ ] Plan capacity based on growth trends

---

## Troubleshooting

### Issue: No Metrics Appearing in Datadog

**Symptoms**: Dashboard shows "No data" for all widgets

**Solutions**:
1. Verify API keys are correct and have proper permissions
2. Check environment variables are set: `echo $DD_API_KEY`
3. Verify code is deployed to production
4. Check Datadog logs for connection errors:
   ```bash
   # In Vercel logs
   vercel logs
   ```
5. Ensure metrics are being sent:
   ```bash
   # Test direct API call
   curl -X GET "https://api.datadoghq.com/api/v1/validate" \
     -H "DD-API-KEY: ${DD_API_KEY}" \
     -H "DD-APPLICATION-KEY: ${DD_APP_KEY}"
   ```

### Issue: Alerts Firing Constantly (Alert Fatigue)

**Symptoms**: Getting 10+ alerts per hour

**Solutions**:
1. Raise warning thresholds (less sensitive)
2. Increase evaluation window (e.g., from 5m to 10m)
3. Add `no_alert_windows` to skip known noisy periods
4. Check if false positives are actually issues
5. Review THRESHOLDS_EXPLAINED.md for guidance

### Issue: Slack Notifications Not Being Sent

**Symptoms**: Alerts fire in Datadog but no Slack message

**Solutions**:
1. Verify Slack integration is installed: **Integrations** → **Slack** → Check "Installed"
2. Verify channel exists and bot is invited: `/invite @Datadog` in Slack
3. Check notification format in alert: `@slack-#channel-name`
4. Test with manual message:
   ```bash
   curl -X POST "https://api.datadoghq.com/api/v1/events" \
     -H "DD-API-KEY: ${DD_API_KEY}" \
     -d '{"title":"Test","text":"Test event"}'
   ```

### Issue: High Datadog Costs

**Symptoms**: Monthly bill is higher than expected

**Solutions**:
1. Review custom metrics being sent (may be too granular)
2. Reduce data retention for non-critical logs
3. Use metrics instead of logs where possible
4. See Cost Optimization section below

---

## Cost Optimization

### Datadog Pricing Model

Datadog charges per:
- **Custom metrics**: $0.05 per metric per month (first 100 free)
- **Logs**: $0.10 per million ingested logs
- **APM traces**: $0.10 per million spans (first 1M free)
- **Synthetics**: $0.005 per test run

### Cost Reduction Strategies

1. **Custom Metrics**:
   - Only send essential metrics (email delivery, queue depth, error rate)
   - Aggregate before sending (don't send per-email metrics)
   - Estimate: 8-10 metrics = ~$0.40/month (well under free tier)

2. **Log Filtering**:
   - Filter logs to only ERROR and CRITICAL level
   - Use metrics instead of logs for volume tracking
   - Estimate: 10K logs/day at ERROR+ = ~$0.03/month

3. **APM Tracing**:
   - Use sampling: only trace 10-20% of requests
   - Disable tracing for health check endpoints
   - Estimate: 10% sampling of 240K requests/day = covered by free tier

4. **Recommended Configuration**:
   ```
   Estimated monthly cost for TaskFlow:
   - Custom metrics (10): $0.50
   - Log ingestion (10K/day): $0.03
   - APM traces (10% sampled): Free tier
   - Synthetics: Free (don't use)
   ─────────────────────────
   Total: ~$0.53/month
   
   With buffer for growth: Plan for $2-5/month
   ```

### Monitor Your Datadog Bill

1. Go to **Settings** → **Billing & Usage** → **Usage**
2. Check "Billable Summary" to see current month's spend
3. Set budget alerts:
   - Email alert if usage exceeds $10/month
   - Review if approaching limit

---

## Production Checklist

Before going live with Datadog monitoring:

- [ ] Datadog account created and verified
- [ ] API keys generated and secured in Vercel
- [ ] dd-trace library installed and configured
- [ ] Custom metrics code implemented
- [ ] Metrics reporting tested locally
- [ ] Dashboard created and populated
- [ ] Alerts configured for all critical KPIs
- [ ] Slack/PagerDuty integrations verified
- [ ] Email notifications tested
- [ ] Runbook links added to all alerts
- [ ] On-call team trained on dashboard usage
- [ ] Cost monitoring enabled
- [ ] Documentation reviewed by team

---

## Next Steps

1. **Complete this setup guide** (you're 75% there!)
2. **Deploy to production** with Datadog integration
3. **Monitor for 24 hours** to ensure stability
4. **Review thresholds** after 2 weeks of production data
5. **Tune alerts** to minimize false positives
6. **Document learnings** for future monitoring improvements

---

## Support & Resources

### Datadog Documentation
- [Getting Started](https://docs.datadoghq.com/getting_started/)
- [Custom Metrics](https://docs.datadoghq.com/metrics/custom_metrics/)
- [Monitors & Alerting](https://docs.datadoghq.com/monitors/)
- [Dashboards](https://docs.datadoghq.com/dashboards/)

### TaskFlow Documentation
- [Thresholds Explained](./THRESHOLDS_EXPLAINED.md) — Understanding each KPI
- [Thresholds Validation](./THRESHOLDS_VALIDATION.md) — SLA alignment math
- [Monitoring Config](./1-monitoring-alerts.yaml) — Alert definitions

### Questions?

- Check [Datadog Support Docs](https://support.datadoghq.com/)
- Review Datadog in-app help (? icon in top-right)
- Post in TaskFlow team Slack #monitoring channel
