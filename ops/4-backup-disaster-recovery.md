# Backup & Disaster Recovery Procedures

**TaskFlow Notification System** | Version 1.0 | Last Updated: 2024

---

## Executive Summary

This document defines backup strategies, recovery objectives (RTOs), and runbooks for the TaskFlow Notification System. The system processes notifications across email, Slack, and in-app channels with Redis caching and Supabase persistence.

**Critical Assets:**
- Supabase PostgreSQL database (notifications, user preferences, audit logs)
- Redis cache (session state, notification queue, rate limits)
- Email templates and configuration
- Encrypted credentials and secrets

---

## 1. Backup Strategy

### 1.1 Database Backups (Supabase PostgreSQL)

**Frequency:** Daily automated snapshots
**Retention:** 30 days rolling window
**Strategy:** Point-in-time recovery enabled

```bash
# Supabase automatic backups (managed)
# Accessible via Supabase Dashboard > Database > Backups
# Manual backup trigger:
curl -X POST https://api.supabase.com/v1/projects/{PROJECT_ID}/database/backups \
  -H "Authorization: Bearer ${SUPABASE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"backup_type":"manual"}'

# List available backups
curl https://api.supabase.com/v1/projects/{PROJECT_ID}/database/backups \
  -H "Authorization: Bearer ${SUPABASE_API_TOKEN}"

# Export database for archival (weekly)
pg_dump \
  -h ${DB_HOST} \
  -U postgres \
  -d notification_system \
  --verbose \
  --format=custom \
  > backup/db-$(date +%Y%m%d).dump

# Compress and upload to S3
gzip backup/db-*.dump
aws s3 cp backup/db-*.dump.gz \
  s3://${BACKUP_BUCKET}/database/$(date +%Y/%m/%d)/ \
  --storage-class GLACIER
```

### 1.2 Redis Cache Backups

**Frequency:** Hourly RDB snapshots
**Retention:** 7 days
**Location:** Attached storage + S3 archive

```bash
# Enable AOF (Append-Only File) for durability
redis-cli CONFIG SET appendonly yes

# Force RDB snapshot
redis-cli BGSAVE

# Monitor snapshot progress
redis-cli LASTSAVE  # Returns timestamp of last save

# Backup RDB file to S3
aws s3 cp /var/lib/redis/dump.rdb \
  s3://${BACKUP_BUCKET}/redis/$(date +%Y%m%d-%H%M%S).rdb \
  --storage-class STANDARD_IA

# Automated hourly backup (cron)
# 0 * * * * /usr/local/bin/backup-redis.sh
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
redis-cli BGSAVE
sleep 5
aws s3 cp /var/lib/redis/dump.rdb \
  s3://${BACKUP_BUCKET}/redis/${TIMESTAMP}.rdb
# Keep only 7 days of backups
aws s3 rm s3://${BACKUP_BUCKET}/redis/ \
  --recursive \
  --exclude "*" \
  --include "*" \
  --older-than 7
```

### 1.3 Configuration & Secrets Backup

**Frequency:** On change (event-driven)
**Retention:** 90 days
**Encryption:** AES-256

```bash
# Backup encrypted .env files
tar -czf backup/secrets-$(date +%Y%m%d).tar.gz \
  /app/.env \
  /app/.env.production \
  /app/config/*.json

# Encrypt backup
openssl enc -aes-256-cbc \
  -in backup/secrets-$(date +%Y%m%d).tar.gz \
  -out backup/secrets-$(date +%Y%m%d).tar.gz.enc \
  -K ${BACKUP_ENCRYPTION_KEY} \
  -iv ${BACKUP_ENCRYPTION_IV}

# Upload to S3 with versioning
aws s3 cp backup/secrets-*.tar.gz.enc \
  s3://${BACKUP_BUCKET}/secrets/ \
  --sse aws:kms

# Backup database credentials
aws secretsmanager create-secret-version \
  --secret-id taskflow/db-credentials \
  --secret-string file://backup/db-credentials.json
```

### 1.4 Email Templates & Configuration

**Frequency:** Weekly snapshots
**Retention:** 52 weeks (1 year)
**Storage:** Git + S3

```bash
# Backup email templates from database
psql -h ${DB_HOST} -U postgres -d notification_system \
  -c "COPY (SELECT * FROM email_templates) TO STDOUT" > \
  backup/email-templates-$(date +%Y%m%d).sql

# Commit template changes to Git
cd /app
git add templates/
git commit -m "Backup: Email templates $(date +%Y%m%d)"
git push origin backup-$(date +%Y%m%d)

# Archive to S3
tar -czf backup/email-config-$(date +%Y%m%d).tar.gz \
  /app/templates/emails/*.html \
  /app/templates/emails/*.txt
aws s3 cp backup/email-config-*.tar.gz \
  s3://${BACKUP_BUCKET}/email-templates/
```

