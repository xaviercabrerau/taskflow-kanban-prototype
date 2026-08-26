# 🚀 Notification System — Production Deployment Guide

**Last Updated:** 2026-08-18  
**System:** TaskFlow Notification System  
**Status:** Ready for Production  

---

## **PHASE 1: Environment Setup (30 minutes)**

### Step 1.1: Prepare Environment Variables

```bash
# In your Vercel project settings OR .env.production:

# Gmail Configuration
GMAIL_SERVICE_ACCOUNT_JSON="your-base64-encoded-jwt-key-here"
GMAIL_SENDER_EMAIL="notifications@yourdomain.com"

# Supabase (Production)
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"

# Redis/BullMQ
REDIS_URL="redis://user:password@your-redis-host:6379"

# Google Cloud
GOOGLE_CLOUD_PROJECT_ID="your-gcp-project-id"

# API Security
STAFF_API_KEY="your-api-key-for-webhook-verification"

# Vercel
NEXT_PUBLIC_VERCEL_URL="https://your-app.vercel.app"
NODE_ENV="production"
LOG_LEVEL="info"
RATE_LIMIT_MAX="5"
```

### Step 1.2: Verify .env Files

```bash
# Check .env.example exists and is documented
ls -la .env.example

# IMPORTANT: Never commit .env.production
grep ".env.production" .gitignore
```

### Step 1.3: Test Environment Loading

```bash
# Deploy to staging first (recommended):
vercel env pull  # Pull production vars to .env.production

# Verify vars are loaded:
node -e "console.log(process.env.GMAIL_SENDER_EMAIL)"
```

---

## **PHASE 2: Database Setup (20 minutes)**

### Step 2.1: Run Migrations

```bash
# If using Supabase CLI:
supabase db push

# Or manually apply migrations in Supabase Dashboard:
# - supabase/migrations/20260816120000_create_notification_preferences.sql
# - supabase/migrations/20260816120100_create_notifications.sql
# - Plus email_threads, failed_jobs tables
```

### Step 2.2: Verify Tables Created

```bash
# In Supabase Dashboard > SQL Editor:
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('notification_preferences', 'notifications', 'email_threads', 'failed_jobs');

# Expected: 4 rows
```

### Step 2.3: Enable Row-Level Security (RLS)

```sql
-- In Supabase Dashboard > SQL Editor

-- notification_preferences
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_select_own ON notification_preferences
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY notification_preferences_update_own ON notification_preferences
  FOR UPDATE USING (auth.uid()::text = user_id);

-- notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select_own ON notifications
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY notifications_update_own ON notifications
  FOR UPDATE USING (auth.uid()::text = user_id);

-- email_threads
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_threads_select_own ON email_threads
  FOR SELECT USING (auth.uid()::text = user_id);

-- failed_jobs (read-only for ops team)
ALTER TABLE failed_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY failed_jobs_select ON failed_jobs
  FOR SELECT USING (auth.role() = 'authenticated');
```

### Step 2.4: Verify RLS Policies

```bash
# Test RLS is working:
# 1. Login as User A
# 2. Query their notifications
# 3. Verify User B's notifications are NOT visible
```

---

## **PHASE 3: Gmail & Pub/Sub Setup (20 minutes)**

### Step 3.1: Gmail Service Account (GCP Console)

```bash
# 1. Go to GCP Console > APIs & Services > Credentials
# 2. Create Service Account:
#    - Name: taskflow-notifications
#    - Email: taskflow-notifications@PROJECT_ID.iam.gserviceaccount.com
# 3. Create JSON Key (download as key.json)
# 4. Enable Gmail API for the project
# 5. Configure Domain-Wide Delegation (if using @company.com)

# Encode the key:
base64 < key.json | tr -d '\n' > key.base64

# Set GMAIL_SERVICE_ACCOUNT_JSON to the base64 string
```

### Step 3.2: Gmail Pub/Sub Topic (GCP Console)

