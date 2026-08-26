# Load Testing Setup Guide

This guide explains how to set up test users and credentials for running load tests against the TaskFlow Notification System.

## Overview

Load tests require valid authentication credentials (JWT tokens) to test authenticated endpoints. This guide covers:
- Creating test users in Supabase
- Generating JWT tokens for testing
- Configuring test credentials as environment variables
- Running the load test suite

## Prerequisites

- Supabase project set up and running
- Node.js 18+ installed locally
- K6 installed (`k6 --version` to verify)
- Access to your Supabase dashboard
- Environment variables configured (.env.local)

## Step 1: Create Test Users in Supabase

### Via Supabase Dashboard (Easiest for one-off testing)

1. Open your Supabase project dashboard
2. Navigate to **Authentication > Users**
3. Click **+ Create a new user**
4. Enter test user details:
   - Email: `test-user-1@taskflow.local` (use sequential numbers for multiple users)
   - Password: Generate a strong password or use: `TestPass123!@#`
   - Auto confirm user email: **Check this** (to avoid email verification)
5. Click **Create user**
6. Repeat 3-5 times to create multiple test users

### Via SQL Script (For bulk test user creation)

Run this SQL in Supabase SQL Editor to create 50 test users at once:

```sql
-- Bulk create test users in auth.users and public.profiles
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'test-user-' || i || '@taskflow.local',
  crypt('TestPass123!@#', gen_salt('bf')),
  now(),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  false,
  ''
FROM generate_series(1, 50) i
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email LIKE 'test-user-%@taskflow.local'
);

-- Optional: Create organization records for testing
INSERT INTO public.organizations (name, owner_id)
SELECT
  'Test Org ' || i,
  user_id
FROM (
  SELECT
    user_id,
    ROW_NUMBER() OVER (ORDER BY user_id) as i
  FROM auth.users
  WHERE email LIKE 'test-user-%@taskflow.local'
) t
WHERE i <= 5;

-- Optional: Associate users with test organizations
INSERT INTO public.organization_members (user_id, organization_id, role)
SELECT
  u.id,
  o.id,
  CASE WHEN (ROW_NUMBER() OVER (ORDER BY u.id)) = 1 THEN 'owner' ELSE 'member' END
FROM auth.users u
CROSS JOIN public.organizations o
WHERE u.email LIKE 'test-user-%@taskflow.local'
ON CONFLICT DO NOTHING;
```

**Important:** This script uses Supabase's default settings. Adjust the email domain and password as needed.

## Step 2: Generate JWT Tokens

### Option A: Generate from Supabase Client (Recommended for testing)

Create a script at `scripts/generate-test-tokens.js`:

```javascript
// generate-test-tokens.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function generateTestTokens() {
  const testUsers = [
    { email: 'test-user-1@taskflow.local', password: 'TestPass123!@#' },
    { email: 'test-user-2@taskflow.local', password: 'TestPass123!@#' },
    { email: 'test-user-3@taskflow.local', password: 'TestPass123!@#' },
  ];

  console.log('Generating JWT tokens for test users...\n');

  for (const user of testUsers) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      });

      if (error) throw error;

      console.log(`User: ${user.email}`);
      console.log(`Token: ${data.session.access_token}`);
      console.log(`Expires: ${new Date(data.session.expires_at * 1000)}\n`);
    } catch (err) {
      console.error(`Error for ${user.email}:`, err.message);
    }
  }
}

generateTestTokens();
```

Run it:
```bash
node scripts/generate-test-tokens.js
```

### Option B: Generate Using Supabase CLI

```bash
# Get a token for specific user
supabase auth token
```

### Option C: Use Postman or REST Client

Use Supabase's auth API endpoint directly:

```bash
curl -X POST "https://<your-project>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <your-anon-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test-user-1@taskflow.local",
    "password": "TestPass123!@#"
  }'
```

Response will include `access_token` - use this in tests.

## Step 3: Configure Environment Variables

Create or update `.env.local`:

```bash
# Load Testing Configuration
BASE_URL=http://localhost:3000  # or https://staging.taskflow.app

# Test User Credentials (from Step 1 & 2)
AUTH_TOKEN="Bearer <your-jwt-token-from-step-2>"
TEST_USER_ID="<user-uuid-from-supabase>"
ORGANIZATION_ID="<org-uuid-from-supabase>"

# Optional: Multiple test user tokens for concurrent testing
AUTH_TOKEN_1="Bearer <jwt-token-for-user-1>"
AUTH_TOKEN_2="Bearer <jwt-token-for-user-2>"
AUTH_TOKEN_3="Bearer <jwt-token-for-user-3>"

# Load Test Settings
K6_VUS=50              # Virtual users
K6_DURATION=5m         # Duration
```

## Step 4: Verify Test Credentials

Run this quick validation:

```bash
#!/bin/bash
# test-credentials.sh

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_TOKEN="${AUTH_TOKEN}"

echo "Testing credentials..."
echo "Base URL: $BASE_URL"
echo "Auth Token: ${AUTH_TOKEN:0:20}... (truncated)"

# Test health endpoint
echo ""
echo "1. Testing health endpoint (no auth required)..."
curl -s "$BASE_URL/api/health" | jq .

# Test authenticated endpoint
echo ""
echo "2. Testing authenticated endpoint..."
curl -s -H "Authorization: $AUTH_TOKEN" \
  "$BASE_URL/api/admin/users" | jq .

# Test notification preferences
echo ""
echo "3. Testing notification preferences..."
curl -s -H "Authorization: $AUTH_TOKEN" \
  "$BASE_URL/api/admin/notification-preferences" | jq .

echo ""
echo "✓ Credentials validation complete"
```