### 1.5 Audit Logs Backup

**Frequency:** Daily
**Retention:** 7 years (compliance requirement)
**Storage:** S3 Glacier

```bash
# Export audit logs (daily)
psql -h ${DB_HOST} -U postgres -d notification_system \
  -c "COPY (
    SELECT * FROM audit_logs 
    WHERE created_at > NOW() - INTERVAL '1 day'
    ORDER BY created_at
  ) TO STDOUT WITH CSV HEADER" > \
  backup/audit-logs-$(date +%Y%m%d).csv

# Compress
gzip backup/audit-logs-*.csv

# Upload to Glacier (long-term compliance)
aws s3 cp backup/audit-logs-*.csv.gz \
  s3://${BACKUP_BUCKET}/audit-logs/$(date +%Y/%m%d)/ \
  --storage-class GLACIER

# Verify integrity
aws s3 cp s3://${BACKUP_BUCKET}/audit-logs/$(date +%Y/%m%d)/audit-logs-*.csv.gz \
  backup/verify/ && \
gzip -d backup/verify/audit-logs-*.csv.gz && \
wc -l backup/verify/audit-logs-*.csv
```

### 1.6 Backup Health Monitoring

```bash
# Daily backup health check
#!/bin/bash
set -e

BACKUP_DATE=$(date +%Y%m%d)
BUCKET="s3://${BACKUP_BUCKET}"

# Check database backup exists
if ! aws s3 ls ${BUCKET}/database/ | grep ${BACKUP_DATE}; then
  echo "ALERT: Database backup missing for ${BACKUP_DATE}"
  exit 1
fi

# Check Redis backup exists
if ! aws s3 ls ${BUCKET}/redis/ | grep ${BACKUP_DATE}; then
  echo "ALERT: Redis backup missing for ${BACKUP_DATE}"
  exit 1
fi

# Check backup file sizes are reasonable
DB_SIZE=$(aws s3 ls ${BUCKET}/database/ | tail -1 | awk '{print $3}')
if [ ${DB_SIZE} -lt 10000000 ]; then  # Less than 10MB = suspicious
  echo "ALERT: Database backup size suspiciously small: ${DB_SIZE} bytes"
  exit 1
fi

echo "✓ All backups healthy for ${BACKUP_DATE}"
```

---

## 2. Recovery Objectives

### Recovery Time Objectives (RTO) & Recovery Point Objectives (RPO)

| Component | RTO | RPO | Priority |
|-----------|-----|-----|----------|
| Database (corruption) | 15 min | 1 hour | Critical |
| Database (data loss) | 30 min | 1 hour | Critical |
| Redis cache | 5 min | 5 min | High |
| Configuration | 10 min | 1 min | High |
| Email templates | 30 min | 24 hours | Medium |
| Full system outage | 30 min | 1 hour | Critical |
| Regional failure | 4 hours | 1 hour | High |

### SLO Commitments

- **Availability:** 99.9% (8.76 hours downtime/year)
- **Recovery Success Rate:** 99.5% (1 failed recovery per 200 attempts)
- **Backup Completeness:** 100% (zero missing backups)

---

## 3. Recovery Procedures

### 3.1 Database Recovery from Snapshots

**Scenario:** Database corruption, schema damage, or accidental deletions

**RTO:** 15 minutes | **RPO:** Last snapshot (typically < 1 hour)

#### Step 1: Assess Damage

```bash
# Check database integrity
psql -h ${DB_HOST} -U postgres -d notification_system \
  -c "SELECT datname, pg_database.oid FROM pg_database 
       WHERE datname = 'notification_system';"

# Run VACUUM ANALYZE to identify corruption
psql -h ${DB_HOST} -U postgres -d notification_system \
  -c "VACUUM ANALYZE;"

# Check for bloat
psql -h ${DB_HOST} -U postgres -d notification_system \
  -c "SELECT schemaname, tablename, round(100 * pg_relation_size(schemaname||'.'||tablename) / pg_total_relation_size(schemaname||'.'||tablename), 2) AS ratio 
       FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') 
       ORDER BY pg_relation_size(schemaname||'.'||tablename) DESC LIMIT 10;"
```

#### Step 2: Initiate Point-in-Time Recovery (PITR)

```bash
# Via Supabase Dashboard: Database > Backups > Restore
# Or via API:

curl -X POST https://api.supabase.com/v1/projects/{PROJECT_ID}/database/restore \
  -H "Authorization: Bearer ${SUPABASE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "backup_id": "'"${BACKUP_ID}"'",
    "restore_point_timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
  }'

# Monitor restore progress
curl https://api.supabase.com/v1/projects/{PROJECT_ID}/database/restore-status \
  -H "Authorization: Bearer ${SUPABASE_API_TOKEN}"
```

#### Step 3: Verify Recovery

