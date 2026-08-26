# TaskFlow Notification System - Development Workflow Guide

A comprehensive guide for developers working on the TaskFlow Notification System. This document covers daily workflows, testing strategies, database management, API development, and common troubleshooting scenarios.

## SECTION 1: Getting Started

### Running Setup Script

The project includes an automated setup script that initializes your local development environment.

```bash
# Make script executable
chmod +x /Users/xaviercabrera/Claude/taskflow-kanban-prototype/dev/setup-local.sh

# Run the setup
cd /Users/xaviercabrera/Claude/taskflow-kanban-prototype
./dev/setup-local.sh
```

**Setup Includes:**
- Installing Node.js dependencies
- Setting up environment variables (.env.local)
- Initializing Supabase local stack
- Creating Redis instance
- Running database migrations
- Seeding sample data

### Verifying Environment

After setup, verify everything is working:

```bash
# Check Node version
node --version  # Should be 18+ or as specified in .nvmrc

# Verify package installation
npm list supabase redis dotenv

# Test database connection
npm run db:check

# Test Redis connection
npm run redis:check
```

### Starting Dev Server

```bash
# Terminal 1: Start Supabase and Redis
npm run dev:services

# Terminal 2: Start Next.js dev server
npm run dev

# Application runs at http://localhost:3000
```

**Expected output:**
- Supabase local stack running on port 54321
- Redis running on port 6379
- Next.js dev server running on port 3000
- No TypeScript or build errors

---

## SECTION 2: Daily Development Flow

Follow this workflow for consistent, efficient development:

### 1. Pull Latest Changes

```bash
git checkout main
git pull origin main

# Check for new dependencies
npm install

# Run migrations if schema changed
npm run db:migrate
```

### 2. Check Schema Changes

```bash
# Review pending migrations
ls -la supabase/migrations/

# Check schema against remote
supabase db pull

# Run migrations locally
npm run db:migrate

# Seed test data if needed
npm run db:seed
```

### 3. Start Services

```bash
# Terminal 1: Services (stay running)
npm run dev:services

# Wait for:
# - Supabase: "supabase local development started"
# - Redis: "ready to accept connections"

# Terminal 2: Dev server
npm run dev

# Terminal 3: Job worker (for background jobs)
npm run worker:dev
```

### 4. Make Changes

```bash
# Create feature branch
git checkout -b feature/notification-feature

# Make code changes
# Follow code style guidelines (Section 14)
# Add tests alongside code (Section 6)
```

### 5. Test Locally

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run E2E tests (optional for changes not affecting core flows)
npm run test:e2e

# Check coverage
npm run test:coverage
```

### 6. Run Linter & TypeScript

```bash
# Format code
npm run format

# Check linting
npm run lint

# Check TypeScript
npm run type-check

# Fix auto-fixable issues
npm run lint:fix
```

### 7. Commit & Push

```bash
# Review changes
git diff
git status

# Stage specific files (not git add .)
git add src/features/notifications/

# Create descriptive commit
git commit -m "feat: Add email notification preferences API

- Add GET /api/notifications/preferences endpoint
- Add PATCH /api/notifications/preferences endpoint
- Add RLS policy for user preference isolation
- Add tests for preference updates"

# Push to feature branch
git push origin feature/notification-feature

# Create PR on GitHub
```

---

## SECTION 3: Working with Database

### Schema Changes (Migrations)

```bash
# Create new migration
supabase migration new add_notification_templates

# Migration file: supabase/migrations/[timestamp]_add_notification_templates.sql

# Review migration before running
cat supabase/migrations/[timestamp]_add_notification_templates.sql

# Run locally
npm run db:migrate

# Verify changes
psql supabase -c "\dt notifications_templates"

# Test RLS policies
npm run test:rls

# Commit migration to Git
git add supabase/migrations/
git commit -m "migration: Add notification_templates table with RLS"
```

**Migration Best Practices:**
- Make migrations idempotent (use IF NOT EXISTS, IF EXISTS)
- Include rollback logic in comments
- Test migrations with empty database first
- Include RLS policy creation in migration
- Add index on frequently queried columns

### Seeding Test Data

```bash
# Seed sample data
npm run db:seed

# Seed specific dataset
npm run db:seed -- --type notifications

# Clear and reseed
npm run db:reset

# Custom seed script
# supabase/seed.sql contains INSERT statements

# View seeded data
psql supabase -c "SELECT * FROM users LIMIT 5;"
```

**Seed File Location:** `supabase/seed.sql`

### Debugging Queries

```bash
# Connect to local database
npm run db:shell

