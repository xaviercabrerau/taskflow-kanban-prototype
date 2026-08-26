# TaskFlow Notification System - Operational Runbooks

Comprehensive runbooks for diagnosing and resolving common incidents in the TaskFlow Notification System. Each runbook provides step-by-step remediation procedures.

---

## 1. Email Delivery Timeout (> 10 seconds)

**Alert:** `notification_email_delivery_p99_latency_seconds > 10`

### Symptoms
- Email send requests taking > 10 seconds to complete
- Timeouts in application logs: `Error: Send email timeout after 10s`
- Users report delayed email notifications
- Application error rate increasing

### Immediate Diagnosis

```bash
# Check current email delivery metrics
curl -s http://localhost:3000/api/health/notifications | jq '.metrics.email_latency_p99'

# View recent error logs for timeout patterns
docker logs notification-service | grep -i "timeout\|ERR_HTTP" | tail -20

# Check Gmail API quota usage
curl -s https://monitoring.googleapis.com/v1/projects/PROJECT_ID/timeSeries \
  -H "Authorization: Bearer $GMAIL_API_TOKEN" | jq '.timeSeries[] | select(.metric.type | contains("gmail"))'

# Monitor real-time email queue
redis-cli -n 1 LLEN notification:queue:email

# Check network connectivity to Gmail
nc -zv smtp.gmail.com 465 && echo "Connection OK"
```

### Root Cause Investigation

**Step 1: Identify Failure Pattern**
```bash
# Check if timeouts are consistent or intermittent
docker logs notification-service --since 1h | grep "timeout" | wc -l

# Compare with normal baseline (last 7 days)
# Query metrics: avg delivery time by hour
# Look for correlation with traffic spikes
```

**Step 2: Check Gmail API Status**
```bash
# Verify Gmail authentication is still valid
curl -X GET https://www.googleapis.com/gmail/v1/users/me/profile \
  -H "Authorization: Bearer $GMAIL_ACCESS_TOKEN"

# Check remaining quota for the day
curl -s https://www.googleapis.com/admin/directory/v1/admin/quota \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN" | jq '.usageUnit'

# Check for recent rate limit hits
docker logs notification-service | grep "429\|rate.*limit" | tail -10
```

**Step 3: Analyze Network Conditions**
```bash
# Check latency to Gmail servers
ping -c 5 smtp.gmail.com

# Trace route to Gmail
traceroute smtp.gmail.com

# Check for packet loss (run for 60s)
ping -c 60 smtp.gmail.com | tail -2
```

**Step 4: Database Query Performance**
```bash
# Check if fetching notification templates is slow
EXPLAIN ANALYZE SELECT * FROM notification_templates 
WHERE type = 'email' AND enabled = true;

# Check Redis connection pool status
redis-cli INFO stats | grep -E "connected_clients|rejected_connections"
```

### Resolution Steps

**If Gmail API Quota Exhausted:**
```bash
# 1. Request quota increase through Google Cloud Console
# 2. Temporarily reduce email send concurrency
docker exec notification-service env EMAIL_CONCURRENCY=5 restart

# 3. Implement queue prioritization (high-priority first)
redis-cli -n 1 ZADD notification:queue:email:priority 1000 $PRIORITY_EMAIL_ID
```

**If Network Latency Issue:**
```bash
# 1. Scale up notification service replicas
kubectl scale deployment notification-service --replicas=3

# 2. Add connection pooling configuration
# Edit notification-service config:
EMAIL_POOL_SIZE=10
EMAIL_POOL_TIMEOUT=5000

# 3. Enable request retries with exponential backoff
EMAIL_RETRY_ATTEMPTS=3
EMAIL_RETRY_BACKOFF_MS=1000
```

**If Redis Slowdown:**
```bash
# 1. Check Redis memory usage
redis-cli INFO memory | grep used_memory_human

# 2. If > 85%, evict old job data
redis-cli CONFIG SET maxmemory-policy allkeys-lru

# 3. Increase Redis instance size or enable cluster mode
# AWS: Modify ElastiCache instance type to larger node
```

### Verification

```bash
# 1. Confirm latency reduction
watch -n 5 'curl -s http://localhost:3000/api/health/notifications | jq ".metrics.email_latency_p99"'

# 2. Test email delivery manually
curl -X POST http://localhost:3000/api/notifications/send \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email",
    "user_id": "test-user",
    "template": "task_assigned",
    "data": {"task_id": "123"}
  }'

# 3. Check for errors in logs
docker logs notification-service --since 1m | grep -i error

# 4. Verify no pending emails in queue
redis-cli -n 1 LLEN notification:queue:email
```

### Prevention Tips

- **Monitor Gmail quota daily:** Set up Datadog/New Relic alerts for quota usage > 80%
- **Implement circuit breaker:** Stop sending emails when Gmail API returns 429/503
- **Use connection pooling:** Maintain persistent connections to Gmail SMTP
- **Cache templates:** Store notification templates in Redis with 24h TTL
- **Stagger high-volume sends:** Batch emails over 5-minute windows instead of spikes
- **Rate limiting strategy:** Implement token bucket algorithm for outbound emails

### Escalation Path

| Condition | Action |
|-----------|--------|
| Latency still > 10s after 5 min | Page on-call infrastructure engineer |
| Multiple regions affected | Engage Google Cloud support + internal SRE team |
| Unresponsive Gmail API | Failover to backup SMTP provider (SendGrid/AWS SES) |

---

## 2. Redis Down / Cache Unavailable

**Alert:** `redis_connection_failed` or `redis_health_check_failed`

### Symptoms
- Redis connection refused errors in logs
- Notification queue operations failing with `ECONNREFUSED`
- All cache operations timing out
- Memory-based features degraded (session storage, rate limiting)
- Application latency spiking

### Immediate Diagnosis

```bash
# Test Redis connectivity
redis-cli PING

# If connection refused, check if Redis process is running
ps aux | grep redis-server

# Check Redis port is listening
netstat -tlnp | grep 6379

# View Redis logs for errors
docker logs redis-cache | tail -30

# Get Redis memory and connection info
redis-cli INFO server
redis-cli INFO memory
redis-cli INFO clients
```

### Root Cause Investigation

**Step 1: Check Redis Process Health**
```bash
# Is Redis running?
systemctl status redis-server
# OR
docker ps | grep redis

# Check system resource usage (Redis might be OOM killed)
dmesg | tail -20 | grep -i oom

# Check Redis logs for crashes
docker logs redis-cache --tail 50 | grep -E "error|fail|shutdown"
```

**Step 2: Verify Network Connectivity**
```bash
# From application server perspective
nc -zv redis-host 6379

# Check DNS resolution
nslookup redis-host
dig redis-host

# Verify security group/firewall rules (AWS/GCP)
aws ec2 describe-security-groups --filters "Name=group-name,Values=redis-sg"
```

**Step 3: Check Disk Space (Persistence)**
```bash
# If using RDB/AOF persistence
df -h /var/lib/redis

# Check if Redis persistence file is corrupt
ls -lh /var/lib/redis/dump.rdb
file /var/lib/redis/dump.rdb
```