```bash
# Test database connectivity
psql -h ${DB_HOST} -U postgres -d notification_system \
  -c "SELECT version();"

# Validate critical tables
psql -h ${DB_HOST} -U postgres -d notification_system << EOF
SELECT 'users' as table_name, COUNT(*) as row_count FROM users
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL
SELECT 'notification_preferences', COUNT(*) FROM notification_preferences
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs;
EOF

# Verify recent data integrity
psql -h ${DB_HOST} -U postgres -d notification_system \
  -c "SELECT COUNT(*) as recent_notifications 
       FROM notifications 
       WHERE created_at > NOW() - INTERVAL '24 hours';"

# Check for orphaned records
psql -h ${DB_HOST} -U postgres -d notification_system \
  -c "SELECT COUNT(*) FROM notifications 
       WHERE user_id NOT IN (SELECT id FROM users);"
```

#### Step 4: Failover & Resume Service

```bash
# Update application database connection string
kubectl set env deployment/notification-service \
  DB_HOST=${RECOVERED_DB_HOST} \
  -n production

# Verify application connectivity
kubectl exec -it \
  $(kubectl get pods -n production -l app=notification-service -o jsonpath='{.items[0].metadata.name}') \
  -n production \
  -- npm run healthcheck

# Monitor logs for connection errors
kubectl logs -f deployment/notification-service \
  -n production \
  --tail=100 | grep -i error

# Test API endpoints
curl -s http://notification-service:3000/health | jq .
curl -s http://notification-service:3000/api/notifications/test | jq .
```

### 3.2 Redis Cache Restoration

**Scenario:** Cache loss, corrupted cache, or Redis crash

**RTO:** 5 minutes | **RPO:** Latest RDB or AOF

#### Step 1: Stop Application Writes

```bash
# Enable maintenance mode
kubectl set env deployment/notification-service \
  MAINTENANCE_MODE=true \
  -n production

# Verify cache queue is drained
redis-cli INFO stats | grep total_commands_processed
redis-cli LLEN notification:queue  # Should be ~0
```

#### Step 2: Restore Redis from Backup

```bash
# Download latest RDB backup
aws s3 cp \
  $(aws s3 ls s3://${BACKUP_BUCKET}/redis/ --recursive | \
    sort -r | head -1 | awk '{print $NF}') \
  /tmp/dump.rdb.restore

# Verify backup integrity
file /tmp/dump.rdb.restore  # Should show 'data'

# Stop Redis service
systemctl stop redis-server
# or
kubectl delete pod redis-0 -n production

# Restore RDB file
sudo cp /tmp/dump.rdb.restore /var/lib/redis/dump.rdb
sudo chown redis:redis /var/lib/redis/dump.rdb
sudo chmod 644 /var/lib/redis/dump.rdb

# Start Redis
systemctl start redis-server
# or (wait for pod restart)
kubectl get pods redis-0 -n production -w
```

#### Step 3: Verify Cache State

```bash
# Connect to restored Redis
redis-cli

# Check data integrity
DBSIZE  # Should show reasonable key count
INFO stats  # Review loading time

# Verify critical keys exist
EXISTS user:session:*
EXISTS notification:queue
EXISTS rate:limit:*

# Check for any corruption
DEBUG OBJECT key_name  # Sample check on critical keys
```

#### Step 4: Resume Application

```bash
# Disable maintenance mode
kubectl set env deployment/notification-service \
  MAINTENANCE_MODE=false \
  -n production

# Monitor for errors during resume
kubectl logs -f deployment/notification-service \
  -n production \
  --tail=200 | grep -i error
```

### 3.3 Configuration Restoration

**Scenario:** Accidental config deletion or corruption

**RTO:** 10 minutes | **RPO:** < 1 minute

```bash
# List available configuration backups
aws s3 ls s3://${BACKUP_BUCKET}/secrets/ \
  --recursive \
  --human-readable

# Download specific backup
BACKUP_DATE="20240115"
aws s3 cp \
  s3://${BACKUP_BUCKET}/secrets/secrets-${BACKUP_DATE}.tar.gz.enc \
  /tmp/secrets-restore.tar.gz.enc

# Decrypt backup
openssl enc -aes-256-cbc -d \
  -in /tmp/secrets-restore.tar.gz.enc \
  -out /tmp/secrets-restore.tar.gz \
  -K ${BACKUP_ENCRYPTION_KEY} \
  -iv ${BACKUP_ENCRYPTION_IV}

# Extract and verify
tar -tzf /tmp/secrets-restore.tar.gz | head -10

# Restore .env files
tar -xzf /tmp/secrets-restore.tar.gz -C /app/

# Verify configuration is valid
npm run validate:config

# Restart affected services
kubectl rollout restart deployment/notification-service \
  -n production

# Confirm service is healthy
kubectl rollout status deployment/notification-service \
  -n production
```

### 3.4 Email Template Recovery

