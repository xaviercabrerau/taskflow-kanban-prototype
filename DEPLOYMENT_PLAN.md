# 🚀 Notification System — Production Deployment Plan

**Date:** 2026-08-18  
**Status:** IN PROGRESS  
**Target:** Production Ready  

## 14-Section Deployment Checklist

### ✅ SECTION 1: Environment Variables
**Required (11 vars):**
- [ ] GMAIL_SERVICE_ACCOUNT_JSON (base64)
- [ ] GMAIL_SENDER_EMAIL 
- [ ] NEXT_PUBLIC_SUPABASE_URL
- [ ] SUPABASE_SERVICE_ROLE_KEY
- [ ] REDIS_URL
- [ ] GOOGLE_CLOUD_PROJECT_ID
- [ ] STAFF_API_KEY
- [ ] NEXT_PUBLIC_VERCEL_URL
- [ ] NODE_ENV=production
- [ ] LOG_LEVEL=info
- [ ] RATE_LIMIT_MAX=5

**Action:** Copy .env.example → .env.production, fill values

---

### ✅ SECTION 2: Database Migrations
**Schema Tables:**
- [ ] notification_preferences
- [ ] notifications
- [ ] email_threads
- [ ] failed_jobs

**Action:** Run `supabase migration up`

---

### ✅ SECTION 3: Row-Level Security (RLS)
**Policies:**
- [ ] notification_preferences: user can see own prefs
- [ ] notifications: user can see own notifications
- [ ] email_threads: user can see own threads
- [ ] failed_jobs: read-only for ops team

**Action:** Verify RLS enabled on all tables

---

### ✅ SECTION 4: Gmail Service Account
**Setup:**
- [ ] Download JSON key from GCP Console
- [ ] Encode: `base64 < key.json`
- [ ] Set GMAIL_SERVICE_ACCOUNT_JSON
- [ ] Enable Gmail API

**Action:** Configure OAuth + domain-wide delegation

---

### ✅ SECTION 5: Gmail Webhook (Pub/Sub)
**Setup:**
- [ ] Create topic: gmail-reply-notifications
- [ ] Create subscription: gmail-reply-sub
- [ ] Set push endpoint: https://{VERCEL_URL}/api/webhooks/gmail-reply
- [ ] Test webhook (should return 200)

**Action:** Verify webhook receives messages

---

### ✅ SECTION 6: BullMQ + Redis
**Setup:**
- [ ] Redis running: redis-cli ping → PONG
- [ ] REDIS_URL accessible
- [ ] BullMQ queue created
- [ ] Concurrency: 5

**Action:** Test job queueing

---

### ✅ SECTION 7: Run All Tests
**Tests (72 total):**
- [ ] Unit tests: 33 passing
- [ ] Integration tests: 25 passing
- [ ] E2E tests: 14 passing
- [ ] All passing: 72/72

**Command:** `npm test`

---

### ✅ SECTION 8: Build & TypeScript
**Verification:**
- [ ] `npm run build` succeeds
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Bundle size acceptable

**Command:** `npm run build && npm run lint`

---

### ✅ SECTION 9: Security Audit
**Checklist (9 items):**
- [ ] No hardcoded secrets in code
- [ ] Rate limiting active
- [ ] RLS enforced (all tables)
- [ ] JWT validated (all endpoints)
- [ ] Email sanitization active (XSS checks)
- [ ] Webhook signature verified
- [ ] Failed jobs logged (no sensitive data)
- [ ] .env not committed (in .gitignore)
- [ ] Service account key rotated quarterly

---

### ✅ SECTION 10: Monitoring & Logging
**Setup:**
- [ ] Failed jobs table queryable
- [ ] Error logging configured
- [ ] Performance metrics tracked
- [ ] Alerts configured (jobs > 5/hr, errors > 10/min)
- [ ] Dashboard accessible

---

### ✅ SECTION 11: Performance & Scalability
**Targets:**
- [ ] Email delivery < 2 minutes
- [ ] API response time < 200ms
- [ ] Job queue depth < 100
- [ ] Error rate < 0.5%
- [ ] Retry success rate > 95%

---

### ✅ SECTION 12: Rollback Procedures
**Immediate Actions:**
- [ ] Stop BullMQ processor
- [ ] Flush Redis keys
- [ ] Disable notification preferences (toggle)
- [ ] Revert migrations if needed

---

### ✅ SECTION 13: Post-Deployment Verification
**24-Hour:**
- [ ] Send test notification
- [ ] Verify email arrival (< 2 min)
- [ ] Reply with "done" command
- [ ] Verify task status updated
- [ ] Check notification bell updates

**1-Week:**
- [ ] Monitor error rate < 0.5%
- [ ] Job queue healthy
- [ ] Email delivery latency stable
- [ ] No unhandled exceptions

---

### ✅ SECTION 14: Sign-Off
**Stakeholders:**
- [ ] Engineer: Code reviewed & tested
- [ ] QA: All scenarios verified
- [ ] DevOps: Infrastructure ready
- [ ] Product: Feature approved for launch

---

## Execution Timeline

**Phase 1 (30 min):** Env setup + database  
**Phase 2 (20 min):** Gmail + Pub/Sub  
**Phase 3 (10 min):** Redis + tests  
**Phase 4 (15 min):** Build + security audit  
**Phase 5 (30 min):** Monitoring + verification  
**Phase 6 (15 min):** Sign-off  

**Total: ~2 hours**

---

## Current Status

```
[████████████████████░░░░░░░░░░░░░░░░] 55% Complete
```

Next: Starting with Environment Variables (Section 1)