**Step 4: Memory Pressure**
```bash
# Check if Redis hit max memory limit
redis-cli INFO memory | grep maxmemory
redis-cli INFO memory | grep used_memory

# Calculate available headroom
# if used_memory > 85% of maxmemory, eviction policies are active
```

### Resolution Steps

**If Redis Process Not Running:**
```bash
# 1. Start Redis service
sudo systemctl start redis-server
# OR
docker-compose up -d redis

# 2. Verify startup
redis-cli PING  # Should return "PONG"

# 3. Check for persistence issues if startup fails
docker logs redis-cache -f

# 4. If startup still fails, backup and reset
cp /var/lib/redis/dump.rdb /var/lib/redis/dump.rdb.backup
redis-cli FLUSHALL  # WARNING: This clears all data
```

**If Memory Exhausted:**
```bash
# 1. Increase maxmemory setting
redis-cli CONFIG SET maxmemory 2gb

# 2. Implement eviction policy
redis-cli CONFIG SET maxmemory-policy allkeys-lru

# 3. Identify and delete large keys
redis-cli --bigkeys

# 4. Scale up Redis instance
# AWS: Modify ElastiCache parameter group
aws elasticache modify-cache-cluster \
  --cache-cluster-id redis-prod \
  --cache-node-type cache.r6g.xlarge  # Larger instance
```

**If Network Disconnected:**
```bash
# 1. Verify network connectivity
ping redis-host

# 2. Check security group rules allow connection
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxx \
  --protocol tcp \
  --port 6379 \
  --source-security-group-id sg-app

# 3. Verify firewall rules
sudo ufw allow 6379/tcp
sudo firewall-cmd --permanent --add-port=6379/tcp
```

**If Using Backup/Replica:**
```bash
# 1. Failover to replica
# AWS ElastiCache: Initiate Multi-AZ failover
aws elasticache test-failover --replication-group-id redis-prod

# 2. For Redis Cluster:
redis-cli CLUSTER FAILOVER

# 3. Update application connection string
# Set REDIS_URL to replica endpoint
export REDIS_URL="redis://replica-host:6379"
```

### Verification

```bash
# 1. Confirm Redis is accessible
redis-cli PING

# 2. Test basic operations
redis-cli SET test_key "test_value"
redis-cli GET test_key

# 3. Check connection pool status
redis-cli INFO clients | grep connected_clients

# 4. Verify notification queue operations
redis-cli -n 1 LLEN notification:queue:email

# 5. Monitor application logs for Redis errors
docker logs notification-service | grep -i redis | head -20
```

### Prevention Tips

- **Enable Redis persistence:** Configure RDB + AOF for durability
- **Use Redis Sentinel:** Automatic failover for single-instance deployments
- **Monitor key metrics:** Set up alerts for memory usage > 80%, connection count > 80% max
- **Implement connection pooling:** Use libraries like redis-pool with reasonable pool size
- **Regular backups:** Daily snapshots of Redis data to S3
- **Load testing:** Test redis failover scenarios monthly

### Escalation Path

| Condition | Action |
|-----------|--------|
| Redis offline > 2 min | Page on-call DevOps engineer |
| Data loss suspected | Trigger restore from backup (RTO: 15 min) |
| Multiple replicas failing | Initiate incident response; review infrastructure |

---

## 3. High Failure Rate (> 20 jobs/hour)

**Alert:** `notification_job_failure_rate > 0.2 per_minute` or `failed_jobs_per_hour > 20`

### Symptoms
- Spike in failed notification jobs
- Users not receiving emails/SMS/push notifications
- Error logs flooded with failure messages
- Queue depth increasing (jobs not being processed)
- Alerting dashboard showing red

### Immediate Diagnosis

```bash
# Check current failure rate
curl -s http://localhost:3000/api/health/notifications | jq '.metrics.job_failure_rate'

# Count recent failed jobs (last hour)
docker logs notification-service --since 1h | grep -c "Job failed\|ERROR"

# Check specific failure types
docker logs notification-service --since 1h | grep "ERROR" | cut -d':' -f3 | sort | uniq -c | sort -rn

# View failed job details in Redis
redis-cli -n 1 LRANGE notification:queue:failed:email 0 -10

# Check if specific dependencies are down
curl -s https://www.google.com/url?=status  # Gmail status
curl -s https://status.supabase.com  # Supabase status
```

### Root Cause Investigation

**Step 1: Identify Error Type**
```bash
# Sample recent failures
redis-cli -n 1 LPOP notification:queue:failed:email | jq '.error'

# Get failure breakdown by type
docker logs notification-service --since 1h | \
  grep "ERROR" | \
  sed 's/.*ERROR: //' | \
  cut -d' ' -f1 | \
  sort | uniq -c

# Common error patterns:
# - "Gmail 401" = Authentication failed
# - "Gmail 429" = Rate limited
# - "ECONNREFUSED" = Dependency down
# - "Timeout" = Slow response from dependency
```

**Step 2: Check External Dependencies**
```bash
# Test Gmail API connectivity
curl -X GET https://www.googleapis.com/gmail/v1/users/me/profile \
  -H "Authorization: Bearer $GMAIL_ACCESS_TOKEN" -w "\nHTTP Status: %{http_code}\n"

# Test Supabase connectivity
curl -X GET https://PROJECT_ID.supabase.co/auth/v1/user \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" -w "\nHTTP Status: %{http_code}\n"

# Test database connectivity
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1"

# Check third-party status pages
curl -s https://www.google.com/status?hl=en  # Gmail status
curl -s https://status.supabase.com           # Supabase status
```

**Step 3: Check Job Queue Configuration**
```bash
# View queue depth
redis-cli -n 1 LLEN notification:queue:email

# Check retry configuration
docker exec notification-service env | grep -i retry

# View queue stats
redis-cli -n 1 INFO stats
```

**Step 4: Review Application Logs**
```bash
# Get error traceback
docker logs notification-service --since 1h --until 30m | grep -A 5 "ERROR"

# Check for pattern in failures
docker logs notification-service --since 1h | \
  grep -E "user_id|job_id|error" | \
  head -50
```

### Resolution Steps

**If Gmail API Authentication Failed (401):**
```bash
# 1. Verify access token is still valid
curl -X GET https://www.googleapis.com/oauth2/v1/tokeninfo \
  -d "access_token=$GMAIL_ACCESS_TOKEN"

# 2. Refresh access token
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&refresh_token=$REFRESH_TOKEN&grant_type=refresh_token"

# 3. Update service credentials
kubectl set env deployment/notification-service \
  GMAIL_ACCESS_TOKEN="$NEW_TOKEN" \
  GMAIL_REFRESH_TOKEN="$NEW_REFRESH_TOKEN"

# 4. Verify jobs start succeeding
watch -n 5 'docker logs notification-service --since 1m | grep -c "Email sent"'
```