**Scenario:** Corrupted or deleted email templates

**RTO:** 30 minutes | **RPO:** 24 hours

```bash
# Restore from most recent backup
BACKUP_DATE=$(aws s3 ls s3://${BACKUP_BUCKET}/email-templates/ \
  --recursive | sort | tail -1 | awk '{print $NF}')

aws s3 cp \
  ${BACKUP_DATE} \
  /tmp/email-templates-restore.tar.gz

# Extract templates
tar -xzf /tmp/email-templates-restore.tar.gz -C /app/

# Verify template structure
find /app/templates/emails -name "*.html" -o -name "*.txt" | wc -l

# Restore to database if needed
psql -h ${DB_HOST} -U postgres -d notification_system \
  -f /app/scripts/restore-email-templates.sql

# Test template rendering
curl -X POST http://notification-service:3000/api/templates/preview \
  -H "Content-Type: application/json" \
  -d '{"template": "order_confirmation", "context": {}}'

# Clear any cached templates
redis-cli FLUSHDB 2  # Template cache DB
```

### 3.5 Full System Disaster Recovery

**Scenario:** Complete system failure, data center issue, or regional outage

**RTO:** 30 minutes | **RPO:** 1 hour

#### Phase 1: Assess Impact (2 min)

```bash
# Check all services status
kubectl get all -n production

# Verify backup integrity
aws s3 ls s3://${BACKUP_BUCKET}/ \
  --recursive \
  --human-readable | head -20

# Check DNS propagation
dig notification-api.example.com +short
dig notification-service.svc.cluster.local +short
```

#### Phase 2: Restore Infrastructure (10 min)

```bash
# Spin up new Kubernetes cluster in target region
gcloud container clusters create notification-system \
  --zone ${TARGET_ZONE} \
  --num-nodes 3 \
  --machine-type n1-standard-2

# Or use terraform:
terraform apply \
  -var="region=${TARGET_REGION}" \
  -var="backup_restore=true"

# Configure kubeconfig
gcloud container clusters get-credentials notification-system \
  --zone ${TARGET_ZONE}

# Verify cluster is ready
kubectl cluster-info
kubectl get nodes
```

#### Phase 3: Restore Data (12 min)

```bash
# Restore Supabase database (see Section 3.1)
# This is typically the longest step

# Restore Redis cache (see Section 3.2)

# Restore configuration (see Section 3.3)

# Verify all data is present
kubectl exec -it postgres-0 \
  -- psql -U postgres notification_system \
  -c "SELECT COUNT(*) as total_notifications FROM notifications;"
```

#### Phase 4: Deploy Application (5 min)

```bash
# Deploy application stack
helm install notification-system ./charts/notification-system \
  --namespace production \
  --values values-production.yaml \
  --set imageTag=${CURRENT_VERSION}

# Wait for rollout
kubectl rollout status deployment/notification-service \
  -n production

# Verify service endpoints
kubectl get svc -n production

# Health check endpoints
curl http://notification-service:3000/health
curl http://notification-service:3000/metrics
```

#### Phase 5: Traffic Failover (3 min)

```bash
# Update DNS (if not automated)
gcloud dns record-sets update notification-api.example.com \
  --rrdatas=${NEW_LB_IP} \
  --ttl=60 \
  --zone=example-com

# Verify DNS propagation
watch -n 2 "dig notification-api.example.com +short"

# Enable application load balancer
kubectl patch svc notification-service \
  -p '{"spec":{"type":"LoadBalancer"}}' \
  -n production

# Verify traffic is flowing
kubectl logs -f deployment/notification-service \
  -n production \
  --tail=50
```

#### Phase 6: Post-Recovery Validation (5 min)

```bash
# Run smoke tests
npm run test:smoke

# Monitor key metrics
kubectl top nodes
kubectl top pods -n production

# Check error rates
curl http://prometheus:9090/api/v1/query \
  --data-urlencode 'query=rate(notification_errors_total[5m])'

# Verify data consistency
psql -h ${NEW_DB_HOST} -U postgres -d notification_system << EOF
SELECT COUNT(*) as notification_count FROM notifications;
SELECT COUNT(*) as user_count FROM users;
SELECT COUNT(*) as preference_count FROM notification_preferences;
EOF
```

---

## 4. Disaster Scenarios & Response

### Scenario 1: Database Corruption

**Symptoms:**
- Deadlock errors in application logs
- Slow query performance degradation
- Application unable to INSERT/UPDATE records

**Response Timeline:**

| Time | Action |
|------|--------|
| T+0 min | Alert triggered → On-call engineer notified |
| T+2 min | Run integrity checks (VACUUM ANALYZE) |
| T+5 min | Decide: repair vs. restore decision |
| T+10 min | Begin PITR recovery (Section 3.1, Step 2) |
| T+20 min | Verify recovery, run smoke tests |
| T+30 min | Resume normal operations |

