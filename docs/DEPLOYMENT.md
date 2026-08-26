# Deployment Guide

## Environment Variables

All environment variables are defined in `.env.example`. Copy to `.env.local` for local development or configure in your deployment platform.

### Required Variables

#### Supabase Configuration

```bash
# Supabase project URL
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co

# Supabase anonymous/public key (safe to expose to client)
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Supabase service role key (SECRET — backend only, never expose to client)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Note**: `NEXT_PUBLIC_*` prefix makes variables available to the browser. Service role key MUST NOT have this prefix.

### Optional Variables

#### Rate Limiting (Upstash Redis)

```bash
# If not configured, rate limiting fails open (no limit)
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=abc123...
```

#### Error Tracking (Sentry)

```bash
# Frontend error tracking
NEXT_PUBLIC_SENTRY_DSN=https://key@sentry.io/project

# Backend error tracking
SENTRY_DSN=https://key@sentry.io/project
```

#### Cron Tasks

```bash
# Shared secret for Vercel Cron webhooks
CRON_SECRET=your-secret-key

# Webhook URL for alerts
ALERT_WEBHOOK_URL=https://your-webhook.endpoint
```

---

## Pre-Deployment Checklist

### Code Quality

- [ ] Run tests: `npm test`
- [ ] Check coverage: `npm test:coverage` (target: 80%+)
- [ ] Run linter: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] No TypeScript errors: `npx tsc --noEmit`

### Security

- [ ] All environment variables configured correctly
- [ ] Service role key is private (not in git, not in .env)
- [ ] CORS configured for frontend domain
- [ ] Rate limiting enabled if using Upstash
- [ ] Security headers configured (see below)

### Database

- [ ] Supabase migrations up to date
- [ ] Backups configured and tested
- [ ] Database connection pooling enabled (PgBouncer)
- [ ] Row-level security (RLS) policies reviewed

### Functionality

- [ ] User creation flow tested
- [ ] User update/delete tested
- [ ] Password reset tested
- [ ] Multi-organization isolation verified
- [ ] Last admin protection verified

### Documentation

- [ ] Runbooks updated
- [ ] Architecture documentation updated
- [ ] API documentation reviewed

---

## Deployment Platforms

### Vercel (Recommended for Next.js)

1. **Connect Repository**
   - Push code to GitHub
   - Import project in Vercel dashboard

2. **Configure Environment Variables**
   ```
   Project Settings → Environment Variables
   Add all variables from .env.example
   ```

3. **Deploy**
   ```bash
   git push main
   # Vercel auto-deploys on push
   ```

4. **Verify Deployment**
   ```bash
   curl https://your-deployment.vercel.app/api/health
   ```

### Self-Hosted (Node.js)

1. **Install Dependencies**
   ```bash
   npm install --production
   ```

2. **Build Application**
   ```bash
   npm run build
   ```

3. **Configure Environment**
   ```bash
   export NEXT_PUBLIC_SUPABASE_URL=...
   export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   export SUPABASE_SERVICE_ROLE_KEY=...
   ```

4. **Start Server**
   ```bash
   npm start
   # Server runs on http://localhost:3000
   ```

5. **Production Process Manager**
   ```bash
   # Option 1: PM2
   pm2 start npm --name "taskflow" -- start
   pm2 save
   pm2 startup

   # Option 2: Systemd
   # Create /etc/systemd/system/taskflow.service
   ```

### Docker Deployment

1. **Build Image**
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   COPY . .
   RUN npm run build
   EXPOSE 3000
   CMD ["npm", "start"]
   ```

2. **Run Container**
   ```bash
   docker run -e NEXT_PUBLIC_SUPABASE_URL=... \
             -e SUPABASE_SERVICE_ROLE_KEY=... \
             -p 3000:3000 \
             taskflow:latest
   ```

---

## Monitoring & Observability

### Health Check

```bash
GET /api/health
```

Returns 200 OK if service is healthy:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Logs

#### Application Logs
```bash
# View application logs
npm start 2>&1 | tee app.log

# Filter for errors
grep "ERROR" app.log
```

#### Database Logs
```bash
# Supabase dashboard → Logs → Database
# Monitor slow queries and errors
```

#### Sentry (if configured)
```
https://sentry.io/organizations/your-org/
View error tracking, performance, releases
```

### Metrics to Monitor

| Metric | Target | Alert |
|--------|--------|-------|
| API response time | < 200ms | > 500ms |
| Error rate | < 0.1% | > 1% |
| Database connections | < 80% | > 90% |
| Memory usage | < 512MB | > 800MB |
| CPU usage | < 50% | > 80% |

---