**If Gmail API Rate Limited (429):**
```bash
# 1. Reduce concurrency
docker set env deployment/notification-service EMAIL_CONCURRENCY=5

# 2. Implement exponential backoff
kubectl set env deployment/notification-service \
  RETRY_BASE_DELAY_MS=1000 \
  RETRY_MAX_DELAY_MS=60000

# 3. Spread sends across time windows
# Modify batch processing to stagger sends

# 4. Request quota increase from Google Cloud Console
```

**If Supabase Database Connection Issue:**
```bash
# 1. Verify database is accessible
psql -h $DB_HOST -U $DB_USER -c "SELECT NOW();"

# 2. Check for connection pool exhaustion
# Query pg_stat_activity
psql -c "SELECT count(*) as connection_count FROM pg_stat_activity;"

# 3. Restart connection pool
# Or scale up max connections in RDS parameter group

# 4. Test retry mechanism
# Application should automatically retry after delay
```

**If Network/Timeout Issues:**
```bash
# 1. Increase timeout values
kubectl set env deployment/notification-service \
  GMAIL_TIMEOUT_MS=30000 \
  DB_TIMEOUT_MS=10000

# 2. Scale up service resources
kubectl set resources deployment/notification-service \
  --requests=cpu=500m,memory=512Mi \
  --limits=cpu=1000m,memory=1024Mi

# 3. Add service replicas for load distribution
kubectl scale deployment/notification-service --replicas=3
```

**Enable Circuit Breaker (If Dependencies Critically Failing):**
```bash
# 1. Enable circuit breaker mode
kubectl set env deployment/notification-service \
  CIRCUIT_BREAKER_ENABLED=true \
  CIRCUIT_BREAKER_FAILURE_THRESHOLD=50 \
  CIRCUIT_BREAKER_TIMEOUT_MS=60000

# 2. Temporarily pause email sends to failing services
# Route to fallback queue or dead letter queue

# 3. Implement graceful degradation
# Continue with other notification types (in-app, push)
```

### Verification

```bash
# 1. Monitor failure rate in real-time
watch -n 5 'curl -s http://localhost:3000/api/health/notifications | jq ".metrics.job_failure_rate"'

# 2. Verify successful jobs are processing
watch -n 5 'docker logs notification-service --since 1m | grep "Email sent" | wc -l'

# 3. Check queue depth is decreasing
watch -n 5 'redis-cli -n 1 LLEN notification:queue:email'

# 4. Tail error logs for new failures
docker logs notification-service -f --since 1m | grep ERROR

# 5. Run synthetic test
curl -X POST http://localhost:3000/api/notifications/send \
  -H "Content-Type: application/json" \
  -d '{"type":"email","user_id":"test","template":"task_created"}'
```

### Prevention Tips

- **Set failure rate alerts:** Trigger at > 0.5% failure rate
- **Implement circuit breakers:** Fail fast when dependencies are unhealthy
- **Use dead letter queues:** Separate persistent failures for manual investigation
- **Monitor dependency health:** Proactively check Gmail/Supabase status
- **Test external integrations:** Synthetic monitoring of Gmail, Supabase endpoints
- **Implement retry strategies:** Exponential backoff for transient failures
- **Alert on queue depth:** Alert if queue grows > 100 jobs

### Escalation Path

| Condition | Action |
|-----------|--------|
| Failure rate > 10% | Page on-call engineer within 5 min |
| All notifications failing | SEV1 incident; engage backend team + dependent teams |
| Persistent after 15 min | Review if graceful degradation needed |

---

## 4. RLS (Row-Level Security) Policy Violation

**Alert:** `postgres_rls_violation` or application logs: `RLS policy violation`

### Symptoms
- Users seeing data they shouldn't access
- RLS policy denying legitimate requests
- Application returning 403 Forbidden on valid operations
- Logs showing `new row violates row-level security policy`
- Security audit alerts triggered

### Immediate Diagnosis

```bash
# 1. Check RLS policy violation logs
docker logs notification-service | grep -i "RLS\|row-level security" | tail -20

# 2. Get detailed error from Supabase
# Check Supabase dashboard > Logs > Postgres section

# 3. Verify RLS is enabled
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT tablename FROM pg_tables WHERE schemaname='public' \
  AND pg_relation_exists(('public.' || tablename)::regclass);"

# 4. Identify which table/policy is blocking
# From error logs: "policy \"policy_name\" on table \"table_name\" violates"

# 5. Get current user context
psql -c "SELECT current_user, current_setting('app.current_user_id');"

# 6. Check session variables set
SELECT * FROM pg_settings WHERE name LIKE 'app.%';
```

### Root Cause Investigation

**Step 1: Review RLS Policies**
```bash
# Get all RLS policies for a specific table
psql -c "SELECT * FROM pg_policies WHERE tablename = 'notifications';"

# Get policy definition
psql -c "SELECT pg_get_policy_expr(oid, 'USING') \
  FROM pg_policy WHERE polname = 'policy_name';"

# Common policy types:
# - SELECT (USING clause) - controls what users can read
# - INSERT (WITH CHECK) - controls what users can write
# - UPDATE (USING + WITH CHECK) - controls what can be modified
# - DELETE (USING clause) - controls what can be deleted
```

**Step 2: Identify Affected User/Request**
```bash
# Get user ID from failed request logs
docker logs notification-service | \
  grep "RLS.*violation" | \
  grep -oP 'user_id["\s:]+\K[^",\s]+' | \
  head -5

# Check what user_id context was set
# In application code:
# await client.rpc('set_auth_context', { user_id: userId })

# Verify context was actually set in session
SELECT current_setting('app.current_user_id');
```

**Step 3: Test Policy Against User**
```bash
# Simulate the failing query with user context
psql -h $DB_HOST -U $DB_USER -d $DB_NAME

-- Set user context
SELECT set_config('app.current_user_id', 'USER_ID_HERE', false);

-- Try the failing operation
SELECT * FROM notifications WHERE user_id = current_setting('app.current_user_id')::uuid;

-- Check actual policy logic
SELECT * FROM pg_policies WHERE tablename = 'notifications';
```

**Step 4: Verify User Permissions**
```bash
# Check user exists and has correct role
SELECT * FROM auth.users WHERE id = 'USER_ID';

# Check role assignments
SELECT * FROM auth.user_roles WHERE user_id = 'USER_ID';

# Verify custom claims in JWT token
# Check token in app: localStorage.getItem('sb-auth-token')
# Decode at jwt.io to see claims
```

### Resolution Steps

**If Policy Logic is Incorrect:**
```bash
# 1. Review the policy that's blocking
psql -c "SELECT * FROM pg_policies WHERE tablename = 'notifications' AND polname = 'select_own_notifications';"

# 2. Fix the policy
psql -d $DB_NAME -c "
DROP POLICY IF EXISTS select_own_notifications ON notifications;

CREATE POLICY select_own_notifications ON notifications
  FOR SELECT
  USING (user_id = auth.uid());
"

# 3. Test the fix
SELECT * FROM notifications WHERE user_id = auth.uid();

# 4. Verify no errors in logs
docker logs notification-service --since 1m | grep -i rls
```