Save as `scripts/test-credentials.sh` and run:
```bash
chmod +x scripts/test-credentials.sh
./scripts/test-credentials.sh
```

## Step 5: Run Load Tests

### Baseline Test (5 minutes)
```bash
export AUTH_TOKEN="Bearer <your-token>"
export BASE_URL="http://localhost:3000"

./testing/run-load-tests.sh --scenario baseline
```

### Other Scenarios
```bash
# Ramp-up test
./testing/run-load-tests.sh -s ramp_up

# Spike test
./testing/run-load-tests.sh -s spike

# Stress test
./testing/run-load-tests.sh -s stress

# Email delivery test
./testing/run-load-tests.sh -s email_delivery

# Endurance test (60 minutes)
./testing/run-load-tests.sh -s endurance
```

## Step 6: Generate Test Data (Optional)

For more realistic load tests, create test data:

```sql
-- Create test notifications
INSERT INTO public.notifications (
  user_id,
  organization_id,
  type,
  title,
  message,
  read_at,
  created_at
)
SELECT
  u.id,
  o.id,
  'task_assigned',
  'Task Assigned: ' || task_num,
  'You have been assigned a new task',
  NULL,
  now() - (INTERVAL '1 day' * random())
FROM (
  SELECT id FROM auth.users 
  WHERE email LIKE 'test-user-%@taskflow.local' 
  LIMIT 10
) u
CROSS JOIN (
  SELECT id FROM public.organizations 
  LIMIT 5
) o
CROSS JOIN generate_series(1, 100) as task_num;
```

## Monitoring During Load Tests

### Terminal View
```bash
# Watch results in real-time
tail -f testing/results/load-test_*.log
```

### Dashboard (InfluxDB + Grafana)

If you have InfluxDB configured:

```bash
# Run test with InfluxDB export
k6 run -o experimental-prometheus-rw \
  --tag environment=staging \
  testing/load-test.js
```

Then view in Grafana at `http://localhost:3000` (if running locally).

## Interpreting Results

After test completion, check the JSON results:

```bash
# View p95 latency (95th percentile response time)
jq '.metrics.http_req_duration.values."p(95)"' testing/results/*.json

# View error rate
jq '.metrics.http_req_failed.value' testing/results/*.json

# View total requests
jq '.metrics.http_reqs.value' testing/results/*.json
```

Expected healthy metrics:
- **P95 Latency**: < 500ms
- **Error Rate**: < 0.1%
- **Success Rate**: > 99.9%

## Troubleshooting

### "401 Unauthorized" Errors
**Problem:** JWT token is invalid or expired
**Solution:** 
1. Verify token hasn't expired (tokens typically expire in 1 hour)
2. Regenerate token using step 2
3. Check BASE_URL matches token's issued-for domain

### "403 Forbidden" Errors
**Problem:** User is not authorized for the endpoint
**Solution:**
1. Verify test user belongs to the organization
2. Check user role (some endpoints require "owner" role)
3. Verify user is not deleted or suspended

### "429 Too Many Requests"
**Problem:** Rate limiting is active
**Solution:**
1. Reduce VUs (virtual users) in test
2. Increase test duration to spread requests out
3. Wait for rate limit window to reset

### Database Connection Errors
**Problem:** Load test exhausts connection pool
**Solution:**
1. Reduce VU count
2. Check Supabase project's connection pool settings
3. Monitor active connections in Supabase dashboard

### Token Validation Failures
**Problem:** K6 can't validate JWT signature
**Solution:**
1. Ensure token is from correct Supabase project
2. Verify SUPABASE_URL and SUPABASE_ANON_KEY are correct
3. Generate fresh token

## Best Practices

1. **Use a dedicated test database** - Don't test on production data
2. **Create fresh test users** - Use `test-user-*@taskflow.local` pattern
3. **Rotate tokens regularly** - Tokens expire; regenerate before long tests
4. **Start small** - Begin with baseline (10 VUs) before stress testing (500+ VUs)
5. **Monitor system resources** - Watch CPU/memory during tests
6. **Document test runs** - Save results with git commit hash and date
7. **Compare trends** - Track metrics over time to detect regressions
8. **Clean up test data** - Delete test users and data after testing

## Maintenance

### Weekly
```bash
# Regenerate test tokens
node scripts/generate-test-tokens.js > test-tokens.txt

# Run baseline test to detect regressions
./testing/run-load-tests.sh -s baseline
```

### Monthly
```bash
# Run full test suite
./testing/run-load-tests.sh -s stress
./testing/run-load-tests.sh -s endurance

# Archive results
cp testing/results/* backups/load-test-results/$(date +%Y-%m)/
```

### Before Production Deployment
```bash
# Run stress test against staging
BASE_URL=https://staging.taskflow.app ./testing/run-load-tests.sh -s stress

# Verify all metrics meet SLA
# Check testing/results/report_*.md for results
```

## References

- [K6 Load Testing Documentation](https://k6.io/docs/)
- [Supabase Authentication](https://supabase.com/docs/guides/auth)
- [Performance Testing Guide](./PERFORMANCE_TESTING.md)
- [API Endpoints Reference](./API_ENDPOINTS.md)
- [Testing Strategy](./TESTING.md)