```bash
# 1. Go to Pub/Sub > Topics > Create Topic
#    - Name: gmail-reply-notifications
# 2. Create Subscription:
#    - Name: gmail-reply-sub
#    - Delivery type: Push
#    - Push endpoint: https://your-app.vercel.app/api/webhooks/gmail-reply
#    - Auth header: OIDC token (if using Vercel authentication)

# Test webhook:
curl -X POST https://your-app.vercel.app/api/webhooks/gmail-reply \
  -H "Content-Type: application/json" \
  -d '{"message": {"data": "eyJtZXNzYWdlSWQiOiAidGVzdCJ9"}}'

# Expected: 200 OK
```

---

## **PHASE 4: Redis & BullMQ Setup (10 minutes)**

### Step 4.1: Verify Redis Connection

```bash
# Option A: Vercel KV (recommended for Vercel deployments)
vercel env list  # Should show REDIS_URL

# Option B: External Redis
redis-cli -u "$REDIS_URL" ping
# Expected: PONG
```

### Step 4.2: Test BullMQ Queue

```bash
# In your app, test job creation:
npm run dev  # Start dev server

# In another terminal:
curl -X POST http://localhost:3000/api/admin/notifications/test \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected: 202 Accepted
```

---

## **PHASE 5: Testing & Build (15 minutes)**

### Step 5.1: Run All Tests

```bash
npm test

# Expected: 72 tests passing
```

### Step 5.2: Build Verification

```bash
npm run build

# Expected: No errors, successful build
```

---

## **PHASE 6: Security Audit (15 minutes)**

### Step 6.1: Secret Scan

```bash
# Check for hardcoded secrets:
grep -r "GMAIL_SERVICE_ACCOUNT" src/ app/ lib/  # Should return NOTHING
grep -r "STAFF_API_KEY" src/ app/ lib/          # Should return NOTHING
```

### Step 6.2: Rate Limiting Test

```bash
# Test rate limiting (5 emails per minute):
for i in {1..6}; do
  curl -X POST https://your-app.vercel.app/api/admin/notifications/test \
    -H "Authorization: Bearer YOUR_JWT_TOKEN"
done

# Expected: Requests 1-5: 202, Request 6: 429
```

---

## **PHASE 7: Monitoring Setup (15 minutes)**

### Step 7.1: Logging Configuration

```bash
# In Vercel settings:
# LOG_LEVEL=info (production)
# Enable Vercel Analytics

vercel logs --follow  # Watch deployment logs
```

### Step 7.2: Alert Configuration

Monitor these metrics:
- Failed jobs > 5 per hour
- API errors > 10 per minute
- Email delivery latency > 2 minutes
- Redis connection timeouts

---

## **PHASE 8: Post-Deployment Verification (30 minutes)**

### Step 8.1: 24-Hour Checks

```bash
# 1. Send test email and verify arrival
# 2. Test email reply with "done" command
# 3. Verify task status updates
# 4. Check notification bell updates
# 5. Monitor error logs (should be EMPTY)
```

### Step 8.2: 1-Week Checks

- Email delivery latency: avg < 2 minutes
- API response time: avg < 200ms
- Error rate: < 0.5%
- Job success rate: > 95%

---

## **Rollback Procedures**

### Immediate Actions

```bash
# Stop notification jobs:
# Set NOTIFICATION_QUEUE_ENABLED=false and redeploy

# Clear failing jobs:
redis-cli DEL bull:notification-queue:*

# Disable all notifications:
UPDATE notification_preferences SET enabled = false;
```

### Full Rollback

```bash
# Revert deployment:
git revert HEAD
vercel deploy --prod

# Restore database:
supabase db restore --backup-name daily-YYYY-MM-DD

# Clear Redis:
redis-cli FLUSHALL
```

---

## **Deployment Checklist**

- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] RLS policies enabled
- [ ] Gmail service account set up
- [ ] Pub/Sub webhook configured
- [ ] Redis/BullMQ verified
- [ ] All 72 tests passing
- [ ] Build succeeds with no errors
- [ ] Security audit passed
- [ ] Monitoring & alerts configured
- [ ] Post-deployment verification complete
- [ ] All stakeholders signed off

**Deployment Date:** ___________  
**Deployed By:** ___________  
**Verified By:** ___________  

---

**Estimated Time:** 2 hours  
**Difficulty:** Medium  
**Rollback Time:** < 30 minutes  

Ready to deploy! 🚀