**If User Session Context Not Set:**
```bash
# 1. Add debugging to application code
// Before querying Supabase:
const userId = session.user.id;
console.log('Setting auth context for user:', userId);
await supabaseClient.rpc('set_auth_context', { user_id: userId });

// Verify it was set:
const { data } = await supabaseClient.rpc('get_auth_context');
console.log('Auth context is:', data);

# 2. Restart application after fix
docker-compose restart app
```

**If User Lacks Required Role/Permission:**
```bash
# 1. Grant proper role to user
psql -c "
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;
"

# 2. Update user role assignment
-- In auth.user_roles table or custom users table
UPDATE user_roles SET role = 'user' WHERE user_id = 'USER_ID';

# 3. Clear session cache and re-authenticate
-- User logs out and back in to refresh JWT
```

**If Policy is Too Restrictive:**
```bash
# 1. Review intended access pattern
# Example: Should admin see all users' notifications?
# Should API service account access any user's data?

# 2. Create broader policy for admin/service roles
psql -c "
CREATE POLICY admin_view_all_notifications ON notifications
  FOR SELECT
  USING (
    -- Allow if current user is admin
    auth.jwt() ->> 'role' = 'admin'
    OR
    -- Or if accessing own notifications
    user_id = auth.uid()
  );
"

# 3. Test with different user roles
```

**If Cross-Tenant Data Access Issue:**
```bash
# 1. Verify organization_id is included in policy
psql -c "
SELECT * FROM pg_policies 
WHERE tablename = 'notifications' 
AND pg_get_policy_expr(oid, 'USING') LIKE '%organization_id%';
"

# 2. Fix policy to include tenant isolation
psql -c "
DROP POLICY IF EXISTS select_org_notifications ON notifications;

CREATE POLICY select_org_notifications ON notifications
  FOR SELECT
  USING (
    organization_id = (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );
"
```

### Verification

```bash
# 1. Test operations from application UI
# As different users, verify:
# - User A cannot see User B's notifications
# - Admin can see all notifications
# - Service accounts can read batch operations

# 2. Run integration tests
npm run test:integration -- --grep "RLS"

# 3. Check logs for any lingering RLS violations
docker logs notification-service --since 5m | grep -i rls

# 4. Verify audit trail
SELECT * FROM audit_log WHERE table_name = 'notifications' 
  AND action = 'deny' ORDER BY created_at DESC LIMIT 10;
```

### Prevention Tips

- **Test RLS policies:** Write unit tests for each RLS policy against different user roles
- **Code review policies:** All RLS policy changes require security review
- **Log violations:** Enable query logging for RLS violations
- **Regular audits:** Monthly review of who can access what data
- **CI/CD validation:** Test policies automatically on each deployment
- **Role-based testing:** Synthetic tests as different user roles
- **Documentation:** Document intent of each RLS policy

### Escalation Path

| Condition | Action |
|-----------|--------|
| User seeing unauthorized data | IMMEDIATE LOCKDOWN: Disable policy, page security team |
| Persistent policy failures | Investigate database state; potential data corruption |
| Widespread violations (> 100) | SEV1 incident; potential security breach |

---

## 5. High API Latency (Response > 500ms)

**Alert:** `api_response_time_p99_ms > 500` or `endpoint_latency_p95_ms > 500`

### Symptoms
- API requests taking > 500ms to respond
- Users seeing slow page loads
- Application timeouts (especially on mobile)
- CPU or memory spikes on API servers
- Database query times increasing

### Immediate Diagnosis

```bash
# 1. Check current latency metrics
curl -s http://localhost:3000/api/health/metrics | jq '.http_latency_p99_ms'

# 2. Identify slowest endpoints
docker logs notification-service --since 30m | grep "duration_ms" | sort -t= -k2 -n | tail -10

# 3. Check API request traces
# From APM tool (Datadog/New Relic):
# GET /api/notifications - p99: 1200ms, p95: 800ms
# POST /api/notifications/send - p99: 2500ms

# 4. Monitor CPU and memory
docker stats notification-service

# 5. Check database connection pool
redis-cli INFO clients
psql -c "SELECT count(*) FROM pg_stat_activity;"
```

### Root Cause Investigation

**Step 1: Profile Slow Endpoints**
```bash
# Get slow query logs
docker logs notification-service --since 1h | \
  grep "duration_ms" | \
  awk -F'duration_ms=' '{print $2}' | \
  sort -n | tail -20

# Trace individual slow request
# Extract request ID from logs and follow call path

# Check if specific endpoint is slow
# Use curl with timing breakdown:
curl -w "
  time_namelookup:  %{time_namelookup}
  time_connect:     %{time_connect}
  time_appconnect:  %{time_appconnect}
  time_pretransfer: %{time_pretransfer}
  time_starttransfer: %{time_starttransfer}
  time_total:       %{time_total}
" -o /dev/null -s -X POST http://localhost:3000/api/notifications/send
```

**Step 2: Analyze Database Query Performance**
```bash
# Get slow query log
tail -100 /var/log/postgresql/postgresql.log | grep "duration:" | sort -k5 -n

# Run EXPLAIN ANALYZE on potentially slow queries
EXPLAIN ANALYZE SELECT * FROM notifications 
  WHERE user_id = 'USER_ID' 
  ORDER BY created_at DESC LIMIT 10;

# Check for missing indexes
SELECT * FROM pg_stat_user_tables 
  WHERE seq_scan > 1000 AND idx_scan < seq_scan / 10;

# Get table and index sizes
SELECT schemaname, tablename, 
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

**Step 3: Check Resource Utilization**
```bash
# CPU usage
top -b -n 1 | head -20

# Memory usage
free -h

# Disk I/O (if using RDS)
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ReadIOPS \
  --dimensions Name=DBInstanceIdentifier,Value=postgres-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 --statistics Average
```

**Step 4: Check External Service Latency**
```bash
# Gmail API latency
time curl -X GET https://www.googleapis.com/gmail/v1/users/me/profile \
  -H "Authorization: Bearer $TOKEN"

# Supabase API latency
time curl -X GET https://PROJECT_ID.supabase.co/rest/v1/notifications \
  -H "Authorization: Bearer $KEY" \
  -H "Accept: application/vnd.pgrst.object+json"
```

### Resolution Steps

**If Database Queries are Slow:**
```bash
# 1. Add missing index
CREATE INDEX CONCURRENTLY idx_notifications_user_created 
  ON notifications(user_id, created_at DESC);

# 2. Analyze query plan and optimize
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM notifications 
  WHERE user_id = 'USER_ID' ORDER BY created_at DESC LIMIT 10;

# 3. Consider query rewrite
-- Instead of complex join, use simpler queries + application logic
SELECT id, title FROM notifications WHERE user_id = $1;
-- Then fetch template separately if needed

# 4. Enable query result caching (if applicable)
-- Cache notification list in Redis for 5 minutes
redis-cli SET "notifications:$user_id" "$json" EX 300
```

**If API Service Resource Constrained:**
```bash
# 1. Increase resource limits
kubectl set resources deployment/notification-service \
  --requests=cpu=1000m,memory=1Gi \
  --limits=cpu=2000m,memory=2Gi

