# TaskFlow Notification System - Comprehensive Troubleshooting Guide

**Version:** 1.0  
**Last Updated:** 2026-08-18  
**Audience:** Backend Engineers, DevOps, On-Call

---

## Overview

This guide provides systematic troubleshooting procedures for the TaskFlow Notification System. The system uses BullMQ + Vercel KV (Redis) for async job processing, Gmail API for email delivery, and Supabase for persistence.

**Key Components:**
- Event emitters (API routes)
- BullMQ job processor
- Gmail API client
- Google Cloud Pub/Sub webhook receiver
- 4 database tables (notification_preferences, notifications, email_threads, failed_jobs)

---

## SECTION 1: Email Not Sending

### Symptom Checklist

- [ ] User reports no email received after action (assign, mention, etc.)
- [ ] Email appears in sent folder but recipient never got it
- [ ] Specific user/organization not receiving emails while others work
- [ ] Bulk email failure after deployment
- [ ] Error logs show "Failed to send email" but no details

### Diagnostic Commands

```bash
# Check failed_jobs table for recent failures
psql $DATABASE_URL -c "
  SELECT id, event_type, user_id, error_message, retry_count, created_at
  FROM failed_jobs
  WHERE created_at > NOW() - INTERVAL '1 hour'
  ORDER BY created_at DESC
  LIMIT 20;
"

# Check BullMQ job queue depth
node -e "
  const { Queue } = require('bullmq');
  const kv = require('@vercel/kv');
  const q = new Queue('notifications', { connection: kv });
  q.count().then(c => console.log('Queue depth:', c));
"

# Check Gmail API quota usage (via Google Cloud Console API)
# Dashboard: APIs & Services > Gmail API > Quotas

# Verify email provider configuration
env | grep -i notification

# Check Sentry for recent email send errors
# Filter: tags.component:notifications OR tags.action:send_email
```

### Common Causes & Fixes

#### 1. Gmail API Authentication Failed

**Root Cause:** OAuth token expired, invalid credentials, or missing scopes

**Diagnostic Steps:**
```bash
# Test Gmail API connectivity
node -e "
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/gmail.send']
  });
  google.gmail({ version: 'v1', auth }).users.getProfile({
    userId: 'me'
  }).then(r => console.log('✓ Gmail API OK:', r.data.emailAddress))
   .catch(e => console.error('✗ Gmail API Error:', e.message));
"

# Verify service account has send scope
cat $GOOGLE_APPLICATION_CREDENTIALS | grep -o '"type".*"' 
```

**Fix:**
1. Rotate Gmail API credentials in Google Cloud Console
2. Ensure service account has `gmail.send` scope
3. Redeploy with new credentials
4. Verify in logs: `gmail.users.messages.send() succeeded`

#### 2. Notification Preferences Disabled

**Root Cause:** User disabled email channel for event type

**Diagnostic Steps:**
```bash
# Check notification preferences for user
psql $DATABASE_URL -c "
  SELECT event_type, channel, enabled
  FROM notification_preferences
  WHERE user_id = '<user_id>'
  ORDER BY event_type, channel;
"

# If no rows, preferences were never initialized
psql $DATABASE_URL -c "
  SELECT COUNT(*) FROM notification_preferences
  WHERE user_id = '<user_id>';
"
```

**Fix:**
1. If preferences empty: insert defaults via `initializeNotificationPreferences()`
2. If disabled: query user to re-enable via `/admin/notificaciones` UI
3. Check audit log: who disabled it and when?
   ```bash
   psql $DATABASE_URL -c "
     SELECT * FROM audit_logs
     WHERE entity = 'notification_preferences'
     AND user_id = '<user_id>'
     ORDER BY created_at DESC;
   "
   ```

#### 3. Event Not Emitted

**Root Cause:** API route that triggers notification didn't call `emitNotification()`

**Diagnostic Steps:**
```bash
# Check if event was emitted to queue
# (Query Redis directly if queue is persisting)
redis-cli KEYS 'bull:notifications:*' | wc -l

# Check Sentry logs for event emitter errors
# Filter: tags.component:event-emitter

# Verify API endpoint was called
grep -r "emitNotification" src/api --include="*.ts" | grep event_type
```

**Fix:**
1. Verify `emitNotification()` is called in the API route
2. Check event type is valid (one of 8 defined types)
3. Ensure user_id and organization_id are passed
4. Re-trigger the action (assign task, mention user, etc.)

#### 4. Job Processor Crashed or Stopped

**Root Cause:** BullMQ consumer crashed, Vercel KV connection lost, or job worker undeployed

**Diagnostic Steps:**
```bash
# Check if Vercel KV is reachable
npx vercel env pull
node -e "
  const { kv } = require('@vercel/kv');
  kv.ping().then(r => console.log('✓ Vercel KV OK:', r))
         .catch(e => console.error('✗ Vercel KV Error:', e.message));
"

# Check job processor logs (Vercel Functions or deployment target)
vercel logs --follow

# Check if queue consumer process is still running
ps aux | grep 'notification.*consumer\|bullmq'

# Check for exhausted database connections
psql $DATABASE_URL -c "
  SELECT count(*) FROM pg_stat_activity
  WHERE application_name LIKE '%notifications%';
"
```