**Recovery Command:**
```bash
# Quick recovery initiation
curl -X POST https://api.supabase.com/v1/projects/${PROJECT_ID}/database/restore \
  -H "Authorization: Bearer ${SUPABASE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"backup_id":"'"${LATEST_BACKUP_ID}"'","restore_point_timestamp":"'"$(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ)"'"}'
```

---

### Scenario 2: Data Breach / Security Incident

**Symptoms:**
- Unauthorized access detected in audit logs
- Suspicious API activity patterns
- Credential compromise detected

**Response Timeline:**

| Time | Action |
|------|--------|
| T+0 min | Incident declared → Engage security team |
| T+5 min | Isolate affected services, enable audit logging |
| T+15 min | Forensic analysis: identify breach scope |
| T+30 min | Rotate all credentials and secrets |
| T+60 min | Optional: restore from pre-incident backup |
| T+120 min | Post-incident review, notify affected users |

**Immediate Actions:**

```bash
# 1. Rotate database credentials
aws secretsmanager rotate-secret \
  --secret-id taskflow/db-credentials

# 2. Rotate API keys
curl -X POST http://notification-service:3000/admin/api-keys/rotate \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"

# 3. Revoke compromised tokens
redis-cli FLUSHDB 5  # Session token cache

# 4. Enable enhanced audit logging
kubectl set env deployment/notification-service \
  AUDIT_LOG_LEVEL=DEBUG \
  -n production

# 5. Extract forensic data
psql -h ${DB_HOST} -U postgres -d notification_system \
  -c "COPY (SELECT * FROM audit_logs 
             WHERE created_at > NOW() - INTERVAL '24 hours'
             ORDER BY created_at DESC
      ) TO '/tmp/incident-audit.csv' WITH CSV HEADER"

# 6. Preserve evidence
tar -czf backup/forensics-$(date +%Y%m%d-%H%M%S).tar.gz \
  /tmp/incident-audit.csv \
  /app/logs/*.log

aws s3 cp backup/forensics-*.tar.gz \
  s3://${BACKUP_BUCKET}/forensics/
```

---

### Scenario 3: Complete System Failure

**Symptoms:**
- All services down (database, Redis, app unreachable)
- Cluster unhealthy or network partition
- Data center failure or regional outage

**Response Timeline:**

| Time | Action |
|------|--------|
| T+0 min | P1 incident declared → Full team paged |
| T+3 min | Assess scope (data center vs. app) |
| T+10 min | Spin up replacement infrastructure |
| T+20 min | Restore database from backup |
| T+25 min | Restore cache and config |
| T+30 min | Deploy application, validate health |

**Follow Section 3.5: Full System Disaster Recovery**

---

### Scenario 4: Credential Compromise

**Symptoms:**
- Unauthorized API access detected
- Database password exposed in logs/git
- Third-party service tokens leaked

**Response Timeline:**

| Time | Action |
|------|--------|
| T+0 min | Credential compromise confirmed |
| T+5 min | Revoke compromised credentials |
| T+10 min | Generate new credentials |
| T+15 min | Deploy new credentials to services |
| T+20 min | Monitor for unauthorized access attempts |

**Rotation Commands:**

```bash
# 1. Revoke Database Password
ALTER USER postgres WITH PASSWORD 'NEW_STRONG_PASSWORD_HERE';

# 2. Rotate API keys
./scripts/rotate-api-keys.sh

# 3. Update Kubernetes secrets
kubectl create secret generic db-credentials \
  --from-literal=username=postgres \
  --from-literal=password=$(openssl rand -base64 32) \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Restart services to pick up new secrets
kubectl rollout restart deployment/notification-service \
  -n production

# 5. Verify no auth errors
kubectl logs deployment/notification-service \
  -n production --tail=50 | grep -i auth
```

---

### Scenario 5: Regional Outage / Multi-AZ Failure

**Symptoms:**
- Entire region unreachable
- Multiple data center failures
- Network partition affecting all zones

**Response Timeline:**

| Time | Action |
|------|--------|
| T+0 min | Regional outage confirmed |
| T+5 min | Activate disaster recovery site |
| T+15 min | Spin up replacement infrastructure |
| T+45 min | Restore from backup |
| T+60 min | Validate system health |
| T+120 min | Failover DNS |

**Failover Commands:**