# 2. Scale up replicas
kubectl scale deployment/notification-service --replicas=5

# 3. Enable horizontal pod autoscaling
kubectl autoscale deployment notification-service \
  --min=3 --max=10 --cpu-percent=70

# 4. Implement response caching
# Add Cache-Control headers to responses
```

**If Database Connection Pool Exhausted:**
```bash
# 1. Increase connection pool size
# Edit connection string or config:
DATABASE_POOL_SIZE=20
DATABASE_POOL_MAX_OVERFLOW=10

# 2. Restart service to apply
docker-compose restart notification-service

# 3. Monitor actual connections
psql -c "SELECT sum(numbackends) FROM pg_stat_database;"

# 4. Consider using PgBouncer for connection pooling
# Install PgBouncer between app and database
```

**If External Service Latency is Issue:**
```bash
# 1. Implement timeout
# Gmail timeout: 5s, with retry
GMAIL_TIMEOUT_MS=5000
GMAIL_RETRY_ATTEMPTS=2

# 2. Add response caching
# Cache Gmail profile info for 1 hour
CACHE_EXTERNAL_RESPONSES=true
CACHE_TTL_MS=3600000

# 3. Use fallback/degraded mode
// If Gmail slow, skip some enrichment
if (latency > 3000) {
  sendNotificationWithoutGmailData()
}

# 4. Implement circuit breaker
// Stop calling Gmail if it's consistently slow
if (failureCount > threshold) {
  skipGmailIntegration()
}
```

### Verification

```bash
# 1. Monitor latency in real-time
watch -n 5 'curl -s http://localhost:3000/api/health/metrics | jq ".http_latency_p99_ms"'

# 2. Test specific endpoint performance
for i in {1..10}; do
  time curl -s -X POST http://localhost:3000/api/notifications/send \
    -H "Content-Type: application/json" \
    -d '{"type":"email","user_id":"test"}'
done | grep real

# 3. Check database query times improved
watch -n 5 'tail -20 /var/log/postgresql/postgresql.log | grep duration | tail -3'

# 4. Verify no new errors in logs
docker logs notification-service --since 5m | grep -i error
```

### Prevention Tips

- **Monitor query performance:** Enable pgBadger or Datadog PostgreSQL integration
- **Regular index analysis:** Monthly review of missing/unused indexes
- **Load testing:** Simulate peak traffic; identify bottlenecks before production
- **Set latency SLOs:** Aim for p99 < 200ms, p95 < 100ms
- **Cache strategically:** Cache external API responses and frequent queries
- **Database tuning:** Regular ANALYZE and VACUUM on large tables
- **Monitor top endpoints:** Track performance of most-called endpoints

### Escalation Path

| Condition | Action |
|-----------|--------|
| Latency > 1s affecting users | Page on-call backend engineer |
| Cascading slowdown (> 50% endpoints) | Potential database issue; check database team |
| Persistent despite scaling | Deep investigation needed; engage infrastructure team |

---

## 6. Queue Backlog (Depth > 100 jobs)

**Alert:** `notification_queue_depth > 100` or `queue_backlog_minutes > 5`

### Symptoms
- Notification queue Redis list growing
- Emails/notifications delayed by many minutes
- Queue consumers not processing jobs fast enough
- Redis memory usage increasing
- Job age in queue continuously increasing

### Immediate Diagnosis

```bash
# 1. Check queue depth
redis-cli -n 1 LLEN notification:queue:email
redis-cli -n 1 LLEN notification:queue:sms
redis-cli -n 1 LLEN notification:queue:push

# 2. Get queue age (oldest job)
# Assuming jobs have timestamps
redis-cli -n 1 LINDEX notification:queue:email -1 | jq '.created_at'

# 3. Check processing rate
# Count jobs processed in last minute
docker logs notification-service --since 1m | grep -c "Job completed"

# 4. Calculate backlog time
# If 20 jobs/minute rate and 200 jobs in queue = 10 minute backlog

# 5. Check Redis memory usage
redis-cli INFO memory | grep used_memory_human

# 6. Monitor service health
curl -s http://localhost:3000/api/health/notifications | jq '.status'
```

### Root Cause Investigation

**Step 1: Identify Processing Bottleneck**
```bash
# Check if consumers are running
docker ps | grep notification-service

# Get job processing metrics
docker logs notification-service --since 30m | grep "Job" | tail -20

# Is processing stalled?
docker logs notification-service --since 2m | grep -c "Job completed"
# If 0, processing stalled

# Check for processing errors
docker logs notification-service --since 30m | grep "ERROR" | wc -l
```

**Step 2: Check Consumer Configuration**
```bash
# Get current concurrency setting
docker exec notification-service env | grep -i concurrency

# Check if workers are busy
# Each worker should be processing a job
docker logs notification-service --since 30m | grep "WORKER_ID" | sort | uniq -c

# Verify all queue consumers started
docker logs notification-service --since 30m | grep "Starting.*consumers"
```

**Step 3: Analyze External Service Latency**
```bash
# Is Gmail slow?
time curl -X GET https://www.googleapis.com/gmail/v1/users/me/profile \
  -H "Authorization: Bearer $TOKEN"

# Is Supabase slow?
time curl -X GET https://PROJECT_ID.supabase.co/rest/v1/users \
  -H "Authorization: Bearer $KEY"

# If external services are slow, that's the bottleneck
```

**Step 4: Check Failed Job Accumulation**
```bash
# Get failed jobs (they might be retried, slowing processing)
redis-cli -n 1 LLEN notification:queue:failed:email

# Sample recent failures
redis-cli -n 1 LPOP notification:queue:failed:email | jq '.error'

# Are failures accumulating faster than processing?
redis-cli -n 1 LLEN notification:queue:failed:email | \
  while sleep 10; do redis-cli -n 1 LLEN notification:queue:failed:email; done
```

### Resolution Steps

**If Processing Rate is Too Slow:**
```bash
# 1. Increase concurrency
kubectl set env deployment/notification-service \
  JOB_CONCURRENCY=50 \
  WORKER_COUNT=10

# 2. Scale up replicas (add more processing nodes)
kubectl scale deployment/notification-service --replicas=5

# 3. Monitor new processing rate
watch -n 5 'docker logs notification-service --since 1m | grep -c "Job completed"'

# 4. Calculate when backlog clears
# Current queue depth: 200
# New rate: 50 jobs/min
# ETA: 200 / 50 = 4 minutes
```

**If Redis Memory is High:**
```bash
# 1. Check memory usage breakdown
redis-cli --bigkeys

# 2. Delete old queued jobs (if safe)
# Be careful: only delete jobs that have been retried many times
redis-cli -n 1 LTRIM notification:queue:email 0 500  # Keep only newest 500

# 3. Increase Redis instance size
aws elasticache modify-cache-cluster \
  --cache-cluster-id redis-prod \
  --cache-node-type cache.r6g.xlarge

# 4. Enable Redis eviction policy
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