**Fix:**
1. Restart job processor: `vercel deployments --prod` or manual restart
2. Verify Vercel KV is provisioned and linked
3. Clear stuck jobs:
   ```bash
   node -e "
     const { Queue } = require('bullmq');
     const kv = require('@vercel/kv');
     const q = new Queue('notifications', { connection: kv });
     q.obliterate({ force: true }).then(() => console.log('Queue cleared'));
   "
   ```
4. Monitor logs for 10 minutes to confirm recovery

#### 5. Template Rendering Failed

**Root Cause:** React Email template has null/undefined data or missing variable

**Diagnostic Steps:**
```bash
# Check error in failed_jobs
psql $DATABASE_URL -c "
  SELECT error_message FROM failed_jobs
  WHERE error_message ILIKE '%template%' OR error_message ILIKE '%render%'
  ORDER BY created_at DESC LIMIT 5;
"

# Manually test template rendering
node -e "
  const { render } = require('@react-email/render');
  const TaskAssignedEmail = require('./templates/TaskAssignedEmail');
  const html = render(TaskAssignedEmail({
    userName: 'Test User',
    taskTitle: 'Test Task',
    assignedBy: 'Admin',
    taskUrl: 'http://example.com/tasks/1'
  }));
  console.log('Template render OK, length:', html.length);
" 2>&1
```

**Fix:**
1. Add null checks in template:
   ```typescript
   <Body>
     <p>{task?.title || 'Untitled Task'}</p>
     {dueDate && <p>Due: {format(dueDate, 'MMM dd')}</p>}
   </Body>
   ```
2. Verify task/user data is fetched before rendering
3. Add to Sentry context: `Sentry.captureContext({ template_data: {...} })`

### Prevention Tips

1. **Monitor failed_jobs table daily:** Set up alert if count > 10 in 1 hour
2. **Test email delivery weekly:** Use `/api/admin/notifications/test` endpoint
3. **Rotate Gmail credentials quarterly:** Track expiry in Google Cloud Console
4. **Log all emitNotification calls:** Add structured logging with event_type
5. **Alert on queue depth:** If > 100 jobs, check if processor is running

---

## SECTION 2: Email Delayed (> 2 minutes)

### Metrics to Check

- Email sent timestamp (DB) vs received timestamp (user report)
- BullMQ job processing latency
- Gmail API response time
- Database query latency

### Check Queue Depth

```bash
# Current queue depth
node -e "
  const { Queue } = require('bullmq');
  const kv = require('@vercel/kv');
  const q = new Queue('notifications', { connection: kv });
  
  Promise.all([
    q.count('waiting'),
    q.count('active'),
    q.count('completed')
  ]).then(([waiting, active, completed]) => {
    console.log('Waiting:', waiting);
    console.log('Active:', active);
    console.log('Completed:', completed);
    if (waiting > 50) console.warn('Queue backlog detected!');
  });
"

# Historical queue depth (last hour)
psql $DATABASE_URL -c "
  SELECT created_at, COUNT(*) as job_count
  FROM failed_jobs
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY DATE_TRUNC('minute', created_at)
  ORDER BY created_at DESC;
"
```

### Check Redis Latency

```bash
# Measure Redis ping latency
redis-cli --latency

# Check Redis memory usage (may cause slowness if near limit)
redis-cli INFO memory | grep -E 'used_memory_human|maxmemory'

# Monitor Vercel KV throughput
vercel logs --since 30m --filter KV

# Find slow Redis commands
redis-cli --slowlog get 10
```

**Acceptable Latencies:**
- Redis ping: < 5ms
- BullMQ job add: < 10ms
- Gmail API send: 500ms - 2s
- Database insert: < 20ms

### Check Gmail API Rate Limits

```bash
# Monitor Gmail API quota usage (real-time)
# Google Cloud Console: APIs & Services > Gmail API > Quotas

# Check if we're hitting rate limits
psql $DATABASE_URL -c "
  SELECT error_message, COUNT(*) as count
  FROM failed_jobs
  WHERE error_message ILIKE '%429%' OR error_message ILIKE '%quota%'
    AND created_at > NOW() - INTERVAL '1 hour'
  GROUP BY error_message;
"

# Verify current quota usage via CLI
gcloud compute project-info describe --project=$GCP_PROJECT \
  --format='value(quotas)'
```

**Gmail API Limits:**
- 25 emails/second per service account
- 750,000 emails/day per project
- 100 concurrent connections

### Check Network Connectivity

```bash
# Test connectivity to Gmail API
curl -I https://www.googleapis.com/gmail/v1/users/me/profile \
  -H "Authorization: Bearer $GMAIL_TOKEN" \
  -w "\nResponse time: %{time_total}s\n"

# Test Vercel KV connectivity
telnet $VERCEL_KV_HOST $VERCEL_KV_PORT

# Check Supabase database connectivity
psql $DATABASE_URL -c "SELECT NOW();"

# Monitor network latency to GCP
mtr -c 10 www.googleapis.com
```