```bash
# 1. Verify all regional infrastructure is down
gcloud compute instances list --zones=us-central1-a,us-central1-b,us-central1-c

# 2. Activate DR site in different region
terraform apply \
  -var="primary_region=us-central1" \
  -var="disaster_recovery_region=us-east1" \
  -var="activate_dr=true"

# 3. Restore database from backup
# (See Section 3.1)

# 4. Wait for backup restore to complete
while ! psql -h ${DR_DB_HOST} -U postgres -d notification_system -c "SELECT 1"; do
  echo "Waiting for DB restore..."
  sleep 10
done

# 5. Update application configuration
kubectl set env deployment/notification-service \
  DB_HOST=${DR_DB_HOST} \
  REDIS_HOST=${DR_REDIS_HOST} \
  -n production

# 6. Verify connectivity
kubectl exec -it $(kubectl get pods -l app=notification-service -o jsonpath='{.items[0].metadata.name}') \
  -- npm run healthcheck

# 7. Update DNS (update TTL first for faster failover)
gcloud dns record-sets update notification-api.example.com \
  --ttl=60 \
  --zone=example-com

# Finally update IP
gcloud dns record-sets update notification-api.example.com \
  --rrdatas=${DR_LB_IP} \
  --ttl=60 \
  --zone=example-com

# 8. Monitor for successful failover
watch -n 2 "dig notification-api.example.com +short"
```

---

## 5. Testing & Validation

### 5.1 Recovery Test Schedule

```
Monthly: Redis recovery test
Quarterly: Database backup test + PITR validation
Semi-annually: Full disaster recovery drill
Annually: Multi-region failover test
```

### 5.2 Monthly Redis Recovery Test

```bash
#!/bin/bash
# Monthly Redis recovery drill

set -e
TEST_DATE=$(date +%Y%m%d)
TEST_DIR="/tmp/dr-test-${TEST_DATE}"

mkdir -p ${TEST_DIR}/logs
exec 1> >(tee -a ${TEST_DIR}/logs/test.log)
exec 2>&1

echo "========== Redis Recovery Test: ${TEST_DATE} =========="

# 1. Create test data
echo "[1/5] Creating test data in Redis..."
redis-cli FLUSHDB 2  # Clear test DB
redis-cli SELECT 2
redis-cli SET test:key:1 "value-1"
redis-cli SET test:key:2 "value-2"
redis-cli LPUSH test:queue "item-1" "item-2" "item-3"

INITIAL_SIZE=$(redis-cli DBSIZE | grep keys | awk '{print $2}')
echo "  ✓ Created test data: ${INITIAL_SIZE} keys"

# 2. Backup
echo "[2/5] Creating backup..."
redis-cli BGSAVE
sleep 5
BACKUP_TIME=$(redis-cli LASTSAVE)
cp /var/lib/redis/dump.rdb ${TEST_DIR}/dump.rdb.backup
echo "  ✓ Backup created at ${BACKUP_TIME}"

# 3. Clear cache
echo "[3/5] Simulating data loss..."
redis-cli FLUSHDB 2
CLEARED_SIZE=$(redis-cli DBSIZE | grep keys | awk '{print $2}')
echo "  ✓ Cache cleared: ${CLEARED_SIZE} keys"

# 4. Restore
echo "[4/5] Restoring from backup..."
redis-cli SHUTDOWN NOSAVE
sleep 2
cp ${TEST_DIR}/dump.rdb.backup /var/lib/redis/dump.rdb
redis-server --daemonize yes
sleep 3
redis-cli SELECT 2

RESTORED_SIZE=$(redis-cli DBSIZE | grep keys | awk '{print $2}')
echo "  ✓ Restore complete: ${RESTORED_SIZE} keys"

# 5. Verify
echo "[5/5] Verifying restored data..."
redis-cli GET test:key:1 | grep -q "value-1" && echo "  ✓ Key 1 verified"
redis-cli GET test:key:2 | grep -q "value-2" && echo "  ✓ Key 2 verified"
QUEUE_LEN=$(redis-cli LLEN test:queue)
[ "${QUEUE_LEN}" -eq 3 ] && echo "  ✓ Queue verified (${QUEUE_LEN} items)"

if [ "${INITIAL_SIZE}" -eq "${RESTORED_SIZE}" ]; then
  echo ""
  echo "✅ PASS: Redis recovery test successful"
  echo "   - Data size matches: ${INITIAL_SIZE} == ${RESTORED_SIZE}"
  exit 0
else
  echo ""
  echo "❌ FAIL: Redis recovery test failed"
  echo "   - Data mismatch: ${INITIAL_SIZE} != ${RESTORED_SIZE}"
  exit 1
fi
```

### 5.3 Quarterly Database Backup Test