**If Specific Job Type is Causing Backlog:**
```bash
# 1. Identify problematic job type
redis-cli -n 1 LRANGE notification:queue:email 0 -1 | \
  jq '.template' | sort | uniq -c | sort -rn

# 2. If one template is problematic, prioritize others
# Create separate queues for different job types:
# - notification:queue:email:urgent (process first)
# - notification:queue:email:normal (process second)
# - notification:queue:email:bulk (process last)

# 3. Drain bulk jobs slowly to avoid overload
# Limit concurrency for bulk jobs to 5
```

**If External Service Latency is Bottleneck:**
```bash
# 1. Add timeout to external calls
# Don't wait forever for Gmail response
GMAIL_TIMEOUT_MS=5000
SUPABASE_TIMEOUT_MS=3000

# 2. Implement circuit breaker
# If Gmail consistently slow, skip it temporarily
CIRCUIT_BREAKER_ENABLED=true

# 3. Use fallback queue
// If Gmail fails:
moveToFallbackQueue(job)
continueProcessing()  // Process next job instead of retrying immediately

# 4. Reduce template complexity
// Fewer API calls = faster processing
```

**If Failures Prevent Progress:**
```bash
# 1. Move failed jobs to dead letter queue
redis-cli -n 1 RENAME notification:queue:failed:email \
  notification:queue:dlq:email

# 2. Continue processing good jobs
# Don't let failures block the queue

# 3. Investigate failures separately
redis-cli -n 1 LRANGE notification:queue:dlq:email 0 -1 | \
  jq '.error' | sort | uniq -c | sort -rn

# 4. Fix root cause of failures
# Re-enable failed job processing once fixed
```

### Verification

```bash
# 1. Monitor queue depth declining
watch -n 5 'echo "Queue depth: $(redis-cli -n 1 LLEN notification:queue:email)"'

# 2. Verify processing continuing
watch -n 5 'docker logs notification-service --since 1m | grep -c "Job completed"'

# 3. Check error rate not increasing
docker logs notification-service --since 5m | grep "ERROR" | wc -l

# 4. Monitor Redis memory
watch -n 5 'redis-cli INFO memory | grep used_memory_human'

# 5. Test end-to-end delivery
curl -X POST http://localhost:3000/api/notifications/send \
  -H "Content-Type: application/json" \
  -d '{...}' && echo "Job queued" && sleep 5 && \
  # Verify in logs that job completed within 5 seconds
```

### Prevention Tips

- **Set queue depth alerts:** Alert at > 50 jobs, critical at > 200
- **Monitor job age:** Alert if oldest job > 5 minutes old
- **Capacity planning:** Right-size concurrency based on peak load
- **Auto-scaling:** Set up horizontal pod autoscaling on queue depth
- **Separate queues:** Use different queues for different job types/priorities
- **Monitor external services:** Track Gmail/Supabase latency; adjust timeouts
- **Load testing:** Simulate peak load to find processing bottlenecks

### Escalation Path

| Condition | Action |
|-----------|--------|
| Queue > 500 jobs | Page on-call infrastructure engineer |
| Backlog > 30 minutes | Trigger incident; consider manual notification process |
| Processing completely stopped | SEV1; investigate service crashes |

---

## 7. High Error Rate (> 0.5%)

**Alert:** `error_rate_percent > 0.5` or `failed_requests > 50 per_minute`

### Symptoms
- Error logs rapidly growing
- Application returning 5xx errors to users
- Specific error types repeating
- Error rate dashboard showing red
- User-facing failures increasing

### Immediate Diagnosis

```bash
# 1. Get overall error rate
curl -s http://localhost:3000/api/health/metrics | jq '.error_rate_percent'

# 2. Count errors in last 5 minutes
docker logs notification-service --since 5m | grep -c "ERROR\|FATAL\|Exception"

# 3. Get error type breakdown
docker logs notification-service --since 5m | \
  grep "ERROR" | \
  grep -oP 'Error: \K[^;]*' | \
  sort | uniq -c | sort -rn

# 4. Check HTTP status codes
docker logs notification-service --since 5m | \
  grep -oP 'status_code=[0-9]+' | \
  sort | uniq -c | sort -rn

# 5. Get stack traces of recent errors
docker logs notification-service --since 5m | grep -A 5 "ERROR"
```

### Root Cause Investigation

**Step 1: Categorize Error Types**
```bash
# Get detailed error classification
docker logs notification-service --since 5m | grep ERROR | head -20

# Common error patterns and causes:
# - "ECONNREFUSED" = Dependency down (Gmail, Supabase)
# - "Timeout" = Slow external service
# - "ENOTFOUND" = DNS resolution failure
# - "401/403" = Authentication/authorization issue
# - "500" = Unhandled exception in application
# - "413" = Request too large
# - "429" = Rate limited
```

**Step 2: Check Specific Services**
```bash
# If many authentication errors (401/403)
docker logs notification-service --since 5m | grep -E "401|403|unauthorized"

# If many timeouts
docker logs notification-service --since 5m | grep -i "timeout"

# If many Gmail errors
docker logs notification-service --since 5m | grep -i "gmail"

# If many database errors
docker logs notification-service --since 5m | grep -i "postgres\|database"
```

**Step 3: Check External Service Health**
```bash
# Gmail status
curl -s https://www.google.com/status?hl=en | grep -i gmail

# Supabase status
curl -s https://status.supabase.com | jq '.page.status_description'

# Application database
psql -h $DB_HOST -U $DB_USER -c "SELECT 1;" && echo "Database OK"

# Redis
redis-cli PING
```

**Step 4: Review Recent Changes**
```bash
# Get recent deployments
kubectl rollout history deployment/notification-service | head -5

# Get current image version
kubectl get deployment notification-service -o jsonpath='{.spec.template.spec.containers[0].image}'

# Check if errors started after recent deployment
# Compare error rate before and after deployment
```

### Resolution Steps

**If Dependency is Down (Gmail, Supabase):**
```bash
# 1. Verify dependency status
curl -X GET https://www.googleapis.com/gmail/v1/users/me/profile \
  -H "Authorization: Bearer $TOKEN" -w "\nStatus: %{http_code}\n"

# 2. If Gmail is down, enable fallback
kubectl set env deployment/notification-service \
  FALLBACK_EMAIL_PROVIDER=sendgrid \
  SENDGRID_API_KEY=$SENDGRID_KEY

# 3. If Supabase is down, use cached data or fallback
CACHE_ENABLED=true
CACHE_TTL_MS=600000

# 4. Wait for dependency recovery or failover to backup
# Monitor recovery:
watch -n 10 'curl -s https://status.supabase.com | jq ".page.status_description"'
```

**If Authentication Token Expired:**
```bash
# 1. Refresh authentication tokens
# For Gmail:
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&refresh_token=$REFRESH_TOKEN&grant_type=refresh_token"

# 2. Update service credentials
kubectl set env deployment/notification-service \
  GMAIL_ACCESS_TOKEN="$NEW_TOKEN"

# 3. Restart service to pick up new token
kubectl rollout restart deployment/notification-service

# 4. Verify authentication succeeding
docker logs notification-service --since 1m | grep -i "401\|403"
```