# Common queries
-- View notification queue
SELECT * FROM notification_queue ORDER BY created_at DESC LIMIT 20;

-- Check email templates
SELECT id, event_type, subject, created_at FROM email_templates;

-- View user preferences
SELECT user_id, notification_type, enabled, updated_at FROM notification_preferences;

-- Check failed jobs
SELECT * FROM job_logs WHERE status = 'failed' ORDER BY created_at DESC;

# Exit: \q
```

**Performance Analysis:**
```bash
# Analyze slow queries
EXPLAIN ANALYZE SELECT * FROM notification_queue WHERE status = 'pending';

# Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) 
FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Testing RLS Policies

```bash
# Run RLS test suite
npm run test:rls

# Test specific policy
npm run test:rls -- --policy notifications_insert

# Manual RLS testing
npm run db:shell

-- Switch to test user
SET ROLE service_role;
SELECT jwt.claims()->>'sub' AS user_id;

-- Try selecting data (should be filtered by RLS)
SELECT * FROM notifications;
```

**Common RLS Issues:**
- Policy missing USER_ID() check → data leaks
- Policy too restrictive → 403 errors in API
- Policy on INSERT but not SELECT → inconsistent behavior
- Anon role vs authenticated role confusion → permission errors

---

## SECTION 4: Working with Email

### Testing Email Templates Locally

```bash
# Email templates stored in: app/emails/
# Structure:
# - WelcomeEmail.tsx
# - NotificationEmail.tsx
# - PreferencesReminderEmail.tsx

# Test template rendering
npm run email:preview

# View at http://localhost:3001/

# Test specific template
npm run email:preview -- --template WelcomeEmail

# Test with different data
npm run email:preview -- --template NotificationEmail --user-id user123

# Generate HTML output
npm run email:generate -- --template NotificationEmail > /tmp/email.html
open /tmp/email.html
```

**Template Development:**
```tsx
// app/emails/NotificationEmail.tsx
import { Html, Body, Text, Button } from '@react-email/components';

export default function NotificationEmail({ 
  userName, 
  taskTitle, 
  action,
  actionUrl 
}) {
  return (
    <Html>
      <Body>
        <Text>Hi {userName},</Text>
        <Text>{taskTitle} is {action}</Text>
        <Button href={actionUrl}>View Task</Button>
      </Body>
    </Html>
  );
}
```

### Inspecting Email Queue

```bash
# View pending emails
npm run email:queue:status

# See email details
psql supabase -c "SELECT id, user_id, template, status, created_at FROM email_queue ORDER BY created_at DESC LIMIT 10;"

# Retry failed emails
npm run email:queue:retry

# Process queue manually
npm run email:queue:process

# Monitor processing
npm run email:queue:monitor

# Clear test emails
npm run email:queue:clear
```

### Simulating Email Replies

```bash
# Gmail reply webhook endpoint
POST /api/webhooks/gmail-reply

# Test payload
curl -X POST http://localhost:3000/api/webhooks/gmail-reply \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "msg123",
    "from": "user@example.com",
    "subject": "Re: Task Updated",
    "body": "Complete this task",
    "threadId": "thread456"
  }'

# Simulate reply parsing
npm run test:email-reply

# View parsed commands
psql supabase -c "SELECT * FROM email_commands ORDER BY created_at DESC LIMIT 10;"
```

**Email Command Format:**
```
Subject: Re: Task Title

mark as done
set due date to tomorrow
add subtask: Review PR
```

### Debugging Gmail API

```bash
# Enable debug logging
DEBUG=gmail:* npm run dev

# Check Gmail API credentials
cat .env.local | grep GMAIL_

# Test Gmail API connection
npm run gmail:test

# View Gmail auth scope
npm run gmail:scope

# Refresh Gmail credentials
npm run gmail:auth:refresh

# Check email rate limits
npm run gmail:rate-limits
```

**Gmail OAuth Setup:**
1. Create project in Google Cloud Console
2. Enable Gmail API
3. Create OAuth 2.0 credentials (Web application)
4. Add authorized redirect URI: http://localhost:3000/api/auth/gmail/callback
5. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET in .env.local

---

## SECTION 5: Working with Jobs

### Testing Job Processing

```bash
# Start job worker in separate terminal
npm run worker:dev

# Queue test job
npm run job:queue -- --type notification --user-id user123

# View job status
npm run job:status -- --job-id job123

# Process specific queue
npm run job:process -- --queue notifications

# Process all queues
npm run worker:start
```