```bash
#!/bin/bash
# Quarterly database backup verification

set -e
TEST_DATE=$(date +%Y%m%d)
TEST_DIR="/tmp/db-recovery-test-${TEST_DATE}"

mkdir -p ${TEST_DIR}/logs
exec > >(tee -a ${TEST_DIR}/logs/test.log)
exec 2>&1

echo "========== Database Recovery Test: ${TEST_DATE} =========="

# 1. List available backups
echo "[1/4] Checking available backups..."
BACKUPS=$(curl -s https://api.supabase.com/v1/projects/${PROJECT_ID}/database/backups \
  -H "Authorization: Bearer ${SUPABASE_API_TOKEN}" | jq '.[] | .id')
BACKUP_COUNT=$(echo "${BACKUPS}" | wc -l)
echo "  ✓ Found ${BACKUP_COUNT} backups"

# 2. Restore to staging database
echo "[2/4] Restoring to staging database..."
LATEST_BACKUP=$(echo "${BACKUPS}" | head -1)
curl -X POST https://api.supabase.com/v1/projects/${PROJECT_ID}/database/restore \
  -H "Authorization: Bearer ${SUPABASE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"backup_id":"'"${LATEST_BACKUP}"'"}'

echo "  ⏳ Waiting for restore to complete (this may take 10+ minutes)..."
MAX_WAIT=1800  # 30 minutes
ELAPSED=0
while [ ${ELAPSED} -lt ${MAX_WAIT} ]; do
  STATUS=$(curl -s https://api.supabase.com/v1/projects/${PROJECT_ID}/database/restore-status \
    -H "Authorization: Bearer ${SUPABASE_API_TOKEN}" | jq -r '.status')
  
  if [ "${STATUS}" == "success" ]; then
    echo "  ✓ Restore complete"
    break
  elif [ "${STATUS}" == "failed" ]; then
    echo "  ❌ Restore failed"
    exit 1
  fi
  
  sleep 30
  ELAPSED=$((ELAPSED + 30))
  echo "    ... waiting (${ELAPSED}s)"
done

# 3. Validate restored data
echo "[3/4] Validating restored data..."
TABLE_CHECKS=(
  "SELECT COUNT(*) FROM users"
  "SELECT COUNT(*) FROM notifications"
  "SELECT COUNT(*) FROM notification_preferences"
  "SELECT COUNT(*) FROM audit_logs"
)

for CHECK in "${TABLE_CHECKS[@]}"; do
  RESULT=$(psql -h ${STAGING_DB_HOST} -U postgres -d notification_system \
    -t -c "${CHECK}")
  echo "  ✓ ${CHECK}: ${RESULT} rows"
done

# 4. Integrity checks
echo "[4/4] Running integrity checks..."

# Check for orphaned records
ORPHANED=$(psql -h ${STAGING_DB_HOST} -U postgres -d notification_system \
  -t -c "SELECT COUNT(*) FROM notifications WHERE user_id NOT IN (SELECT id FROM users)")
echo "  ✓ Orphaned notifications: ${ORPHANED}"

# Check data freshness
LATEST_NOTIFICATION=$(psql -h ${STAGING_DB_HOST} -U postgres -d notification_system \
  -t -c "SELECT MAX(created_at) FROM notifications")
echo "  ✓ Latest notification: ${LATEST_NOTIFICATION}"

# Check backup age
BACKUP_AGE=$(psql -h ${STAGING_DB_HOST} -U postgres -d notification_system \
  -t -c "SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 3600 FROM notifications")
echo "  ✓ Backup age: ${BACKUP_AGE} hours"

echo ""
echo "✅ PASS: Database backup verification successful"
```

### 5.4 Recovery Documentation & Runbooks

```bash
# Generate recovery runbook checklist
cat > ${TEST_DIR}/recovery-checklist.md << 'EOF'
# Recovery Procedure Checklist

## Pre-Recovery
- [ ] Incident severity level assigned
- [ ] On-call team paged
- [ ] Backup integrity verified
- [ ] Communication plan activated

## Database Recovery
- [ ] Damage assessment completed
- [ ] Backup identified and verified
- [ ] PITR initiated
- [ ] Restore progress monitored
- [ ] Data integrity validated
- [ ] Application connectivity tested

## Post-Recovery
- [ ] All services healthy
- [ ] Smoke tests passed
- [ ] Metrics and logs reviewed
- [ ] Incident documented
- [ ] Post-mortem scheduled

## Sign-off
- Date: ________________
- Recovered by: ________________________
- Verified by: ________________________
EOF

echo "  ✓ Checklist created: ${TEST_DIR}/recovery-checklist.md"
```

---

## 6. Communication Plan

### 6.1 Escalation & Notification

**Internal Escalation Path:**
1. T+0: On-call engineer (automated alert)
2. T+5: Team lead notified if RTO exceeded 5 min
3. T+10: Engineering manager notified
4. T+15: CTO notified if RTO exceeded 15 min
5. T+30: CEO/COO notified if customer-facing impact

**External Notification:**