### Root Cause Analysis

**Symptom:** All emails delayed 2-5 minutes consistently

**Likely Cause:** Gmail API rate limiting or BullMQ backlog

**Solution:**
1. Batch emails: group by organization, send in intervals
2. Implement exponential backoff in retry logic
3. Switch to bulk send API if available

**Symptom:** Random emails delayed, most sent quickly

**Likely Cause:** Temporary network issue or Redis slowness

**Solution:**
1. Check Redis memory (clear cache if > 80% full)
2. Add retry logic with jitter
3. Monitor specific Gmail API endpoint latency

---

## SECTION 3: High Bounce Rate

### Check Recipient Email Validity

```bash
# Query email addresses in notifications table
psql $DATABASE_URL -c "
  SELECT u.email, COUNT(n.id) as notification_count
  FROM auth.users u
  LEFT JOIN notifications n ON n.user_id = u.id
  GROUP BY u.email
  HAVING u.email ILIKE '%@%' AND u.email NOT ILIKE '%.com'
  LIMIT 20;
"

# Check for invalid email formats
psql $DATABASE_URL -c "
  SELECT email, email_confirmed_at
  FROM auth.users
  WHERE email NOT LIKE '%@%.%'
    OR email LIKE '%  %'
    OR LENGTH(email) > 254;
"

# Verify email was actually used (not placeholder)
node -e "
  const email = 'user@example.com';
  const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  console.log(re.test(email) ? 'Valid' : 'Invalid');
"
```

### Check Gmail Sending Limits

```bash
# Query failed sends by error type
psql $DATABASE_URL -c "
  SELECT 
    SUBSTRING(error_message FROM 1 FOR 50) as error_type,
    COUNT(*) as count
  FROM failed_jobs
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY SUBSTRING(error_message FROM 1 FOR 50)
  ORDER BY count DESC;
"

# Check daily email volume vs limit (750k/day)
psql $DATABASE_URL -c "
  SELECT 
    DATE(created_at) as day,
    COUNT(*) as emails_sent
  FROM notifications
  WHERE channel = 'email'
    AND created_at > NOW() - INTERVAL '7 days'
  GROUP BY DATE(created_at)
  ORDER BY day DESC;
"

# If approaching limit:
# - Implement backoff
# - Request quota increase: Google Cloud Console > Quotas > Edit Quotas
```

### Check SPF/DKIM/DMARC Records

```bash
# Verify DNS records (run from your mail server)
dig taskflow.local TXT +short | grep -i spf
dig taskflow.local TXT +short | grep -i dmarc
dig taskflow.local CNAME +short | grep -i dkim

# Expected SPF record format:
# v=spf1 include:sendgrid.net ~all
# OR
# v=spf1 include:google.com ~all

# Test SPF/DKIM/DMARC with mxtoolbox:
curl "https://mxtoolbox.com/api/v1/spf/check?domain=taskflow.local"
```

**Common SPF/DKIM Issues:**
- Missing SPF record
- SPF record too permissive (`?all` instead of `~all`)
- DKIM signature invalid
- DMARC policy too strict

### Check Spam Score

```bash
# Send test email and check spam score
# Use: Mail-tester.com or Verifications.io

# Check email headers for spam indicators
# Look for:
# - X-Priority: 5 (low priority = spam)
# - Return-Path mismatch
# - Missing DKIM-Signature
# - Unknown or spoofed sender

# Verify "From" address is configured correctly
env | grep NOTIFICATION_FROM_EMAIL

# Check if Gmail sandbox account is blocking emails
# (Gmail sandbox requires manual domain verification)
```

### Root Cause Analysis

**High bounce rate for new domain:**
- Issue: SPF/DKIM not yet propagated (TTL 24-48 hours)
- Solution: Wait 48 hours, test again. Avoid sending to strict ISPs (Gmail, Outlook) first.

**High bounce rate for specific ISP (e.g., Gmail):**
- Issue: Sender reputation low or email flagged as spam
- Solution:
  1. Use dedicated IP (if high volume)
  2. Implement DMARC alignment
  3. Warm up sender IP gradually
  4. Monitor with SendGrid/Google Postmaster Tools

**High bounce rate (invalid address):**
- Issue: User changed email or entered fake address
- Solution:
  1. Implement email verification on signup
  2. Add bounce handler for soft bounces (retry later)
  3. Suppress hard bounce emails (never retry)

---

## SECTION 4: Email Reply Not Processed

### Check Pub/Sub Topic

```bash
# Verify Google Cloud Pub/Sub topic exists
gcloud pubsub topics list | grep gmail

# Check subscription is active
gcloud pubsub subscriptions list | grep gmail-reply

# Monitor messages (real-time)
gcloud pubsub subscriptions pull gmail-reply-subscription \
  --limit=10 --auto-ack

# Check for undelivered messages
gcloud pubsub subscriptions describe gmail-reply-subscription
```

### Verify Webhook Endpoint