### Inspecting Job Queue

```bash
# Redis job queue commands
npm run redis:cli

# List all jobs
KEYS job:*
HGETALL job:user-notif-123

# View job details
npm run job:inspect -- --job-id job123

# Monitor queue in real-time
npm run job:monitor

# Check queue size
npm run job:queue:size

# View queue stats
npm run job:queue:stats
```

**Job Queue Structure:**
```
job:{jobId} = {
  type: "notification",
  userId: "user123",
  data: {...},
  status: "pending" | "processing" | "completed" | "failed",
  createdAt: 1234567890,
  attempts: 0,
  maxAttempts: 3
}
```

### Simulating Job Failures

```bash
# Force job failure (for testing retry logic)
npm run test:job-failure

# Test retry with exponential backoff
npm run test:job-retry

# Inspect retry queue
npm run job:queue:retry

# Test dead letter queue
npm run job:queue:dlq

# Check job logs
npm run job:logs -- --job-id job123 | tail -20
```

### Testing Retry Logic

```bash
// Implementation in lib/jobs/retry.ts
export async function retryWithBackoff(
  jobFn: () => Promise<void>,
  maxAttempts = 3
) {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await jobFn();
    } catch (error) {
      lastError = error as Error;
      const backoffMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      console.log(`Attempt ${attempt} failed, retrying in ${backoffMs}ms`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  throw new Error(`Job failed after ${maxAttempts} attempts: ${lastError?.message}`);
}
```

**Job Failure Scenarios to Test:**
- Network timeout (timeout handling)
- Database connection loss (recovery)
- Third-party API rate limit (backoff)
- Invalid input data (validation)
- Concurrent job execution (idempotency)

---

## SECTION 6: Testing Workflow

### Unit Tests

```bash
# Run all unit tests
npm test

# Run specific test file
npm test NotificationService.test.ts

# Run in watch mode (auto-rerun on file changes)
npm test -- --watch

# Run with coverage
npm test -- --coverage

# Update snapshots (for snapshot tests)
npm test -- -u

# Run specific test pattern
npm test -- --testNamePattern="send email"
```

**Unit Test Structure:**
```typescript
// lib/services/__tests__/NotificationService.test.ts
describe('NotificationService', () => {
  describe('sendEmail', () => {
    it('should send email with correct template', async () => {
      // Arrange
      const service = new NotificationService();
      const mockEmail = { to: 'user@example.com', template: 'welcome' };
      
      // Act
      const result = await service.sendEmail(mockEmail);
      
      // Assert
      expect(result).toHaveProperty('messageId');
      expect(service.emailSent).toHaveBeenCalledWith(expect.objectContaining({
        to: 'user@example.com'
      }));
    });
  });
});
```

### Integration Tests

```bash
# Run integration tests (requires local services)
npm run test:integration

# Run specific integration test
npm run test:integration -- NotificationAPI

# Run with database
npm run test:integration -- --db

# Check integration test coverage
npm run test:integration -- --coverage
```

**Integration Test Example:**
```typescript
describe('Notification API Integration', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  it('should create notification and send email', async () => {
    const response = await fetch('/api/notifications', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'user123',
        type: 'task_assigned',
        data: { taskId: 'task456' }
      })
    });

    expect(response.status).toBe(201);
    
    // Verify database record
    const notification = await db.notification.findUnique({
      where: { id: (await response.json()).id }
    });
    expect(notification).toBeDefined();
  });
});
```

### E2E Tests

```bash
# Run E2E tests
npm run test:e2e

# Run specific E2E test
npm run test:e2e -- notifications.spec.ts

# Run in debug mode
npm run test:e2e -- --debug

# Generate test report
npm run test:e2e -- --reporter=html

# View report
open test-results/index.html
```

**E2E Test Example:**
```typescript
// tests/e2e/notifications.spec.ts
test('user can view and manage notification preferences', async ({ page }) => {
  // Login
  await page.goto('/login');
  await page.fill('input[type="email"]', 'user@example.com');
  await page.fill('input[type="password"]', 'password');
  await page.click('button[type="submit"]');

  // Navigate to preferences
  await page.goto('/settings/notifications');
  
  // Toggle email notifications
  const emailToggle = page.locator('input[name="email"]');
  await emailToggle.click();

  // Verify change saved
  await page.waitForSelector('[role="alert"]:has-text("Preferences saved")');
  expect(await emailToggle.isChecked()).toBe(true);
});
```