```bash
#!/bin/bash
# External communication script

INCIDENT_TYPE="${1:?'Specify incident type'}"
IMPACT_LEVEL="${2:?'Specify: low|medium|high|critical'}"

# Update status page
curl -X POST https://api.statuspage.io/v1/pages/${STATUS_PAGE_ID}/incidents \
  -H "Authorization: OAuth oauth_token=\"${STATUSPAGE_TOKEN}\"" \
  -H "Content-Type: application/json" \
  -d '{
    "incident": {
      "name": "Notification System Outage",
      "status": "investigating",
      "impact": "'${IMPACT_LEVEL}'",
      "body": "We are investigating reports of notification service disruption. More updates to follow."
    }
  }'

# Notify customers (if relevant)
if [ "${IMPACT_LEVEL}" == "high" ] || [ "${IMPACT_LEVEL}" == "critical" ]; then
  aws sns publish \
    --topic-arn arn:aws:sns:us-east-1:ACCOUNT:notification-incidents \
    --message "Incident: ${INCIDENT_TYPE} - Impact: ${IMPACT_LEVEL}" \
    --subject "⚠️ Notification System Incident"
fi

# Post to incident channel
curl -X POST ${SLACK_INCIDENT_WEBHOOK} \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "🚨 *Incident Started*",
    "blocks": [
      {"type": "section", "text": {"type": "mrkdwn", "text": "*Type:* '"${INCIDENT_TYPE}"'"}},
      {"type": "section", "text": {"type": "mrkdwn", "text": "*Impact:* '"${IMPACT_LEVEL}"'"}},
      {"type": "section", "text": {"type": "mrkdwn", "text": "*Status:* Investigating"}},
      {"type": "section", "text": {"type": "mrkdwn", "text": "*Started:* '"$(date)"'"}}
    ]
  }'
```

### 6.2 Post-Incident Review Template

```markdown
# Post-Incident Review (PIR)

## Incident Summary
- **Date:** YYYY-MM-DD HH:MM UTC
- **Duration:** X hours Y minutes
- **Root Cause:** [Brief description]
- **Impact:** [Users affected, data affected]

## Timeline

| Time | Action | Owner |
|------|--------|-------|
| HH:MM | Event occurred | - |
| HH:MM | Alert triggered | - |
| HH:MM | Response started | - |
| HH:MM | Recovery initiated | - |
| HH:MM | Service restored | - |

## Root Cause Analysis

### What Happened
[Detailed description of events]

### Why It Happened
[Analysis of root cause]

### Contributing Factors
- [Factor 1]
- [Factor 2]

## Action Items

| Item | Owner | Due Date | Priority |
|------|-------|----------|----------|
| [Action] | [Owner] | [Date] | P0/P1/P2 |

## Lessons Learned
- [Lesson 1]
- [Lesson 2]
```

---

## 7. Backup Verification Schedule

### Monthly Tasks
```bash
# Day 1: Redis recovery test
# Day 7: Backup size validation
# Day 14: Encryption key rotation check
# Day 21: Off-site backup verification
# Day 28: Backup completeness report
```

### Quarterly Tasks
```bash
# End of quarter: Full database recovery test
# End of quarter: Disaster recovery drill
# End of quarter: Backup integrity audit
```

### Annual Tasks
```bash
# Q1: Full system failover test
# Q2: Compliance backup audit
# Q3: Disaster recovery plan review
# Q4: Backup infrastructure assessment
```

---

## 8. Emergency Contacts

**On-Call Rotation:** [PagerDuty link]
**War Room:** [Slack channel #incidents]
**Status Page:** ${TASKFLOW_URL}/status
**Documentation:** [Confluence wiki]

**Critical Contacts:**
- Chief Technology Officer: [Phone/Email]
- Database Administrator: [Phone/Email]
- Infrastructure Lead: [Phone/Email]
- Security Officer: [Phone/Email]

---

## 9. Tools & Resources

**Backup Management:**
- Supabase Dashboard (Web UI)
- AWS CLI for S3 operations
- PostgreSQL tools (pg_dump, psql, pg_restore)

**Monitoring:**
- Prometheus for metrics
- ELK Stack for logs
- Kubernetes Dashboard for cluster health

**Documentation:**
- Runbooks stored in `/ops/runbooks/`
- Recovery procedures in this document
- Disaster recovery plans in `/ops/disaster-recovery/`

---

## Appendix A: Backup Command Reference

```bash
# Force immediate database backup
curl -X POST https://api.supabase.com/v1/projects/${PROJECT_ID}/database/backups \
  -H "Authorization: Bearer ${SUPABASE_API_TOKEN}"

# Force immediate Redis snapshot
redis-cli BGSAVE

# Verify backup completion
aws s3 ls s3://${BACKUP_BUCKET}/ --recursive --human-readable | tail -20

# Test database restoration (safe to run on staging)
psql -h ${STAGING_DB_HOST} -U postgres -d notification_system -c "SELECT NOW();"

# Validate backup encryption
openssl enc -aes-256-cbc -d -in backup/secrets-20240101.tar.gz.enc -K ${KEY} -iv ${IV} | tar -tzf - | head
```

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-01-15 | DevOps Team | Initial document |

---

**Last Reviewed:** 2024-01-15  
**Next Review:** 2024-04-15  
**Document Owner:** Infrastructure Team