```bash
# Check webhook is registered in Google Cloud Console
# Settings > Push Subscriptions > Endpoint URL

# Manually test webhook endpoint
curl -X POST http://localhost:3000/api/webhooks/gmail-reply \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "eyJlbWFpbEFkZHJlc3MiOiJ0ZXN0QHRhc2tmbG93LmxvY2FsIn0="
    }
  }'

# Check endpoint is publicly accessible
curl -I https://taskflow.app/api/webhooks/gmail-reply

# Verify webhook signature validation (if implemented)
# X-Goog-Subscription-Confirmation header present?
```

### Check Email Parsing Logic

```bash
# Test email parser with raw Gmail message
node -e "
  const { parseGmailReply } = require('./lib/email-parser');
  const rawMessage = 'From: user@example.com\nSubject: Re: Task X\n\n/done';
  const parsed = parseGmailReply(rawMessage);
  console.log('Parsed:', parsed);
"

# Check for parsing errors in logs
grep -i "parse.*error\|invalid.*command" logs/webhooks.log

# Query recent email_threads to see if message_id matched
psql $DATABASE_URL -c "
  SELECT task_id, message_id, gmail_thread_id, created_at
  FROM email_threads
  ORDER BY created_at DESC
  LIMIT 10;
"
```

**Supported Commands:**
- `/done` - Mark task completed
- `/comment: text here` - Add comment (text after colon)
- `/status: In Progress` - Change status
- `any text` - Treated as comment if no command

### Check Task Update Permissions

```bash
# Verify user has permission to update task
psql $DATABASE_URL -c "
  SELECT u.id, u.email, t.id as task_id, t.title
  FROM auth.users u
  JOIN tasks t ON u.organization_id = t.organization_id
  WHERE t.id = '<task_id>'
    AND (
      u.id = t.assigned_to OR 
      u.id IN (SELECT user_id FROM team_members WHERE organization_id = t.organization_id AND role = 'admin')
    );
"

# Check RLS policies
psql $DATABASE_URL -c "
  SELECT * FROM pg_policies
  WHERE tablename = 'tasks';
"

# Verify JWT signature in email header matches
# X-TaskFlow-Ref: task_{taskId}_{jwt_signature}
```

### Root Cause Analysis

**Symptom:** Webhook receives message but task not updated

**Likely Causes:**
1. Parser can't extract command (unknown format)
   - Solution: Log raw email body, test parser with actual message
2. User doesn't have task update permission
   - Solution: Check RLS policy, verify user is team member
3. Task or comment creation failed silently
   - Solution: Check failed_jobs, enable detailed error logging

**Symptom:** Webhook not called at all

**Likely Causes:**
1. Gmail reply not captured (user replied from different account)
   - Solution: Verify Reply-To header is correct in sent email
2. Pub/Sub not routing to webhook
   - Solution: Check subscription is active, endpoint registered correctly
3. Webhook endpoint returning 5xx error
   - Solution: Check server logs, verify endpoint is deployable

---

## SECTION 5: Users Not Receiving Notifications

### Check Notification Preferences

```bash
# Verify preferences exist for user
psql $DATABASE_URL -c "
  SELECT event_type, channel, enabled
  FROM notification_preferences
  WHERE user_id = '<user_id>'
  ORDER BY event_type, channel;
"

# Check if all 8 event types × 2 channels initialized
psql $DATABASE_URL -c "
  SELECT COUNT(*) FROM notification_preferences
  WHERE user_id = '<user_id>' AND enabled = TRUE;
"
-- Expected: >= 8 (if email disabled, at least 8 in-app)

# Find users with no preferences (never initialized)
psql $DATABASE_URL -c "
  SELECT u.id, u.email
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_preferences np WHERE np.user_id = u.id
  );
"
```

### Check RLS Policies

```bash
# Verify RLS is enabled on notifications table
psql $DATABASE_URL -c "
  SELECT tablename, rowsecurity FROM pg_tables
  WHERE tablename = 'notifications';
"

# Check active RLS policies
psql $DATABASE_URL -c "
  SELECT * FROM pg_policies
  WHERE tablename = 'notifications';
"

# Test policy with user context
psql -U service_role $DATABASE_URL -c "
  RESET SESSION AUTHORIZATION;
  SET app.current_user_id TO '<user_id>';
  SELECT COUNT(*) FROM notifications;
"

# If 0 rows: RLS policy may be too restrictive
```

### Check Browser Notifications Permission

```bash
# This is client-side; check browser console
# JavaScript to test:
Notification.permission  // Should be "granted"
new Notification("Test")  // Should appear

# From server: check if user allowed notifications
psql $DATABASE_URL -c "
  SELECT notification_permission
  FROM user_settings
  WHERE user_id = '<user_id>';
"
```

### Check Bell Polling (30s Interval)

```bash
# Monitor client-side polling in browser
# Open DevTools > Network > Filter "notifications"
# Should see GET /api/admin/notifications every 30s

# Check server logs for polling endpoint
grep "GET /api/admin/notifications" logs/api.log | head -20

# Verify polling endpoint returns data
curl http://localhost:3000/api/admin/notifications?limit=10 \
  -H "Authorization: Bearer $JWT_TOKEN"

# Check response time
time curl -s http://localhost:3000/api/admin/notifications?limit=10 \
  -H "Authorization: Bearer $JWT_TOKEN" | jq .
```