### Coverage Reports

```bash
# Generate coverage report
npm test -- --coverage

# View coverage summary
npm test -- --coverage --collectCoverageFrom="src/**/*.ts"

# Open interactive coverage report
open coverage/lcov-report/index.html

# Set coverage thresholds (in jest.config.js)
coverageThresholds: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80
  }
}
```

**Coverage Goals:**
- Line coverage: 80%+
- Branch coverage: 75%+
- Function coverage: 80%+
- Statement coverage: 80%+

### TDD Approach

Follow Test-Driven Development for new features:

1. **Write failing test** (Red)
```typescript
it('should send notification email on task assignment', async () => {
  const result = await notifyUserOfAssignment('user123', 'task456');
  expect(result.sent).toBe(true);
  expect(result.emailId).toBeDefined();
});
```

2. **Write minimal implementation** (Green)
```typescript
export async function notifyUserOfAssignment(userId, taskId) {
  return { sent: true, emailId: 'id123' };
}
```

3. **Refactor** (Refactor)
```typescript
export async function notifyUserOfAssignment(userId: string, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  const user = await db.user.findUnique({ where: { id: userId } });
  
  const emailId = await sendEmail({
    to: user.email,
    template: 'task_assigned',
    data: { taskTitle: task.title, assignedBy: task.assignedBy }
  });
  
  return { sent: true, emailId };
}
```

---

## SECTION 7: API Development

### Adding New Endpoints

**Endpoint Structure:**
```
app/api/[resource]/[action]/route.ts
```

**Example: Create Notification Preferences Endpoint**
```typescript
// app/api/notifications/preferences/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = createClient();
  
  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch preferences (RLS will filter by user)
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  const { data, error } = await supabase
    .from('notification_preferences')
    .update(body)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
```

**Test the Endpoint:**
```bash
# GET preferences
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/notifications/preferences

# UPDATE preferences
curl -X PATCH http://localhost:3000/api/notifications/preferences \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email_enabled": false, "sms_enabled": true}'
```

### Testing with curl/Postman

**Using curl:**
```bash
# Get auth token (if using session/cookies)
# Set in header for API calls
export TOKEN="your_jwt_token_here"

# GET request
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/notifications

# POST request
curl -X POST http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "type": "task_assigned",
    "data": {"taskId": "task456"}
  }' | jq .

# POST with file
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/file.pdf"
```

**Using Postman:**
1. Create collection "TaskFlow Notifications"
2. Set base URL: `{{BASE_URL}}/api`
3. Set variable: `BASE_URL = http://localhost:3000`
4. Create authentication token variable
5. Add requests with pre-request scripts for auth
6. Test endpoints with various payloads

### Debugging Requests

```bash
# Enable request logging
DEBUG=* npm run dev

# Check request/response details
npm run dev 2>&1 | grep -A5 "POST /api/notifications"

# Use curl with verbose output
curl -v http://localhost:3000/api/notifications

# Inspect network in browser dev tools
# Open DevTools → Network tab
# Make request and review Headers, Response, Timing
```

**Common API Issues:**
- 401 Unauthorized → Check token validity, expiration
- 403 Forbidden → RLS policy blocking access
- 400 Bad Request → Invalid JSON, missing required fields
- 500 Server Error → Check server logs, database issues
- 429 Rate Limited → Too many requests (see rate limiting)

### Rate Limiting Testing

```typescript
// lib/middleware/rateLimit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '1 h'),
});

export async function checkRateLimit(userId: string) {
  const { success, limit, reset, remaining } = await ratelimit.limit(userId);
  return { success, limit, reset, remaining };
}
```

**Test Rate Limiting:**
```bash
# Send 101 requests (exceed 100/hour limit)
for i in {1..101}; do
  curl -H "User-ID: user123" http://localhost:3000/api/notifications
done

# Expect 429 status on 101st request
```

---

## SECTION 8: UI Development

### Component Structure

```
app/components/
├── notifications/
│   ├── NotificationBell.tsx          # Main bell icon component
│   ├── NotificationCenter.tsx        # Full notification center
│   ├── NotificationItem.tsx          # Individual notification row
│   ├── NotificationPreferences.tsx   # Settings panel
│   └── __tests__/
│       ├── NotificationBell.test.tsx
│       └── NotificationCenter.test.tsx
├── common/
│   ├── Button.tsx
│   ├── Modal.tsx
│   └── Toast.tsx
└── layout/
    ├── Header.tsx
    └── Sidebar.tsx
```