**If Code Bug Introduced:**
```bash
# 1. Identify when errors started
# Check git log for recent changes
git log --oneline -20 | grep -E "notification|email"

# 2. Compare error rate before/after deployment
# If errors started with deployment X, rollback:
kubectl rollout undo deployment/notification-service --to-revision=$(previous-revision)

# 3. Verify errors drop after rollback
watch -n 5 'curl -s http://localhost:3000/api/health/metrics | jq ".error_rate_percent"'

# 4. Fix bug and deploy with better testing
# Add unit test for failing code path
# Run integration tests before deployment
```

**If Rate Limited by External Service:**
```bash
# 1. Verify rate limit status
docker logs notification-service --since 5m | grep "429\|rate.*limit"

# 2. Implement exponential backoff
kubectl set env deployment/notification-service \
  RETRY_BASE_DELAY_MS=1000 \
  RETRY_MAX_DELAY_MS=30000 \
  RETRY_ATTEMPTS=5

# 3. Add request queuing with delays
// Use job queue instead of direct API calls
// Space out requests over time

# 4. Request quota increase from provider
# Contact Gmail, Supabase support for higher limits
```

**If Unhandled Exception in Code:**
```bash
# 1. Get full stack trace
docker logs notification-service --since 5m | grep -A 10 "ERROR.*Exception"

# 2. Add error handling at the failing code line
// Before: dangerous operation
// After: try-catch with proper error message

try {
  await sendEmail()
} catch (error) {
  logger.error('Email send failed', { error, userId })
  // Graceful degradation
  moveToDeadLetterQueue(job)
}

# 3. Deploy fix
# Verify no new instances of error in logs

# 4. Monitor for regression
```

### Verification

```bash
# 1. Monitor error rate in real-time
watch -n 5 'curl -s http://localhost:3000/api/health/metrics | jq ".error_rate_percent"'

# 2. Verify specific error type no longer appearing
docker logs notification-service --since 5m | grep -c "ERROR.*[original_error_type]"

# 3. Check success rate improving
docker logs notification-service --since 5m | grep -c "Email sent\|Notification sent"

# 4. Run synthetic tests
for i in {1..20}; do
  curl -s -X POST http://localhost:3000/api/notifications/send \
    -H "Content-Type: application/json" \
    -d '{"type":"email","user_id":"test"}'
done | grep -c "success"
# Should see most return success

# 5. Monitor for new errors in logs
docker logs notification-service -f --since 1m | grep ERROR
```

### Prevention Tips

- **Error rate SLO:** Aim for < 0.1% error rate (99.9% success)
- **Error alerts:** Alert at 0.3%, critical at 0.7%
- **Error classification:** Automatically categorize errors by type
- **Dead letter queue:** Separate truly failed jobs for investigation
- **Synthetic monitoring:** Continuous tests of critical paths
- **Error reporting:** Send detailed errors to error tracking (Sentry, Rollbar)
- **Code review:** Require review of error handling logic

### Escalation Path

| Condition | Action |
|-----------|--------|
| Error rate > 1% | Page on-call engineer within 2 min |
| Error rate > 5% | SEV2 incident; engage team lead |
| Cascading errors | SEV1 incident; consider service shutdown |

---

## 8. Gmail API Degradation (< 99% availability)

**Alert:** `gmail_api_availability_percent < 99` or `gmail_api_status_code_5xx > 5 per_minute`

### Symptoms
- Gmail API returning 5xx errors (service unavailable)
- Elevated latency to Gmail API
- Email send failures increasing
- Gmail status page showing incident
- Intermittent email delivery failures

### Immediate Diagnosis

```bash
# 1. Check Gmail status page
curl -s "https://www.google.com/status?hl=en" | grep -i gmail

# 2. Test Gmail API connectivity
curl -X GET https://www.googleapis.com/gmail/v1/users/me/profile \
  -H "Authorization: Bearer $GMAIL_ACCESS_TOKEN" -v

# 3. Check error rate for Gmail calls
docker logs notification-service --since 30m | grep -i "gmail" | grep -c "ERROR\|5xx"

# 4. Monitor Gmail response times
docker logs notification-service --since 30m | grep "gmail" | grep -oP 'duration_ms=\K[0-9]+' | \
  awk '{sum+=$1; count++} END {print "Average: " sum/count "ms"}'

# 5. Verify authentication token is valid
curl -X GET https://www.googleapis.com/oauth2/v1/tokeninfo \
  -d "access_token=$GMAIL_ACCESS_TOKEN" | jq '.expires_in'

# 6. Check quota status
curl -s "https://www.googleapis.com/admin/directory/v1/admin/quota" \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN" | jq '.usageUnit'
```

### Root Cause Investigation

**Step 1: Verify Gmail Service Status**
```bash
# Check official Google Workspace status
curl -s https://status.supabase.com  # Use similar status page for Gmail if available
# OR manually check https://www.google.com/status

# Check if specific Gmail features are degraded
# - Gmail send API
# - Gmail read API
# - Gmail attachment handling

# Look for known issues/incidents
```

**Step 2: Analyze Gmail Error Patterns**
```bash
# Get all Gmail-related errors
docker logs notification-service --since 30m | grep -i "gmail"

# Breakdown by error code
docker logs notification-service --since 30m | \
  grep -i "gmail" | \
  grep -oP '(4[0-9]{2}|5[0-9]{2})' | \
  sort | uniq -c | sort -rn

# Common codes:
# - 500: Server error (Gmail service issue)
# - 503: Service unavailable (Gmail maintenance)
# - 429: Rate limited (quota exceeded)
# - 401/403: Authentication issue
```

**Step 3: Check Your Quota Usage**
```bash
# Check daily email send quota
# Gmail API typically has 100 recipients per day for apps

redis-cli -n 2 GET "gmail:quota:daily"  # Track sends per day
redis-cli -n 2 GET "gmail:quota:reset_time"

# If approaching quota, emails will be rejected
# Quota resets at midnight UTC
```

**Step 4: Analyze Success vs Failure Rate**
```bash
# Success rate for Gmail sends (last 30 min)
docker logs notification-service --since 30m | \
  grep -c "Email sent"  # Successful sends

# Failure rate for Gmail sends (last 30 min)
docker logs notification-service --since 30m | \
  grep -i "gmail.*error"  # Failed sends

# Calculate: success_rate = successful / (successful + failed)
```

### Resolution Steps

**If Gmail is in Incident Status (Google acknowledges):**
```bash
# 1. Wait for Google to resolve
# Check status page for ETA
curl -s https://www.google.com/status?hl=en | grep -A 5 "Gmail"

# 2. Implement fallback email provider meanwhile
kubectl set env deployment/notification-service \
  EMAIL_PROVIDER=fallback \
  FALLBACK_PROVIDER=sendgrid \
  SENDGRID_API_KEY=$SENDGRID_KEY

# 3. Queue emails for retry after Gmail recovers
# Store failed emails with retry_after timestamp

# 4. Notify affected users via in-app notification
// "Email delivery may be delayed due to Gmail service issue"

# 5. Monitor Google status page for recovery
watch -n 60 'curl -s https://www.google.com/status?hl=en | grep -A 3 "Gmail"'
```