**Expected Polling Behavior:**
- Client polls every 30s
- Server returns unread count + latest 10 notifications
- User sees bell icon with number badge
- Clicking bell shows dropdown

### Root Cause Analysis

**Symptom:** User sees no notifications (email or in-app)

**Diagnostic Sequence:**
1. Check preferences enabled: `notification_preferences.enabled = TRUE`
2. Check event was emitted: query `failed_jobs` for errors
3. Check notification created: query `notifications` table
4. Check RLS policy allows read: test policy with user ID
5. Check polling endpoint returns data: test HTTP endpoint

**Fix by Scenario:**

| Scenario | Fix |
|----------|-----|
| Preferences not initialized | `INSERT INTO notification_preferences (user_id, organization_id, event_type, channel, enabled) VALUES (...)` for all 8×2 |
| Preferences disabled | Re-enable via UI or `UPDATE notification_preferences SET enabled = TRUE` |
| RLS policy blocks read | Check policy, verify `user_id` matches authenticated user |
| Notification not created | Check event emitter was called, check failed_jobs for errors |
| Polling not working | Check browser network tab, verify JWT token valid |

---

## SECTION 6: Database Issues

### Slow Queries

```bash
# Find slow queries in notifications table
psql $DATABASE_URL -c "
  EXPLAIN ANALYZE
  SELECT n.* FROM notifications n
  WHERE n.user_id = '<user_id>'
    AND n.read = FALSE
  ORDER BY n.created_at DESC
  LIMIT 20;
"
-- Look for Sequential Scans; should use indexes

# Check query plan for joins
EXPLAIN (ANALYZE, BUFFERS)
SELECT n.*, u.email, t.title
FROM notifications n
JOIN auth.users u ON n.user_id = u.id
JOIN tasks t ON n.task_id = t.id
WHERE n.user_id = '<user_id>'
ORDER BY n.created_at DESC;
```

**Query Performance Goals:**
- Simple SELECT: < 5ms
- JOIN with 3 tables: < 20ms
- EXPLAIN Seq Scan: BAD (should use index)
- EXPLAIN Index Scan: GOOD

**Common Performance Issues:**

**Issue:** Sequential Scan instead of Index Scan

**Solution:**
```sql
-- Create missing index
CREATE INDEX idx_notifications_user_read_created 
ON notifications(user_id, read, created_at DESC);

-- Analyze stats
ANALYZE notifications;

-- Retest query
```

**Issue:** Query returns in 500ms instead of 20ms

**Solution:**
```sql
-- Check if indexes are being used
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE tablename = 'notifications'
ORDER BY idx_scan DESC;

-- If idx_scan = 0, index not used; DROP it
DROP INDEX idx_notifications_created;

-- Rebuild with correct column order (WHERE columns first, then ORDER BY)
CREATE INDEX idx_notifications_user_created
ON notifications(user_id, created_at DESC);
```

### Connection Pool Exhaustion

```bash
# Monitor active connections
psql $DATABASE_URL -c "
  SELECT 
    application_name,
    COUNT(*) as connections,
    MAX(EXTRACT(EPOCH FROM (NOW() - query_start))) as idle_seconds
  FROM pg_stat_activity
  GROUP BY application_name
  ORDER BY connections DESC;
"

# Identify long-running queries
psql $DATABASE_URL -c "
  SELECT pid, application_name, query_start, state, query
  FROM pg_stat_activity
  WHERE state != 'idle'
  ORDER BY query_start;
"

# Check connection pool settings
echo $DATABASE_URL | grep -o 'pool=[0-9]*'

# Check Supabase dashboard: Database > Connection Pooling
# Verify pool size is adequate (default: 10 connections)
```

**Connection Pool Issues:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| "remaining connection slots reserved" error | Too many connections | Increase pool size or terminate idle connections |
| Queries timeout | Pool exhausted waiting for slot | Reduce connection lifetime, kill long-running queries |
| Random "no connections available" | Burst traffic | Add connection pool middleman (PgBouncer) |

### RLS Policy Violations

```bash
# Test if policy blocks write
psql $DATABASE_URL -c "
  SET app.current_user_id TO '<user_id>';
  INSERT INTO notifications (user_id, organization_id, event_type, message)
  VALUES ('<user_id>', '<org_id>', 'task_assigned', 'Test');
"
-- Should succeed if RLS allows INSERT

# Check what policy is denying access
psql $DATABASE_URL -c "
  SELECT * FROM pg_policies
  WHERE tablename = 'notifications'
    AND qual ILIKE '%user_id%';
"

# Debug policy logic
psql $DATABASE_URL -c "
  -- Simulate authenticated user context
  SET app.current_user_id TO '<user_id>';
  SET ROLE authenticated;
  
  SELECT * FROM notifications
  WHERE user_id = '<user_id>';
"
```

**Common RLS Problems:**