### Styling Guidelines

**Use Tailwind CSS for all styles:**

```tsx
// components/notifications/NotificationBell.tsx
import clsx from 'clsx';

export function NotificationBell({ count }) {
  return (
    <button
      className={clsx(
        'relative p-2 rounded-lg',
        'hover:bg-gray-100 dark:hover:bg-gray-800',
        'transition-colors duration-200',
        'focus:outline-none focus:ring-2 focus:ring-blue-500'
      )}
      aria-label="Notifications"
    >
      <BellIcon className="w-6 h-6 text-gray-700 dark:text-gray-300" />
      {count > 0 && (
        <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
          {count}
        </span>
      )}
    </button>
  );
}
```

**Dark Mode Support:**
```tsx
// components/common/Card.tsx
export function Card({ children, className }) {
  return (
    <div className={clsx(
      'bg-white dark:bg-gray-900',
      'border border-gray-200 dark:border-gray-800',
      'rounded-lg shadow-sm',
      'p-4',
      className
    )}>
      {children}
    </div>
  );
}
```

### Responsive Design

```tsx
// Mobile-first approach
export function NotificationCenter() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* Grid: 1 col mobile, 2 cols tablet, 3 cols desktop */}
    </div>
  );
}
```

**Breakpoints:**
- sm: 640px (tablet)
- md: 768px (small laptop)
- lg: 1024px (laptop)
- xl: 1280px (desktop)
- 2xl: 1536px (wide desktop)

### Mobile Testing

```bash
# Test in mobile viewport
npm run dev

# Open DevTools: Toggle device toolbar (Cmd+Shift+M)
# Test with different screen sizes:
# - iPhone SE (375×667)
# - iPhone 14 (390×844)
# - iPad (768×1024)

# Or use device emulation
# In DevTools → More tools → Network conditions
# Set user agent to mobile Safari
```

**Mobile Accessibility:**
- Touch targets: minimum 44×44 px
- No hover-only interactions
- Keyboard navigation support
- Form inputs zoom-friendly (font-size ≥ 16px)

---

## SECTION 9: Git Workflow

### Branch Naming Conventions

```bash
# Feature branch
git checkout -b feature/add-email-templates

# Bug fix
git checkout -b fix/notification-queue-stuck

# Documentation
git checkout -b docs/update-readme

# Chore
git checkout -b chore/upgrade-dependencies

# Hotfix (from main)
git checkout -b hotfix/security-patch
```

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Code style (no logic change)
- refactor: Code refactor
- perf: Performance improvement
- test: Test addition/update
- chore: Build, dependencies, tooling

**Example:**
```
feat(notifications): add email preference management

- Add PATCH endpoint for notification preferences
- Implement RLS policy for user isolation
- Add preference toggle UI in settings
- Add integration tests for preference updates

Fixes #123
```

### Pull Request Process

1. **Create PR with descriptive title**
   - Title: "Add email notification preferences API"
   - Description: Include context, related issues, testing done

2. **Fill PR template**
   ```markdown
   ## Description
   Adds new API for managing email notification preferences
   
   ## Related Issues
   Fixes #123
   
   ## Changes
   - Add GET/PATCH endpoints
   - Add database migrations
   - Add integration tests
   
   ## Testing
   - Tested locally with curl
   - Added 5 new test cases
   - Coverage: 92% → 94%
   ```

3. **Request review** from team members

4. **Address feedback** with new commits (don't rebase until approved)

5. **Ensure CI passes** (tests, linting, type checking)

6. **Squash and merge** to main
   ```bash
   git checkout feature/email-preferences
   git rebase -i main  # Squash commits if needed
   git push origin feature/email-preferences --force
   ```

### Code Review Expectations

**As reviewer, check for:**
- Code follows project conventions
- No security vulnerabilities
- Tests cover new code
- No performance regressions
- Documentation is updated
- Commit messages are clear

**As author:**
- Keep PRs focused (one feature per PR)
- Respond to feedback within 24 hours
- Update PR description if scope changes
- Don't force push after review starts

---

## SECTION 10: Debugging Techniques

### Debug Utils

```typescript
// lib/debug/logger.ts
export const logger = {
  info: (msg: string, data?: any) => {
    console.log(`[INFO] ${msg}`, data);
  },
  error: (msg: string, error: Error) => {
    console.error(`[ERROR] ${msg}`, error.message, error.stack);
  },
  debug: (msg: string, data?: any) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${msg}`, JSON.stringify(data, null, 2));
    }
  }
};