**If Gmail Quota Exceeded:**
```bash
# 1. Check daily send count
redis-cli -n 2 GET "gmail:quota:daily"

# 2. Verify quota limit in Google Cloud Console
# Settings > APIs and Services > Gmail API > Quotas

# 3. Request quota increase
# Usually auto-approved if account in good standing
# https://console.cloud.google.com -> Gmail API -> Quotas -> Edit Quotas

# 4. Temporarily reduce send rate
kubectl set env deployment/notification-service \
  EMAIL_DAILY_LIMIT=100 \
  EMAIL_HOURLY_LIMIT=20

# 5. Prioritize critical emails only
// Send only high-priority notifications
// Queue lower-priority for next day

# 6. Wait for quota reset (midnight UTC)
```

**If Intermittent Gmail Failures (< 99% availability but Google says OK):**
```bash
# 1. Implement retry strategy with exponential backoff
kubectl set env deployment/notification-service \
  RETRY_ATTEMPTS=5 \
  RETRY_BASE_DELAY_MS=1000 \
  RETRY_MAX_DELAY_MS=60000

# 2. Add circuit breaker
// If Gmail fails 5 times in a row, stop trying
// Resume after 1 minute
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT_MS=60000

# 3. Use fallback for transient failures
// If Gmail returns 5xx, use SendGrid
FALLBACK_ON_5XX=true

# 4. Monitor Gmail availability
// Track success rate over time
// Alert if < 99%
```

**If Authentication Token Expired:**
```bash
# 1. Refresh the access token
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&refresh_token=$REFRESH_TOKEN&grant_type=refresh_token" \
  | jq '.access_token'

# 2. Update service with new token
kubectl set env deployment/notification-service \
  GMAIL_ACCESS_TOKEN="$NEW_TOKEN" \
  GMAIL_TOKEN_REFRESH_TIME="$(date +%s)"

# 3. Restart service
kubectl rollout restart deployment/notification-service

# 4. Verify authentication succeeding
docker logs notification-service --since 1m | grep -i "401\|unauthorized" | wc -l
# Should be 0
```

**If Network Connectivity Issue to Gmail:**
```bash
# 1. Test connectivity from pod
kubectl exec -it deployment/notification-service -- \
  nc -zv smtp.gmail.com 465

# 2. Test DNS resolution
kubectl exec -it deployment/notification-service -- \
  nslookup smtp.gmail.com

# 3. If DNS fails, check pod's DNS configuration
kubectl exec -it deployment/notification-service -- \
  cat /etc/resolv.conf

# 4. Check firewall/security group rules
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=notification-service-sg"

# 5. Add DNS servers if missing
# Edit pod spec to add dnsConfig:
# dnsPolicy: None
# dnsConfig:
#   nameservers:
#     - 8.8.8.8
#     - 8.8.4.4
```

### Verification

```bash
# 1. Verify Gmail API is responding
curl -s -w "Status: %{http_code}\n" \
  https://www.googleapis.com/gmail/v1/users/me/profile \
  -H "Authorization: Bearer $GMAIL_ACCESS_TOKEN"
# Should return 200

# 2. Test email send
curl -X POST http://localhost:3000/api/notifications/send \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email",
    "user_id": "test-user",
    "template": "test_email"
  }' && sleep 2 && \
# Check logs for successful send
docker logs notification-service --since 2m | grep "Email sent"

# 3. Monitor email delivery latency
watch -n 5 'docker logs notification-service --since 1m | grep "gmail.*duration_ms" | tail -5'

# 4. Verify no 5xx errors
docker logs notification-service --since 5m | grep -i "gmail.*5[0-9]{2}" | wc -l
# Should be 0

# 5. Check availability percentage
# Calculate: (successful_sends / total_sends) * 100
# Should be >= 99%
```

### Prevention Tips

- **Monitor Gmail status proactively:** Subscribe to Gmail status updates; integrate with alerting
- **Implement retry logic:** Exponential backoff for transient failures
- **Use circuit breaker:** Stop calling failing service to save resources
- **Have fallback provider:** Keep SendGrid/AWS SES as backup SMTP
- **Track availability:** Synthetic tests sending emails every 5 minutes
- **Quota tracking:** Monitor daily quota usage; alert at 80%
- **Rate limiting:** Spread emails over time; avoid quota spikes
- **Token refresh:** Auto-refresh OAuth tokens before expiry

### Escalation Path

| Condition | Action |
|-----------|--------|
| Gmail down < 30 min | Monitor; implement fallback provider |
| Gmail down > 1 hour | Escalate to Google Cloud support; notify customers |
| Repeated incidents | Investigate alternative email provider; reduce Gmail dependency |

---

## General Incident Response Procedures

### Severity Levels

| Level | Response Time | Description |
|-------|---------------|-------------|
| **SEV1** | 2 minutes | Critical: All notifications failing, data loss, security breach |
| **SEV2** | 5 minutes | Major: High error rate, significant latency, partial service degradation |
| **SEV3** | 15 minutes | Minor: Low error rate, minor performance issue, single user affected |

### Initial Response Steps (All Incidents)

1. **Confirm Issue**
   ```bash
   curl -s http://localhost:3000/api/health/notifications | jq '.status'
   ```

2. **Notify Team**
   - Page on-call engineer (if SEV1/SEV2)
   - Post in #incidents Slack channel

3. **Collect Diagnostics**
   ```bash
   # Capture logs for investigation
   docker logs notification-service > /tmp/notification-logs-$(date +%s).txt
   
   # Capture metrics
   curl -s http://localhost:3000/api/health/metrics > /tmp/metrics-$(date +%s).json
   ```

4. **Identify Runbook**
   - Match symptoms to corresponding runbook above
   - Follow diagnosis and resolution steps

5. **Execute Resolution**
   - Document all commands run
   - Get confirmation before any destructive operations

6. **Verify Fix**
   - Run verification steps from runbook
   - Confirm users are not affected

7. **Post-Incident**
   - Document root cause
   - Schedule post-mortem if SEV1/SEV2
   - Create follow-up tasks for prevention

### Communication Template

```
INCIDENT: [Title - max 10 words]
SEVERITY: [SEV1/SEV2/SEV3]
STARTED: [Time]
RUNBOOK: [Name of runbook]

SYMPTOMS:
- [symptom 1]
- [symptom 2]

ROOT CAUSE:
[Investigation findings]

RESOLUTION:
[Steps taken]

STATUS: RESOLVED / IN PROGRESS

ETA RESOLUTION: [Time estimate]
```

### Resources

- **Gmail Status:** https://www.google.com/status?hl=en
- **Supabase Status:** https://status.supabase.com
- **Monitoring Dashboard:** http://localhost:3000/api/health/notifications
- **Error Tracking:** [Sentry/Rollbar link]
- **On-Call Schedule:** [Link to calendar]
- **Runbook Index:** This document
