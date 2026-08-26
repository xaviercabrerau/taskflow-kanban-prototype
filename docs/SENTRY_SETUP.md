# Sentry Error Tracking Setup Guide

Complete guide for setting up Sentry error tracking for the TaskFlow Notification System.

## Overview

Sentry provides real-time error monitoring, performance tracking, and debugging for our notification system. This guide covers:
- Creating a Sentry project
- Configuring DSN (Data Source Name)
- Integrating with Next.js
- Setting up environments (dev/staging/prod)
- Monitoring and alerting

## Prerequisites

- Sentry account (free tier available: https://sentry.io/signup/)
- Node.js 16+ installed
- Access to TaskFlow repository

## Step 1: Create Sentry Project

### 1.1 Sign Up / Log In

1. Go to https://sentry.io/
2. Create account or log in
3. Go to "Projects" dashboard

### 1.2 Create New Project

1. Click **+ Create Project** button
2. Select platform: **Next.js**
   - (Sentry will auto-detect Next.js if you proceed)
3. Alert rule preference: **Alert me on every new issue** (recommended for early feedback)
4. Click **Create Project**

### 1.3 Copy DSN

After project creation, you'll see the **DSN (Data Source Name)**:

```
https://<key>@<ingest>.ingest.sentry.io/<projectId>
```

**Save this DSN** - you'll need it for environment configuration.

## Step 2: Install Sentry SDK

### 2.1 Install Dependencies

```bash
npm install @sentry/nextjs
# or
yarn add @sentry/nextjs
# or
pnpm add @sentry/nextjs
```

### 2.2 Initialize Sentry CLI (Optional)

```bash
npm install --save-dev @sentry/cli

# Login to authorize CLI
npx @sentry/cli login
```

## Step 3: Environment Configuration

### 3.1 Update .env.local

Add Sentry configuration:

```env
# Sentry Error Tracking
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<ingest>.ingest.sentry.io/<projectId>
SENTRY_AUTH_TOKEN=sntrys_<token>  # For CLI authentication (optional)
SENTRY_ENVIRONMENT=development      # development, staging, production
SENTRY_ENABLED=true                 # Enable/disable Sentry
SENTRY_TRACE_SAMPLE_RATE=1.0        # Performance monitoring: 1.0 = 100%, 0.1 = 10%
SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1   # Session replay: 0.1 = 10% (lower for prod)
SENTRY_REPLAYS_ERROR_SAMPLE_RATE=1.0     # Always record sessions with errors
```

### 3.2 Create .env.staging (for staging environment)

```env
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<ingest>.ingest.sentry.io/<projectId>
SENTRY_ENVIRONMENT=staging
SENTRY_ENABLED=true
SENTRY_TRACE_SAMPLE_RATE=0.5        # 50% sampling for staging
SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1
```

### 3.3 Create .env.production (for production)

```env
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<ingest>.ingest.sentry.io/<projectId>
SENTRY_ENVIRONMENT=production
SENTRY_ENABLED=true
SENTRY_TRACE_SAMPLE_RATE=0.1        # 10% sampling for production (balance cost/data)
SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.01  # 1% sampling to reduce storage
SENTRY_REPLAYS_ERROR_SAMPLE_RATE=1.0     # Always record sessions with errors
```

## Step 4: Create Sentry Configuration File

Create `sentry.config.js` in project root:

```javascript
// sentry.config.js
import * as Sentry from "@sentry/nextjs";

const SENTRY_ENABLED = process.env.SENTRY_ENABLED === 'true';
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'development';
const SAMPLE_RATE = parseFloat(process.env.SENTRY_TRACE_SAMPLE_RATE || '0.1');

if (SENTRY_ENABLED && DSN) {
  Sentry.init({
    // Core Configuration
    dsn: DSN,
    environment: ENVIRONMENT,
    
    // Performance Monitoring
    tracesSampleRate: SAMPLE_RATE,
    
    // Session Replay (Session Replay is not available on Hobby plan)
    // Uncomment after upgrading to Team plan or higher
    replaysSessionSampleRate: parseFloat(
      process.env.SENTRY_REPLAYS_SESSION_SAMPLE_RATE || '0.1'
    ),
    replaysOnErrorSampleRate: parseFloat(
      process.env.SENTRY_REPLAYS_ERROR_SAMPLE_RATE || '1.0'
    ),
    
    // Release Tracking (for source maps)
    // Set during build process
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    
    // Filtering & Ignoring
    beforeSend(event, hint) {
      // Filter out specific errors
      if (event.exception) {
        const error = hint.originalException;
        
        // Ignore errors from browser extensions
        if (error.message?.includes('chrome-extension')) return null;
        
        // Ignore 404 errors in production
        if (
          ENVIRONMENT === 'production' &&
          event.tags?.['http.status_code'] === '404'
        ) {
          return null;
        }
      }
      
      return event;
    },
    
    // Integrations
    integrations: [
      new Sentry.Replay({
        maskAllText: true,
        blockAllMedia: true,
      }),
      new Sentry.CaptureConsole({
        levels: ['error', 'warn'],
      }),
      Sentry.replayIntegration(),
      Sentry.captureConsoleIntegration(),
    ],
    
    // Ignored URLs (filter out noise)
    ignoreErrors: [
      // Browser extensions
      'chrome-extension://',
      'moz-extension://',
      
      // Cross-origin errors
      'Script error',
      
      // Network errors that are expected
      'Network request failed',
      'TimeoutError',
      
      // Ads/tracking libraries
      'googlebot',
      'bingbot',
    ],
  });
}

export default Sentry;
```

## Step 5: Integrate with Next.js

### 5.1 Update next.config.js

```javascript
// next.config.js
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig = {
  // Your existing Next.js config
  reactStrictMode: true,
  // ... other config
};

export default withSentryConfig(nextConfig, {
  // Set the Sentry auth token as an environment variable
  // for Source Map Upload (optional)
  org: "your-org-slug",
  project: "your-project-slug",
  
  // An auth token is required for uploading source maps.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  
  // Suppresses source map uploading logs during build.
  silent: false,
  
  // Automatically tree-shake Sentry logger statements to reduce bundle size
  denyUrls: [
    // Browser extensions
    /extensions\//i,
    /^chrome:\/\//i,
    
    // Third-party scripts
    /vendor\//i,
  ],
});
```

### 5.2 Create instrumentation.ts (for app router)

For Next.js app router projects, create `instrumentation.ts` in project root:

```typescript
// instrumentation.ts
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Server-side initialization
    await import('./sentry.config');
  }
}
```

Or for pages router, update `_app.tsx`:

```typescript
// pages/_app.tsx
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import type { AppProps } from 'next/app';

import '../sentry.config';

function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // Client-side initialization
    Sentry.captureMessage('App initialized', 'info');
  }, []);

  return <Component {...pageProps} />;
}

export default Sentry.withProfiler(App);
```

## Step 6: Add Error Monitoring to API Routes

### 6.1 Wrap API Handlers

Create a wrapper for API routes in `lib/sentry-wrapper.ts`:

```typescript
// lib/sentry-wrapper.ts
import { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';

export function withSentry<T>(
  handler: (req: NextApiRequest, res: NextApiResponse<T>) => Promise<void> | void
) {
  return Sentry.wrapApiHandlerWithSentry(handler, '/api');
}
```

### 6.2 Use in API Route

```typescript
// pages/api/admin/users.ts
import { withSentry } from '@/lib/sentry-wrapper';
import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const scope = Sentry.getCurrentScope();
  scope.setTag('api_route', 'admin/users');
  scope.setTag('http_method', req.method);
  
  try {
    if (req.method === 'GET') {
      // Your handler logic
      res.status(200).json({ users: [] });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withSentry(handler);
```

## Step 7: Add Custom Error Monitoring

### 7.1 Capture Errors in Notification Service

```typescript
// lib/notifications/gmail.ts
import * as Sentry from '@sentry/nextjs';

export async function sendEmailNotification(
  to: string,
  subject: string,
  htmlContent: string
) {
  const transaction = Sentry.startTransaction({
    name: 'send.email.notification',
    op: 'email.send',
  });
  
  try {
    // Set context for error tracking
    Sentry.captureMessage(`Sending email to ${to}`, 'info');
    
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: Buffer.from(
          `To: ${to}\r\nSubject: ${subject}\r\n\r\n${htmlContent}`
        ).toString('base64'),
      },
    });
    
    transaction.setTag('email_status', 'sent');
    transaction.finish();
    
    return response;
  } catch (error) {
    // Capture with context
    Sentry.captureException(error, {
      tags: {
        service: 'gmail',
        operation: 'send_email',
        recipient: to,
      },
      contexts: {
        email: {
          to,
          subject,
          timestamp: new Date().toISOString(),
        },
      },
    });
    
    transaction.setTag('email_status', 'failed');
    transaction.setTag('error_type', error.name);
    transaction.finish();
    
    throw error;
  }
}
```

### 7.2 Add Request ID Tracking

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import * as Sentry from '@sentry/nextjs';

export function middleware(request: NextRequest) {
  const requestId = uuidv4();
  
  // Add request ID to Sentry context
  Sentry.setContext('request', {
    id: requestId,
    path: request.nextUrl.pathname,
    method: request.method,
  });
  
  const response = NextResponse.next();
  response.headers.set('x-request-id', requestId);
  
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
```

## Step 8: Configure Alerts and Notifications

### 8.1 Set Up Alert Rule

1. Go to Sentry project **Alerts** tab
2. Click **Create Alert Rule**
3. Configure:
   - **Name:** "Critical Errors in Production"
   - **Environment:** Production
   - **When:** 
     - Severity is error or higher
     - Happens more than 10 times in 5 minutes
   - **Then:**
     - Send to email
     - Send to Slack (optional)
     - Send to PagerDuty (optional)
4. Click **Save Rule**

### 8.2 Slack Integration (Optional)

1. In Sentry, go to **Settings > Integrations**
2. Click **Slack**
3. Authorize with your Slack workspace
4. Select channel for notifications
5. Save

### 8.3 Email Notifications

1. Go to **Settings > Notifications**
2. Check **Email** under Alerts
3. Add team members' emails
4. Save

## Step 9: Source Maps Setup (Optional but Recommended)

Source maps help with debugging minified code in production.

### 9.1 Configure in next.config.js

```javascript
// next.config.js
export default withSentryConfig(nextConfig, {
  org: "your-org-slug",
  project: "your-project-slug",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  
  // Upload source maps during build
  uploadSourceMaps: true,
  
  // Clean up source maps after upload
  deleteSourceMapsAfterUpload: true,
});
```

### 9.2 Get Auth Token

1. Go to Sentry **Settings > Auth Tokens**
2. Create new token with:
   - ✅ org:read
   - ✅ project:releases
   - ✅ project:write
3. Copy token to `SENTRY_AUTH_TOKEN` env var

## Step 10: Testing Sentry Configuration

### 10.1 Test Error Capture (Development)

```typescript
// pages/test-sentry.ts (Remove after testing!)
import * as Sentry from '@sentry/nextjs';

export default function handler(req, res) {
  if (req.query.test === 'error') {
    throw new Error('Test error from Sentry');
  }
  
  if (req.query.test === 'message') {
    Sentry.captureMessage('Test message from Sentry', 'info');
    return res.status(200).json({ message: 'Message captured' });
  }
  
  return res.status(200).json({ message: 'Use ?test=error or ?test=message' });
}
```

Test:
```bash
curl http://localhost:3000/api/test-sentry?test=message
curl http://localhost:3000/api/test-sentry?test=error  # Should error
```

### 10.2 Verify in Sentry Dashboard

1. Go to your Sentry project
2. Check **Issues** tab
3. Should see test error/message within 1-2 minutes
4. Click to view details, stack trace, context

## Step 11: Monitoring and Performance Tracking

### 11.1 Performance Monitoring Features

Sentry automatically tracks:
- Page load performance
- Route transitions
- API request latency
- Database query timing
- Error rates by endpoint

View in Sentry **Performance** tab.

### 11.2 Custom Performance Tracking

```typescript
import * as Sentry from '@sentry/nextjs';

async function fetchUserData(userId: string) {
  const transaction = Sentry.startTransaction({
    name: 'fetch.user.data',
    op: 'db.query',
  });
  
  try {
    const child = transaction.startChild({
      description: 'SELECT * FROM users WHERE id = ?',
      op: 'db.query.select',
    });
    
    const response = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    
    child.finish();
    transaction.finish();
    
    return response;
  } catch (error) {
    transaction.setStatus('error');
    transaction.finish();
    throw error;
  }
}
```

## Deployment Checklist

### Before Staging Deployment
- [ ] Sentry project created
- [ ] DSN configured in .env.staging
- [ ] SDK installed and configured
- [ ] next.config.js updated with withSentryConfig
- [ ] API routes wrapped with Sentry
- [ ] Error handling added to notification service
- [ ] Test error capture works
- [ ] Slack integration enabled (optional)

### Before Production Deployment
- [ ] All staging tests passed
- [ ] DSN configured in production environment
- [ ] Sample rates tuned (TRACE_SAMPLE_RATE = 0.1)
- [ ] Alert rules configured
- [ ] Source maps enabled
- [ ] Performance monitoring verified
- [ ] Team trained on Sentry dashboard
- [ ] Incident response procedure documented

## Monitoring Dashboards

### Key Metrics to Monitor

1. **Error Rate**
   - Target: < 0.1% error rate
   - Alert if: > 0.5% for 5 minutes

2. **Response Time (p95)**
   - Target: < 500ms
   - Alert if: > 1000ms for 5 minutes

3. **Email Delivery**
   - Target: > 99% success rate
   - Alert if: < 98% for 5 minutes

4. **API Availability**
   - Target: 99.9% uptime
   - Alert if: < 99.5% for 5 minutes

### Create Custom Dashboard

1. Sentry **Dashboards** tab
2. **Create Dashboard**
3. Add widgets:
   - Error rate chart
   - Response time percentiles
   - Error breakdown by endpoint
   - Top error types
4. Save and share with team

## Troubleshooting

### Errors Not Appearing in Sentry

1. **Check DSN is configured:**
   ```bash
   echo $NEXT_PUBLIC_SENTRY_DSN
   ```

2. **Check Sentry is enabled:**
   ```bash
   echo $SENTRY_ENABLED
   ```

3. **Check console for Sentry logs:**
   - Browser DevTools > Console
   - Should see "Sentry initialized" message

4. **Verify DNS/network connectivity:**
   ```bash
   curl https://ingest.sentry.io/api/0/store/
   ```

5. **Check error is not filtered:**
   - Review `beforeSend` in sentry.config.js
   - Check `ignoreErrors` list

### High Data Volume / Costs

1. **Reduce trace sample rate:**
   ```env
   SENTRY_TRACE_SAMPLE_RATE=0.05  # 5% instead of 10%
   ```

2. **Disable session replay:**
   ```env
   SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0
   ```

3. **Add URL filtering:**
   ```javascript
   ignoreErrors: ['chrome-extension://', 'moz-extension://'],
   ```

### Performance Impact

Sentry has minimal performance impact:
- SDK: ~50KB gzipped
- Network overhead: < 100ms per error
- Can be disabled with `SENTRY_ENABLED=false`

## References

- [Sentry Official Documentation](https://docs.sentry.io/)
- [Next.js Integration Guide](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Performance Monitoring](https://docs.sentry.io/platforms/javascript/performance/)
- [Source Maps](https://docs.sentry.io/platforms/javascript/source-maps/)
- [Alerts & Notifications](https://docs.sentry.io/product/alerts/)

## Support

For Sentry issues:
1. Check [Sentry Status](https://status.sentry.io/)
2. Review [Sentry Docs](https://docs.sentry.io/)
3. Contact Sentry Support (paid plans only)
4. Post in [Sentry GitHub Issues](https://github.com/getsentry/sentry)

---

**Last Updated:** 2026-08-18  
**Status:** Production Ready  
**Next Review:** 2026-09-18