// Usage
logger.info('Sending notification', { userId, type });
logger.error('Failed to send email', error);
logger.debug('Email queue state', queueState);
```

**Enable debug logging:**
```bash
DEBUG=* npm run dev
DEBUG=notifications:* npm run dev
NODE_DEBUG=http npm run dev
```

### Browser Dev Tools

**Console:**
```javascript
// Test API calls
fetch('/api/notifications', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json()).then(console.log);

// Check local storage
localStorage.getItem('auth_token');
```

**Network Tab:**
1. Open DevTools → Network
2. Make API request
3. Click request to see:
   - Request headers/body
   - Response headers/body
   - Timing breakdown
   - Cookies sent

**Storage Tab:**
- Local Storage: Check auth tokens, preferences
- Session Storage: Temporary data
- Cookies: Session data
- IndexedDB: Offline cache

### Network Inspection

```bash
# Monitor network requests
npm run dev 2>&1 | grep -E "POST|GET|PATCH" | grep api/

# Use curl to debug
curl -v http://localhost:3000/api/notifications

# Check headers with curl
curl -i http://localhost:3000/api/notifications

# Monitor with tcpdump (macOS)
sudo tcpdump -i lo0 port 3000 -A | grep -E "POST|Authorization"
```

### Error Tracking

```typescript
// lib/sentry/config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  environment: process.env.NODE_ENV,
});

// Usage in API routes
try {
  await sendNotification();
} catch (error) {
  Sentry.captureException(error, {
    contexts: {
      notification: { userId, type }
    }
  });
  throw error;
}
```

**View errors:**
- Local: Check console and .next/static/errors
- Production: Check Sentry dashboard

---

## SECTION 11: Common Issues & Solutions

### Setup Failures

**Issue: Port 3000 already in use**
```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
npm run dev -- -p 3001
```

**Issue: Supabase fails to start**
```bash
# Check Docker running
docker ps | grep supabase

# Restart Supabase
docker-compose -f docker-compose.yml restart

# Full reset
supabase stop
supabase start

# Check logs
supabase logs
```

**Issue: Dependencies not installed**
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Use npm ci for CI environments
npm ci
```

### Port Conflicts

```bash
# Check all ports in use
lsof -i -P -n | grep LISTEN

# Common ports:
# 3000: Next.js dev server
# 3001: Email preview
# 5432: PostgreSQL
# 6379: Redis
# 54321: Supabase

# Change port for dev server
npm run dev -- -p 3001

# Change Redis port
REDIS_URL="redis://localhost:6380" npm run worker:dev

# Change Supabase port
supabase start --port 54322
```

### Database Migrations

**Issue: Migration fails**
```bash
# Check migration status
supabase migration list

# Rollback migration
supabase migration down

# Debug migration
psql supabase -f supabase/migrations/[timestamp]_migration.sql --echo-all

# Check for syntax errors
# - Missing semicolons
# - Invalid SQL syntax
# - Foreign key constraints
```

**Issue: RLS policy prevents access**
```bash
# Test with auth role
psql supabase -c "SET ROLE authenticated;" -c "SELECT * FROM notifications;"

# Check policy definition
psql supabase -c "SELECT * FROM pg_policies WHERE tablename = 'notifications';"

# Temporarily disable policy (dev only!)
psql supabase -c "ALTER POLICY notifications_select ON notifications DISABLE;"
```

### Redis Connection Issues

**Issue: Redis connection refused**
```bash
# Check if Redis running
redis-cli ping
# Should return: PONG

# Start Redis if not running
npm run dev:services

# Check connection string
echo $REDIS_URL

# Test connection
redis-cli -u redis://localhost:6379

# Check Redis logs
npm run redis:logs
```

**Issue: Job worker not processing**
```bash
# Check worker running
ps aux | grep worker:dev

# Restart worker
npm run worker:dev

# Check job queue
redis-cli KEYS 'job:*'

# Monitor queue
npm run job:monitor

# Check for errors
npm run worker:dev 2>&1 | grep -i error
```

### Gmail API Authentication

**Issue: Gmail API returns 401**
```bash
# Check credentials expiration
npm run gmail:auth:status

# Refresh credentials
npm run gmail:auth:refresh

# Check environment variables
echo $GMAIL_CLIENT_ID
echo $GMAIL_CLIENT_SECRET

# Re-authenticate
npm run gmail:auth:setup
```