## Rollback Procedure

### Quick Rollback (Last Good Deployment)

**Vercel:**
```
Project → Deployments → Select previous deployment → Promote to Production
```

**Self-Hosted with Git:**
```bash
git revert <bad-commit-hash>
git push main
npm run build && npm start
```

**Docker:**
```bash
docker run <previous-image-tag> -p 3000:3000
```

### Database Rollback

If schema or data was corrupted:

1. **Check Supabase Backups**
   ```
   Database → Backups → Restore to point-in-time
   ```

2. **Restore Locally**
   ```bash
   supabase db pull  # Get latest from remote
   supabase db reset  # Reset to previous state
   ```

---

## Common Issues

### Issue: "SUPABASE_SERVICE_ROLE_KEY not configured"

**Symptom**: POST /create-user returns 500

**Solution**:
```bash
# Verify environment variable
echo $SUPABASE_SERVICE_ROLE_KEY

# Check it's not exposed to client
# Ensure no NEXT_PUBLIC_ prefix
```

### Issue: "User not found" on all requests

**Symptom**: 404 on /api/admin/users

**Solution**:
```bash
# Verify JWT token is valid
# Check Supabase auth is working
curl -H "Authorization: Bearer $JWT" \
  https://your-app.com/api/health
```

### Issue: Rate limiting not working

**Symptom**: No X-RateLimit headers in responses

**Solution**:
```bash
# If Upstash not configured, rate limiting fails open
# To enable, configure:
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

### Issue: High memory usage

**Symptom**: Process killed or crash

**Solution**:
```bash
# Check for memory leaks
node --inspect app.js
# Use Chrome DevTools for heap snapshot

# Reduce node memory limit
NODE_OPTIONS=--max-old-space-size=512
```

---

## Production Checklist

### Before Going Live

- [ ] All tests passing (npm test)
- [ ] Build successful (npm run build)
- [ ] Environment variables configured (all 3 Supabase vars minimum)
- [ ] Database backups enabled
- [ ] Monitoring/alerting configured
- [ ] Error tracking enabled (Sentry recommended)
- [ ] Security headers configured
- [ ] CORS origins whitelisted
- [ ] Rate limiting enabled (recommended)

### On Deployment Day

- [ ] Test each API endpoint manually
- [ ] Verify user creation flow end-to-end
- [ ] Check logs for errors
- [ ] Monitor metrics for first 30 minutes
- [ ] Have rollback plan ready
- [ ] Keep support team on standby

### Post-Deployment

- [ ] Monitor error rates for 24 hours
- [ ] Verify backup/recovery works
- [ ] Review performance metrics
- [ ] Gather user feedback
- [ ] Update runbooks

---

## Performance Tuning

### Database Connection Pooling

In Supabase dashboard:

```
Project Settings → Database → Connection Pooling
Enable PgBouncer (recommended: 20 connections per app instance)
```

### API Response Caching

For expensive queries (e.g., large user lists):

```typescript
// Add Cache-Control header
response.headers.set('Cache-Control', 'public, max-age=60');
```

### Frontend Optimization

```typescript
// Avoid fetching users repeatedly
useQuery({
  queryKey: ['users'],
  queryFn: fetchUsers,
  staleTime: 5 * 60 * 1000  // 5 minutes
});
```

### Bundle Size

```bash
# Check bundle size
npm run build

# Analyze size
npx next-bundle-analyzer

# Optimize by removing unused dependencies
npm prune --production
```

---

## Disaster Recovery

### Backup Strategy

| Component | Frequency | Retention |
|-----------|-----------|-----------|
| Database | Continuous (PITR) | 30 days |
| Application | Continuous (Git) | Unlimited |
| Environment vars | Manual | Keep secure backup |

### Recovery Time Objective (RTO)

| Scenario | Target | Steps |
|----------|--------|-------|
| Deployment failure | < 5 minutes | Revert to previous deployment |
| Database corruption | < 30 minutes | Restore from backup, redeploy |
| Complete outage | < 1 hour | Promote to secondary region |

### Testing Recovery

Monthly:
- [ ] Test database restore from backup
- [ ] Test deployment rollback
- [ ] Test failover procedure
- [ ] Document any issues found

---

## Support & Escalation

### Issues to Alert On

- [ ] Error rate > 1%
- [ ] API response time > 1 second
- [ ] Database connection pool exhausted
- [ ] Memory usage > 80%
- [ ] Deployment failed
- [ ] Backup restore failed

### Contacts

- **Supabase Support**: https://supabase.com/support
- **Vercel Support**: https://vercel.com/support
- **On-call Engineer**: [Add your escalation process]