```sql
-- Problem: Policy checks auth.uid() but app.current_user_id is set
-- Fix: Use CURRENT_USER_ID() function that reads app context

-- Problem: Policy allows SELECT but blocks INSERT
-- Check: Does INSERT policy exist for INSERT?

-- Solution: View all policies
SELECT * FROM pg_policies WHERE tablename = 'notifications';
```

### Lock Conflicts

```bash
# Find table locks
psql $DATABASE_URL -c "
  SELECT 
    l.locktype,
    l.database,
    l.relation::regclass as table,
    l.mode,
    l.granted,
    a.application_name,
    a.query
  FROM pg_locks l
  JOIN pg_stat_activity a ON l.pid = a.pid
  WHERE l.relation::regclass::text ILIKE '%notification%';
"

# Check for deadlocks in logs
psql $DATABASE_URL -c "
  SELECT * FROM pg_stat_user_tables
  WHERE relname = 'notifications';
" | grep -i deadlock

# Kill blocking query (if safe)
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE pid != pg_backend_pid()
  AND query ILIKE '%notifications%'
  AND state = 'active'
  AND query_start < NOW() - INTERVAL '5 minutes';
```

---

## SECTION 7: Redis Issues

### Connection Refused

```bash
# Test Redis connectivity
redis-cli PING
# Expected: PONG

# If refused:
# 1. Check Vercel KV is provisioned
vercel env pull  # Verify VERCEL_KV_URL exists

# 2. Test with explicit connection
redis-cli -u $VERCEL_KV_URL PING

# 3. Check Redis not at capacity
redis-cli INFO server | head -5

# 4. Verify IP/firewall rules
telnet $VERCEL_KV_HOST 6379
```

### High Memory Usage

```bash
# Check Redis memory
redis-cli INFO memory | grep -E 'used_memory|maxmemory'
# If used_memory > 80% of maxmemory: eviction will occur

# Find largest keys
redis-cli --bigkeys

# Find keys that expire soon
redis-cli --scan | while read key; do
  ttl=$(redis-cli TTL "$key")
  if [ "$ttl" -lt 60 ] && [ "$ttl" -gt 0 ]; then
    echo "$key: $ttl seconds"
  fi
done

# Clear stale BullMQ jobs
redis-cli KEYS 'bull:notifications:*' | wc -l
redis-cli SCAN 0 MATCH 'bull:notifications:*:completed' COUNT 1000 | \
  while read key; do
    redis-cli DEL "$key"
  done
```

### Key Expiration Issues

```bash
# Check if keys are expiring
redis-cli --stat 100  # Monitor evictions/sec

# Debug BullMQ key expiration
redis-cli KEYS 'bull:notifications:*:delayed' | \
  while read key; do
    ttl=$(redis-cli PTTL "$key")
    echo "$key: ${ttl}ms"
  done

# BullMQ job retention (default: 1 hour for completed)
# If jobs not clearing: increase or manually clear
redis-cli DEL bull:notifications:completed
```

### Pub/Sub Message Loss

```bash
# Verify Pub/Sub is working
redis-cli PUBSUB CHANNELS  # Should show notification channels

# Subscribe to test
redis-cli SUBSCRIBE notifications:test

# Publish test message (from another terminal)
redis-cli PUBLISH notifications:test "hello"

# Check for subscriber issues
redis-cli PUBSUB NUMSUB notifications:*

# Monitor Pub/Sub performance
redis-cli INFO stats | grep -i pubsub
```

---

## SECTION 8: Gmail API Issues

### Authentication Failures

```bash
# Verify service account credentials
cat $GOOGLE_APPLICATION_CREDENTIALS | jq .

# Test OAuth token
curl -X POST https://oauth2.googleapis.com/token \
  -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  -d "assertion=$(node -e 'console.log(jwt)')"

# Check token expiry
node -e "
  const jwt = require('jsonwebtoken');
  const fs = require('fs');
  const creds = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS));
  const token = jwt.sign({}, creds.private_key, {
    algorithm: 'RS256',
    issuer: creds.client_email,
    subject: 'admin@taskflow.local',
    aud: 'https://oauth2.googleapis.com/token',
    expiresIn: '1h'
  });
  const decoded = jwt.decode(token);
  console.log('Expires:', new Date(decoded.exp * 1000));
"

# Rotate credentials if expired
# Google Cloud Console > Service Accounts > Select > Keys > Add Key
```

### Rate Limiting (429 Errors)

```bash
# Check current quota usage
curl https://www.googleapis.com/quota/v1/quotas \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.quotas[] | select(.metric == "gmail.send")'

# Monitor 429 errors
psql $DATABASE_URL -c "
  SELECT error_message, COUNT(*) as count
  FROM failed_jobs
  WHERE error_message ILIKE '%429%'
    AND created_at > NOW() - INTERVAL '1 hour'
  GROUP BY error_message;
"

# If hitting limits:
# 1. Implement exponential backoff (30s, 5m, 30m)
// Example retry with jitter
const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
setTimeout(() => send(), delay);

# 2. Batch emails to send in intervals
# 3. Request quota increase: Google Cloud Console > Quotas > Edit Quotas
```