**Issue: Email not sending**
```bash
# Check Gmail account setup
npm run gmail:test

# Verify sender email
cat .env.local | grep GMAIL_FROM

# Check rate limits
npm run gmail:rate-limits

# Check email queue
psql supabase -c "SELECT * FROM email_queue WHERE status='failed' LIMIT 5;"

# Resend failed email
npm run email:queue:retry --email-id <id>
```

### Rate Limiting Issues

**Issue: Getting 429 responses**
```bash
# Check rate limit config
cat app/api/middleware/rateLimit.ts

# View current limits
npm run rate-limit:status

# Reset limit for testing
npm run rate-limit:reset --user-id <userId>

# Increase limit for development
DEBUG=rate-limit:* npm run dev
```

---

## SECTION 12: Performance Optimization

### Profiling Queries

```bash
# Enable query logging
npm run dev -- --sql-logs

# Identify slow queries
npm run db:slow-queries

# Analyze query plan
psql supabase -c "EXPLAIN ANALYZE SELECT * FROM notifications WHERE user_id = 'user123';"

# Check table statistics
psql supabase -c "ANALYZE notifications;"
```

**Slow Query Pattern:**
```sql
-- Before: 500ms
SELECT * FROM notifications 
WHERE created_at > NOW() - INTERVAL '7 days';

-- After: 50ms (with index)
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
```

### Caching Strategies

**Application-level caching:**
```typescript
// lib/cache/notificationCache.ts
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 }); // 5 min

export async function getCachedNotifications(userId: string) {
  const cached = cache.get(`notifications:${userId}`);
  if (cached) return cached;

  const notifications = await db.notification.findMany({
    where: { userId }
  });

  cache.set(`notifications:${userId}`, notifications);
  return notifications;
}

// Invalidate on update
export async function updateNotification(id: string, data: any) {
  const notification = await db.notification.update({
    where: { id },
    data
  });
  
  cache.del(`notifications:${notification.userId}`);
  return notification;
}
```

**Database query caching (Redis):**
```typescript
export async function getCachedUserPreferences(userId: string) {
  const cacheKey = `prefs:${userId}`;
  
  // Try Redis first
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Query database
  const prefs = await db.notification_preferences.findUnique({
    where: { user_id: userId }
  });

  // Cache for 1 hour
  await redis.setex(cacheKey, 3600, JSON.stringify(prefs));
  return prefs;
}
```

### Bundle Size Optimization

```bash
# Analyze bundle size
npm run build && npm run analyze

# Check which packages are large
npm run size:report

# Dynamic imports for large components
const NotificationCenter = dynamic(
  () => import('@/components/NotificationCenter'),
  { loading: () => <div>Loading...</div> }
);
```

### Database Indexing

```sql
-- Index on frequently queried columns
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_email_queue_user_id ON email_queue(user_id);

-- Composite index for common queries
CREATE INDEX idx_notifications_user_status 
ON notifications(user_id, status, created_at DESC);

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
ORDER BY idx_scan DESC;
```

---

## SECTION 13: Security Considerations

### Handling Secrets Locally

```bash
# Never commit .env.local
echo ".env.local" >> .gitignore

# Use .env.example for template
cat .env.example
# Contains placeholder values, safe to commit

# Load secrets from password manager
# 1pass plugin or similar
op run -- npm run dev

# Or use env file with limited permissions
chmod 600 .env.local
```

**Secure secret management:**
```typescript
// Never log secrets
logger.info('User ID:', userId);           // ✓ OK
logger.info('API Key:', apiKey);          // ✗ NEVER
logger.info('Token length:', token.length); // ✓ OK
```

### Testing RLS Policies

```bash
# Test that user can only see own data
npm run test:rls

# Manual RLS test
psql supabase -c "
SET ROLE authenticated;
SET app.current_user_id = 'user123';
SELECT * FROM notifications;
-- Should only show notifications for user123
"
```

**RLS Policy Example:**
```sql
-- Users can only see their own notifications
CREATE POLICY notifications_read ON notifications
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert notifications for themselves
CREATE POLICY notifications_insert ON notifications
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own notifications
CREATE POLICY notifications_update ON notifications
  FOR UPDATE
  USING (auth.uid() = user_id);
```

### Input Validation

```typescript
// app/api/notifications/route.ts
import { z } from 'zod';

const createNotificationSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(['task_assigned', 'task_updated', 'comment_added']),
  data: z.record(z.unknown()).optional()
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  
  // Validate input
  const parsed = createNotificationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.format() },
      { status: 400 }
    );
  }

  // Process with validated data
  const notification = await createNotification(parsed.data);
  return NextResponse.json(notification);
}
```

### XSS Prevention

```tsx
// React auto-escapes by default
<div>{userContent}</div>  // ✓ Safe: escaped

// Never use dangerouslySetInnerHTML
<div dangerouslySetInnerHTML={{ __html: userContent }} />  // ✗ DANGER

// Sanitize if absolutely necessary
import DOMPurify from 'dompurify';

const clean = DOMPurify.sanitize(userContent);
<div dangerouslySetInnerHTML={{ __html: clean }} />  // ✓ Safer
```

---

## SECTION 14: Contributing Guidelines

### Code Style

**ESLint configuration:**
```bash
# Run linter
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Check specific file
npx eslint app/api/notifications/route.ts
```

**Prettier formatting:**
```bash
# Format code
npm run format

# Check if formatted
npm run format:check

# Format specific file
npx prettier --write app/components/NotificationBell.tsx
```

**Code style rules:**
- 2-space indentation
- Semicolons required
- Single quotes for strings
- No console.log in production code
- Max line length: 100 characters
- Arrow functions preferred over function keyword

### TypeScript Strict Mode

```bash
# Check TypeScript
npm run type-check

# Fix type errors
# 1. Read error message carefully
# 2. Add type annotation if needed
# 3. Use `// @ts-expect-error` only as last resort
```

**Type annotation examples:**
```typescript
// ✓ Good: Explicit types
function sendEmail(userId: string, template: string): Promise<{ id: string }> {
  // ...
}

// ✗ Bad: Implicit any
function sendEmail(userId, template) {
  // ...
}

// ✓ Good: Type your API responses
interface NotificationResponse {
  id: string;
  type: 'task_assigned' | 'task_updated';
  read: boolean;
  createdAt: Date;
}

const response: NotificationResponse = await getNotification(id);
```

### Testing Requirements

**Minimum coverage for changes:**
- 80% line coverage
- All critical paths tested
- Happy path + at least 1 error case

**Before submitting PR:**
```bash
# Run all tests
npm test -- --coverage

# Ensure no new warnings
npm run type-check
npm run lint

# Verify E2E tests pass (if touching UI)
npm run test:e2e
```

### Documentation Standards

**Update docs when:**
- Adding new API endpoints
- Changing database schema
- Adding new components
- Changing configuration
- Adding environment variables

**Documentation files:**
- `/README.md` - Project overview
- `/dev/*.md` - Development guides
- `/docs/*.md` - Architecture decisions
- Inline comments for complex logic
- JSDoc for public functions

**JSDoc example:**
```typescript
/**
 * Sends a notification email to a user
 * @param userId - The user to notify
 * @param template - Email template name
 * @param data - Template data to render
 * @returns Promise resolving to email ID
 * @throws Error if email service is unavailable
 */
export async function sendNotificationEmail(
  userId: string,
  template: string,
  data: Record<string, any>
): Promise<string> {
  // Implementation
}
```

---

## Quick Reference

### Essential Commands
```bash
npm run dev               # Start dev server
npm run dev:services     # Start Supabase + Redis
npm run worker:dev       # Start job worker
npm test                 # Run unit tests
npm run test:integration # Run integration tests
npm run lint             # Check linting
npm run type-check       # Check TypeScript
npm run format           # Format code
npm run db:migrate       # Run migrations
npm run db:seed          # Seed test data
```

### Debug Commands
```bash
npm run db:shell         # Connect to database
DEBUG=* npm run dev      # Enable debug logging
npm run job:monitor      # Monitor job queue
npm run email:queue:status  # Check email queue
npm run redis:cli        # Connect to Redis
```

### File Locations
- API routes: `app/api/**/route.ts`
- Components: `app/components/**/*.tsx`
- Database: `supabase/migrations/`, `supabase/seed.sql`
- Tests: `**/__tests__/**/*.test.ts`
- Emails: `app/emails/*.tsx`
- Configuration: `next.config.js`, `.env.local`

### Getting Help
1. Check this guide first
2. Search issue tracker: `github.com/yourorg/taskflow/issues`
3. Ask in team Slack channel
4. Create detailed bug report with error logs

---

Last Updated: 2026-08-18  
Maintainer: TaskFlow Dev Team  
Version: 1.0.0