### Quota Exceeded

```bash
# Check daily quota (750k emails/day per project)
psql $DATABASE_URL -c "
  SELECT COUNT(*) as emails_sent_today
  FROM notifications
  WHERE channel = 'email'
    AND created_at > NOW() - INTERVAL '24 hours';
"

# If near limit:
# 1. Implement daily quota tracking
// Redis key with daily quota
const key = `gmail:quota:${new Date().toISOString().slice(0, 10)}`;
await kv.incr(key);
await kv.expire(key, 86400);  // Expire after 24h

# 2. Defer non-critical notifications to next day
# 3. Request quota increase (review required)
```

### Missing Scopes

```bash
# Verify service account has gmail.send scope
cat $GOOGLE_APPLICATION_CREDENTIALS | jq '.scopes[]'

# Required scopes:
# - https://www.googleapis.com/auth/gmail.send
# - https://www.googleapis.com/auth/gmail.readonly (for replies)

# If missing:
# 1. Edit service account > Edit Trust Relationship > Add scope
# 2. Redeploy with new credentials
# 3. Test: node -e "const gmail = google.gmail({...}); gmail.users.messages.send(...)"
```

---

## SECTION 9: Performance Problems

### Slow API Endpoints

```bash
# Monitor endpoint latency
curl -w "@curl-format.txt" http://localhost:3000/api/admin/notifications

# curl-format.txt
cat > curl-format.txt << 'EOF'
  time_namelookup: %{time_namelookup}s
  time_connect: %{time_connect}s
  time_appconnect: %{time_appconnect}s
  time_pretransfer: %{time_pretransfer}s
  time_redirect: %{time_redirect}s
  time_starttransfer: %{time_starttransfer}s
  time_total: %{time_total}s
EOF

# Benchmark endpoints
ab -n 100 -c 10 http://localhost:3000/api/admin/notifications

# Check for slow database queries
psql $DATABASE_URL -c "
  SELECT query, mean_exec_time, calls
  FROM pg_stat_statements
  WHERE query ILIKE '%notifications%'
  ORDER BY mean_exec_time DESC;
" 2>&1 | head -20
```

**Expected Latencies:**
- GET /api/admin/notifications: < 50ms
- PATCH /api/admin/notification-preferences: < 100ms
- POST /api/admin/notifications/test: 100-500ms (send email)

### High CPU Usage

```bash
# Monitor CPU during notification job processing
ps aux | grep -i notification
# Look for %CPU > 50%

# Profile Node.js process
node --prof --prof-process profile.log > profile.txt

# Check for:
# 1. Infinite loops in email rendering
# 2. Synchronous I/O (should be async)
# 3. Large object allocations

# Example: detect sync I/O
grep -r "readFileSync\|writeFileSync" src/ --include="*.ts"

# Fix: replace with async versions
const data = await fs.promises.readFile(...)
```

### Memory Leaks

```bash
# Monitor memory growth
node --inspect notification-processor.js
# Open chrome://inspect in Chrome DevTools

# Check for memory accumulation
top -p $(pgrep -f notification)  # Watch VIRT/RES columns

# Common leak sources:
# 1. Event listeners not removed
process.removeAllListeners('message');

# 2. Timers not cleared
clearInterval(interval_id);

# 3. Circular references in job data
// Instead of storing entire task in job:
{ taskId: '123' }  // Reference only

# 4. Large buffers retained
buffer = null;  // Explicitly null out
```

### Bundle Size Issues

```bash
# Check bundle size
npm run build
ls -lh .next/

# Analyze with bundle analyzer
npx @next/bundle-analyzer
npm run analyze

# Common large dependencies:
# - googleapis (large)
# - react-email (with all rendering deps)

# Solution: Lazy load or tree-shake
import { google } from 'googleapis/build/src/index.js'  // Specific export

# Check for duplicate dependencies
npm dedupe
```

---

## SECTION 10: Security Issues

### RLS Bypass Attempts

```bash
# Monitor for unusual query patterns
psql $DATABASE_URL -c "
  SELECT * FROM pg_stat_statements
  WHERE query ILIKE '%notifications%'
    AND query NOT ILIKE '%user_id%'  -- Should always filter by user
  LIMIT 5;
"

# Check for elevated privilege use
psql $DATABASE_URL -c "
  SELECT * FROM audit_logs
  WHERE user_id IS NULL OR user_id = '00000000-0000-0000-0000-000000000000'
  ORDER BY created_at DESC;
"

# Test RLS actually enforces read restriction
psql -U user $DATABASE_URL -c "
  SELECT user_id FROM notifications LIMIT 1;
"
-- Should not return rows for users not authorized
```

### XSS in Templates

```bash
# Audit email templates for unescaped content
grep -r "dangerouslySetInnerHTML\|innerHTML" src/templates/

# Check email template rendering
grep -r "{.*}" src/templates/*.tsx | grep -v 'map\|if\|&&'
# Should see: {escapeHtml(userInput)}

# Test with malicious input
node -e "
  const TaskAssignedEmail = require('./templates/TaskAssignedEmail');
  const html = render(TaskAssignedEmail({
    userName: '<img src=x onerror=\"alert(1)\">',
    taskTitle: '../../etc/passwd',
    taskUrl: 'javascript:alert(1)'
  }));
  console.log('Check output:', html);
"
```

### Rate Limit Bypass

```bash
# Verify rate limiting is enforced
node -e "
  const rateLimit = require('express-rate-limit');
  // Should see rate limiter configured
  console.log('Rate limiter middleware:', rateLimit);
"

# Test rate limiting
for i in {1..100}; do
  curl http://localhost:3000/api/admin/notifications/test
done | grep -c "429"
# Should see ~90 429 responses if limit is 10/min

# Check if bypassed by IP spoofing
curl -H 'X-Forwarded-For: 1.1.1.1' http://localhost:3000/api/admin/notifications/test
curl -H 'X-Forwarded-For: 1.1.1.2' http://localhost:3000/api/admin/notifications/test
# Should be counted separately if using X-Forwarded-For without verification
```

### Token Validation Failures

```bash
# Verify JWT signature
node -e "
  const jwt = require('jsonwebtoken');
  const token = process.env.TEST_JWT;
  const decoded = jwt.decode(token, { complete: true });
  console.log('Header:', decoded.header);
  console.log('Payload:', decoded.payload);
  console.log('Valid:', jwt.verify(token, process.env.JWT_SECRET));
"

# Check token expiry on email headers
cat /tmp/taskflow-email.txt | grep -i 'X-TaskFlow-Ref\|token'

# Verify signature validation in webhook handler
grep -r "jwt.verify" src/ --include="*.ts"
# Should have try/catch and reject if invalid
```

---

## Escalation Decision Tree

```
START: Issue Reported
│
├─ Email not sent?
│  ├─ Check Gmail API auth → No auth? Contact GCP team
│  ├─ Check preferences → Disabled? User re-enables it
│  ├─ Check job queue → Backlog? Scale processor
│  └─ Email delayed > 5min? Check Redis/DB performance
│
├─ Email never received (not sent)?
│  ├─ Check failed_jobs table → Rendering error? Fix template
│  ├─ Check event emitter → Event not emitted? Fix API route
│  └─ Check preferences → User has email disabled
│
├─ Email received but reply not processed?
│  ├─ Check Pub/Sub topic → Webhook not called? Check registration
│  ├─ Check webhook endpoint → Returns 5xx? Check logs
│  └─ Check parser → Unknown command? Document format
│
├─ User not seeing notifications (any channel)?
│  ├─ Check preferences → All disabled? User re-enables
│  ├─ Check RLS → Policy blocks read? Fix policy
│  ├─ Check polling → Browser network? Check API response
│  └─ Check browser permissions → Granted? User allows
│
└─ System performance degraded?
   ├─ Check queue depth → > 100 jobs? Restart processor
   ├─ Check Redis memory → > 80%? Clear cache
   ├─ Check DB connections → > 20? Check long queries
   └─ Check Gmail quota → > 90%? Request increase or defer
```

### When to Page On-Call

**CRITICAL (page immediately):**
- All emails failing to send (P1)
- Email replies triggering task updates incorrectly (P1 - data integrity)
- RLS bypass allowing user to see others' notifications (P1 - security)
- Queue processor crashed and not restarting (P1)

**HIGH (alert, page if no response in 30m):**
- High bounce rate (> 10%) (P2)
- Email delayed > 5 minutes consistently (P2)
- In-app notifications not appearing (P2)

**MEDIUM (alert, can wait until morning):**
- Single user email delivery failed (P3)
- Slow query in notifications table (P3)
- Gmail quota nearing limit (P3)

---

## Troubleshooting Checklist

### Daily Checks
- [ ] Check failed_jobs count: should be < 5/hour
- [ ] Monitor Gmail API quota: should be < 50% of daily limit
- [ ] Check Redis memory: should be < 70%
- [ ] Verify Vercel KV connectivity: ping every 5m
- [ ] Alert on email bounce rate: should be < 2%

### Weekly Checks
- [ ] Review Sentry errors: group by component
- [ ] Check database query performance: reindex if needed
- [ ] Test email delivery: send test to Gmail/Outlook/Yahoo
- [ ] Verify Gmail credentials: check expiry
- [ ] Load test: simulate 100 concurrent notifications

### Monthly Checks
- [ ] Rotate Gmail API keys
- [ ] Review notification preferences distribution: find power users
- [ ] Audit email templates: check for XSS
- [ ] Performance audit: check p99 latencies
- [ ] Capacity planning: emails/day trend

---

## References

- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [Google Cloud Pub/Sub Guide](https://cloud.google.com/pubsub/docs)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Vercel KV Documentation](https://vercel.com/docs/storage/vercel-kv)
- [React Email Documentation](https://react.email)
- [PostgreSQL Query Planning](https://www.postgresql.org/docs/current/using-explain.html)

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-18  
**Maintained By:** Backend Team  
**Next Review:** 2026-09-18
