# TaskFlow Notification System: Error Tracking & Logging Configuration

**Status:** Configuration Guide v1.0  
**Last Updated:** 2026-08-18  
**Maintainer:** Engineering Team

---

## Overview

This document provides comprehensive error tracking and logging setup for the TaskFlow Notification System. It covers Sentry integration, error categorization, logging strategies, alerting mechanisms, and on-call workflows.

---

## SECTION 1: Sentry Configuration (Error Tracking)

### 1.1 Environment Setup

Create Sentry projects for each environment:

**Development**
- DSN: `https://<key>@sentry.io/<project-id>-dev`
- Sample Rate: 100% (all errors tracked)
- Release: `taskflow-notifications@dev`
- Auto-Capture: Enabled
- Session Replay: Disabled (performance)

**Staging**
- DSN: `https://<key>@sentry.io/<project-id>-staging`
- Sample Rate: 50% (reduced noise)
- Release: `taskflow-notifications@<git-hash>`
- Auto-Capture: Enabled
- Session Replay: Enabled (10% sample)

**Production**
- DSN: `https://<key>@sentry.io/<project-id>`
- Sample Rate: 10% (error sampling)
- Release: `taskflow-notifications@<semver>`
- Auto-Capture: Enabled
- Session Replay: Enabled (5% sample)

### 1.2 DSN Configuration

**Node.js Backend (.env configuration)**

```env
# Development
SENTRY_DSN_DEV=https://examplePublicKey@o0.ingest.sentry.io/0
SENTRY_ENVIRONMENT=development
SENTRY_RELEASE=taskflow-notifications@dev

# Staging
SENTRY_DSN_STAGING=https://examplePublicKey@o0.ingest.sentry.io/1
SENTRY_ENVIRONMENT=staging
SENTRY_RELEASE=taskflow-notifications@1.0.0-rc.1

# Production
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/2
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=taskflow-notifications@1.0.0
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.05
```

**Next.js Frontend (next.config.js)**

```javascript
const withSentryConfig = require("@sentry/nextjs/config");

module.exports = withSentryConfig(
  {
    // Your Next.js config
  },
  {
    org: "your-org",
    project: "taskflow-notifications-web",
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: false,
    widenClientFileUpload: true,
    telemetryEnabled: true,
    hideSourceMaps: true,
  }
);
```

### 1.3 Initialization (Node.js)

**lib/sentry-server.ts**

```typescript
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

export function initSentry() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    release: process.env.SENTRY_RELEASE,
    
    // Performance Monitoring
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || "0.05"),
    
    // Integrations
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.OnUncaughtException(),
      new Sentry.Integrations.OnUnhandledRejection(),
      nodeProfilingIntegration(),
    ],
    
    // Error Filtering
    beforeSend(event, hint) {
      // Ignore 404 errors
      if (event.tags?.statusCode === 404) {
        return null;
      }
      
      // Ignore test errors
      if (process.env.NODE_ENV === "test") {
        return null;
      }
      
      return event;
    },
    
    // Denormalize error payloads for PII scrubbing
    maxValueLength: 1024,
  });
}
```

### 1.4 Release Tracking

**Setup Release in Sentry CLI (during deployment)**

```bash
# Install Sentry CLI
npm install -g @sentry/cli

# Create release
export SENTRY_ORG=your-org
export SENTRY_PROJECT=taskflow-notifications
export SENTRY_AUTH_TOKEN=<your-token>

sentry-cli releases create $VERSION
sentry-cli releases set-commits $VERSION --auto
sentry-cli releases files upload-sourcemaps ./dist

# Mark as deployed
sentry-cli releases deploys $VERSION new -e production
sentry-cli releases finalize $VERSION
```

**Integration in CI/CD (GitHub Actions)**

```yaml
name: Deploy with Sentry

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build
        run: npm run build
      
      - name: Create Sentry Release
        uses: getsentry/action-release@v1
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: your-org
          SENTRY_PROJECT: taskflow-notifications
        with:
          version: v${{ github.run_number }}
          environment: production
```

### 1.5 Sourcemap Upload

**Setup in package.json**

```json
{
  "scripts": {
    "build": "next build && npm run upload-sourcemaps",
    "upload-sourcemaps": "sentry-cli sourcemaps upload --org your-org --project taskflow-notifications ./out"
  }
}
```

### 1.6 Error Sampling & Rate Limiting

**Dynamic Sampling Rules (Sentry Dashboard)**

```
Rule 1: Error Events
- If event.error_level == "error"
- Set sample rate to 100%

Rule 2: Info Events (High Volume)
- If event.level == "info" AND tags.endpoint == "/api/health"
- Set sample rate to 10%

Rule 3: Transaction Events
- If event.type == "transaction"
- Set sample rate to 10% for production

Rule 4: Gmail API Errors
- If tags.service == "gmail-api"
- Set sample rate to 100% (always track)

Rule 5: Job Processing
- If tags.service == "job-processor"
- Set sample rate to 50%
```

### 1.7 PII Scrubbing Rules

**lib/sentry-filters.ts**

```typescript
import * as Sentry from "@sentry/node";

const PII_PATTERNS = {
  email: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi,
  phone: /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/g,
  creditCard: /(\d{4}[\s-]?){3}\d{4}/g,
  ssn: /\d{3}-\d{2}-\d{4}/g,
  apiKey: /(api[_-]?key|secret|token)\s*[:=]\s*([a-zA-Z0-9_-]+)/gi,
};

export function scrubPII(text: string): string {
  let scrubbed = text;
  
  Object.entries(PII_PATTERNS).forEach(([type, pattern]) => {
    scrubbed = scrubbed.replace(pattern, `[${type.toUpperCase()}]`);
  });
  
  return scrubbed;
}

// Initialize with Sentry
Sentry.init({
  beforeSend(event) {
    // Scrub all string values in event
    const scrubEvent = JSON.parse(JSON.stringify(event), (key, value) => {
      if (typeof value === "string") {
        return scrubPII(value);
      }
      return value;
    });
    
    return scrubEvent;
  },
});
```

### 1.8 Custom Error Types for Notifications System

**lib/custom-errors.ts**

```typescript
import * as Sentry from "@sentry/node";

export class NotificationError extends Error {
  constructor(
    message: string,
    public code: string,
    public context: Record<string, any> = {}
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export class GmailAPIError extends NotificationError {
  constructor(message: string, public statusCode: number, context?: any) {
    super(message, "GMAIL_API_ERROR", context);
    this.name = "GmailAPIError";
  }
}

export class DatabaseError extends NotificationError {
  constructor(message: string, context?: any) {
    super(message, "DATABASE_ERROR", context);
    this.name = "DatabaseError";
  }
}

export class RedisError extends NotificationError {
  constructor(message: string, context?: any) {
    super(message, "REDIS_ERROR", context);
    this.name = "RedisError";
  }
}

export class JobProcessingError extends NotificationError {
  constructor(message: string, public jobId: string, context?: any) {
    super(message, "JOB_PROCESSING_ERROR", { jobId, ...context });
    this.name = "JobProcessingError";
  }
}

// Sentry integration
Sentry.init({
  integrations: [
    new Sentry.Integrations.OnUncaughtException(),
    new Sentry.Integrations.OnUnhandledRejection(),
  ],
});

// Capture with context
export function captureNotificationError(error: NotificationError) {
  Sentry.captureException(error, {
    tags: {
      errorCode: error.code,
      errorType: error.name,
    },
    contexts: {
      notificationError: {
        code: error.code,
        ...error.context,
      },
    },
  });
}
```

---

## SECTION 2: Error Categories

### 2.1 Gmail API Errors

**Authentication Failures**

```typescript
// Error Code: GMAIL_AUTH_FAILED
// Status: 401 Unauthorized

interface GmailAuthError {
  type: "GMAIL_AUTH_FAILED";
  statusCode: 401;
  message: string;
  details: {
    reason: "invalid_grant" | "access_denied" | "expired_token";
    refreshNeeded: boolean;
    userId: string;
  };
}

// Recovery: Trigger token refresh, notify user to re-authenticate
```

**Rate Limiting (429)**

```typescript
// Error Code: GMAIL_RATE_LIMITED
// Status: 429 Too Many Requests
// Action: Exponential backoff (1s, 2s, 4s, 8s, 16s)

interface GmailRateLimitError {
  type: "GMAIL_RATE_LIMITED";
  statusCode: 429;
  retryAfter: number; // seconds
  details: {
    quotaResetTime: Date;
    currentQuotaUsage: number;
    quotaLimit: number;
  };
}
```

**Quota Exceeded**

```typescript
// Error Code: GMAIL_QUOTA_EXCEEDED
// Status: 403 Forbidden
// Action: Wait until next quota reset (24 hours)

interface GmailQuotaError {
  type: "GMAIL_QUOTA_EXCEEDED";
  statusCode: 403;
  details: {
    quotaResetTime: Date;
    projectedQuotaUsagePercentage: number;
  };
}
```

**Invalid Email Format**

```typescript
// Error Code: INVALID_EMAIL_FORMAT
// Status: 400 Bad Request
// Action: Log validation error, don't retry

interface InvalidEmailError {
  type: "INVALID_EMAIL_FORMAT";
  statusCode: 400;
  details: {
    email: string;
    reason: "malformed" | "invalid_domain" | "blocked_domain";
  };
}
```

### 2.2 Database Errors

**Connection Refused**

```typescript
// Error Code: DB_CONNECTION_REFUSED
// Severity: CRITICAL
// Action: Immediate alert, circuit breaker activation

interface DBConnectionError {
  type: "DB_CONNECTION_REFUSED";
  details: {
    host: string;
    port: number;
    error: string;
  };
  recoveryTime: number; // estimate in seconds
}
```

**Query Timeouts**

```typescript
// Error Code: DB_QUERY_TIMEOUT
// Severity: HIGH
// Threshold: > 30 seconds
// Action: Kill query, log slow query analysis

interface DBTimeoutError {
  type: "DB_QUERY_TIMEOUT";
  details: {
    query: string; // sanitized
    duration: number; // ms
    timeout: number; // ms
    userId?: string;
  };
}
```

**RLS Policy Violations**

```typescript
// Error Code: RLS_POLICY_VIOLATION
// Severity: HIGH
// Action: Log access attempt, notify security team

interface RLSViolationError {
  type: "RLS_POLICY_VIOLATION";
  statusCode: 403;
  details: {
    userId: string;
    table: string;
    operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
    reason: string;
  };
}
```

**Lock Deadlocks**

```typescript
// Error Code: DB_DEADLOCK
// Severity: MEDIUM
// Action: Retry with exponential backoff, max 3 attempts

interface DBDeadlockError {
  type: "DB_DEADLOCK";
  details: {
    tables: string[];
    deadlockTime: Date;
    retryAttempt: number;
  };
}
```

### 2.3 Redis Errors

**Connection Timeouts**

```typescript
// Error Code: REDIS_CONNECTION_TIMEOUT
// Severity: CRITICAL
// Action: Fallback to database, alert on-call

interface RedisConnectionError {
  type: "REDIS_CONNECTION_TIMEOUT";
  details: {
    host: string;
    port: number;
    timeout: number; // ms
    connectionAttempt: number;
  };
}
```

**Memory Limits**

```typescript
// Error Code: REDIS_OOM
// Severity: HIGH
// Threshold: Approaching 80% capacity
// Action: Trigger eviction policy, clear old keys

interface RedisMemoryError {
  type: "REDIS_OOM";
  details: {
    usedMemory: number; // bytes
    maxMemory: number; // bytes
    usagePercentage: number;
  };
}
```

**Key Expiration Issues**

```typescript
// Error Code: REDIS_KEY_EXPIRED
// Severity: MEDIUM
// Action: Regenerate key, log expiration pattern

interface RedisKeyExpiredError {
  type: "REDIS_KEY_EXPIRED";
  details: {
    key: string; // pattern like: notification:*
    expectedTTL: number; // seconds
    actualTTL: number | null;
  };
}
```

**Pub/Sub Failures**

```typescript
// Error Code: REDIS_PUBSUB_FAILURE
// Severity: HIGH
// Action: Retry subscription, alert on-call

interface RedisPubSubError {
  type: "REDIS_PUBSUB_FAILURE";
  details: {
    channel: string;
    operation: "SUBSCRIBE" | "PUBLISH" | "UNSUBSCRIBE";
    error: string;
  };
}
```

### 2.4 Job Processing Errors

**Job Timeout (> 5 minutes)**

```typescript
// Error Code: JOB_TIMEOUT
// Severity: HIGH
// Action: Kill job, mark as failed, retry with different parameters

interface JobTimeoutError {
  type: "JOB_TIMEOUT";
  details: {
    jobId: string;
    jobType: string;
    timeout: number; // ms
    duration: number; // ms
    payload: Record<string, any>; // sanitized
  };
}
```

**Retry Exhaustion (3 failed attempts)**

```typescript
// Error Code: JOB_RETRIES_EXHAUSTED
// Severity: HIGH
// Action: Move to dead-letter queue, alert engineering team

interface JobRetryError {
  type: "JOB_RETRIES_EXHAUSTED";
  details: {
    jobId: string;
    jobType: string;
    attemptCount: number;
    lastError: string;
    payload: Record<string, any>;
  };
}
```

**Invalid Payload**

```typescript
// Error Code: INVALID_JOB_PAYLOAD
// Severity: MEDIUM
// Action: Log validation errors, move to dead-letter queue

interface InvalidPayloadError {
  type: "INVALID_JOB_PAYLOAD";
  details: {
    jobId: string;
    jobType: string;
    validationErrors: Record<string, string[]>;
    payload: any; // sanitized
  };
}
```

**Missing Dependencies**

```typescript
// Error Code: MISSING_JOB_DEPENDENCY
// Severity: MEDIUM
// Action: Delay job, log missing resource, retry later

interface MissingDependencyError {
  type: "MISSING_JOB_DEPENDENCY";
  details: {
    jobId: string;
    missingResource: string; // e.g., "user:123", "template:email-welcome"
    resourceType: string;
  };
}
```

### 2.5 API Errors

**400 Bad Request (Validation)**

```typescript
// Status: 400
// Severity: LOW
// Action: Log validation pattern, notify client

interface ValidationError {
  status: 400;
  code: "VALIDATION_ERROR";
  message: string;
  details: {
    field: string;
    rule: string;
    value: any;
  }[];
}
```

**401 Unauthorized (Auth)**

```typescript
// Status: 401
// Severity: MEDIUM
// Action: Log auth failure, trigger new login

interface AuthError {
  status: 401;
  code: "UNAUTHORIZED";
  reason: "missing_token" | "invalid_token" | "expired_token" | "insufficient_scope";
}
```

**403 Forbidden (RLS)**

```typescript
// Status: 403
// Severity: MEDIUM
// Action: Log access denial, audit

interface ForbiddenError {
  status: 403;
  code: "FORBIDDEN";
  reason: "insufficient_permissions" | "organization_mismatch";
}
```

**404 Not Found**

```typescript
// Status: 404
// Severity: LOW (mostly ignored)
// Action: Log if unexpected, suppress from alerts

interface NotFoundError {
  status: 404;
  code: "NOT_FOUND";
  resource: string;
}
```

**422 Unprocessable Entity (Parsing)**

```typescript
// Status: 422
// Severity: MEDIUM
// Action: Log parsing error, notify client of format issue

interface UnprocessableError {
  status: 422;
  code: "UNPROCESSABLE_ENTITY";
  field: string;
  reason: "invalid_format" | "type_mismatch";
}
```

**429 Too Many Requests (Rate Limit)**

```typescript
// Status: 429
// Severity: MEDIUM
// Action: Implement client-side backoff, log pattern

interface RateLimitError {
  status: 429;
  code: "RATE_LIMITED";
  retryAfter: number; // seconds
  limit: number;
  remaining: number;
  resetTime: Date;
}
```

**500 Internal Server Error**

```typescript
// Status: 500
// Severity: CRITICAL
// Action: Immediate alert, trigger on-call escalation

interface InternalError {
  status: 500;
  code: "INTERNAL_SERVER_ERROR";
  errorId: string; // correlation ID for logs
  message: string;
  trace?: string;
}
```

---

## SECTION 3: Logging Configuration

### 3.1 Log Levels

```typescript
export enum LogLevel {
  DEBUG = 0,    // Detailed debugging info, performance metrics
  INFO = 1,     // General informational messages
  WARN = 2,     // Warning conditions, potential issues
  ERROR = 3,    // Error conditions, recovery attempted
  CRITICAL = 4, // Critical errors, immediate action needed
}

// Production Thresholds
const LOG_LEVEL_THRESHOLDS = {
  development: LogLevel.DEBUG,     // All logs
  staging: LogLevel.INFO,          // Info and above
  production: LogLevel.WARN,       // Warnings and above
};
```

### 3.2 Log Retention

**Vercel Logs (Application Logs)**
- Retention: 30 days
- Accessible via: Vercel Dashboard → Functions
- Sampling: High-volume endpoints (health checks) sampled at 10%

**Sentry (Error Logs)**
- Retention: 90 days (can extend to 1 year)
- Auto-retention: Automatic deletion after period
- Configuration in Sentry Dashboard → Settings → Data Retention

**Database Logs (Audit Logs)**
- Retention: 1 year (for compliance)
- Table: `audit_logs` in PostgreSQL
- Indexed by: `timestamp`, `user_id`, `action`

```sql
-- Setup retention policy
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID NOT NULL,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT audit_logs_retention CHECK (
    created_at > CURRENT_TIMESTAMP - INTERVAL '1 year'
  )
);

-- Partitioning for performance
CREATE TABLE audit_logs_2024 PARTITION OF audit_logs
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

### 3.3 Structured Logging Format (JSON)

**lib/logger.ts**

```typescript
import * as Sentry from "@sentry/node";

interface LogContext {
  userId?: string;
  organizationId?: string;
  correlationId?: string;
  duration?: number; // ms
  endpoint?: string;
  method?: string;
  statusCode?: number;
  [key: string]: any;
}

export class Logger {
  private context: LogContext = {};

  setContext(context: Partial<LogContext>) {
    this.context = { ...this.context, ...context };
  }

  private format(level: string, message: string, meta?: any) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      environment: process.env.NODE_ENV,
      version: process.env.SENTRY_RELEASE,
      ...this.context,
      ...(meta && { meta }),
    });
  }

  debug(message: string, meta?: any) {
    console.debug(this.format("DEBUG", message, meta));
  }

  info(message: string, meta?: any) {
    console.log(this.format("INFO", message, meta));
  }

  warn(message: string, meta?: any) {
    console.warn(this.format("WARN", message, meta));
  }

  error(message: string, error?: Error | unknown, meta?: any) {
    console.error(this.format("ERROR", message, meta));
    
    if (error instanceof Error) {
      Sentry.captureException(error, {
        contexts: {
          logger: this.context,
          ...meta,
        },
      });
    }
  }

  critical(message: string, error?: Error | unknown, meta?: any) {
    console.error(this.format("CRITICAL", message, meta));
    
    if (error instanceof Error) {
      Sentry.captureException(error, {
        level: "fatal",
        contexts: {
          logger: this.context,
          ...meta,
        },
      });
    }
  }
}

export const logger = new Logger();
```

**Usage Example**

```typescript
// In API route handler
const correlationId = req.headers["x-correlation-id"] || generateId();
logger.setContext({
  correlationId,
  userId: user?.id,
  organizationId: user?.organizationId,
  endpoint: req.url,
  method: req.method,
});

logger.info("Processing notification", { notificationId: "123" });
// Output: {"timestamp":"2026-08-18T...", "level":"INFO", "message":"Processing notification", "correlationId":"...", "meta":{"notificationId":"123"}}
```

### 3.4 Log Sampling for High-Volume Endpoints

**middleware/logging.ts**

```typescript
import { Request, Response, NextFunction } from "express";
import { logger } from "@/lib/logger";

const HIGH_VOLUME_ENDPOINTS = [
  "/api/health",
  "/api/heartbeat",
  "/api/metrics",
];

function shouldLogRequest(req: Request): boolean {
  // Always log errors
  if (req.statusCode && req.statusCode >= 400) {
    return true;
  }

  // Sample high-volume endpoints at 10%
  const endpoint = req.path;
  if (HIGH_VOLUME_ENDPOINTS.includes(endpoint)) {
    return Math.random() < 0.1;
  }

  // Log all other requests
  return true;
}

export function loggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const startTime = Date.now();
  
  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - startTime;
    
    if (shouldLogRequest(req)) {
      logger.setContext({
        endpoint: req.path,
        method: req.method,
        statusCode: res.statusCode,
        duration,
      });

      if (res.statusCode >= 500) {
        logger.error(`Request failed: ${req.method} ${req.path}`);
      } else if (res.statusCode >= 400) {
        logger.warn(`Client error: ${req.method} ${req.path}`);
      } else {
        logger.info(`Request completed: ${req.method} ${req.path}`);
      }
    }

    return originalSend.call(this, data);
  };

  next();
}
```

---

## SECTION 4: Error Alerts

### 4.1 Alert Conditions

**New Error Type (First Occurrence)**

```yaml
# Sentry Alert Rule: New Error Type
Conditions:
  - A new issue is created

Actions:
  - Send to #notifications-errors Slack channel
  - Assign to on-call engineer
  - Create PagerDuty incident (severity: warning)

Message: |
  🚨 New error detected: {{error.title}}
  Level: {{error.level}}
  Count: {{error.count}}
  Latest: {{error.lastSeen}}
  [View in Sentry]({{error.url}})
```

**Error Rate Spike (> 0.5%)**

```yaml
# Sentry Alert Rule: Error Rate Spike
Conditions:
  - Error rate is 0.5% or higher in last 5 minutes
  - Error rate increased by 10% compared to baseline

Actions:
  - Send to #notifications-alerts
  - Create PagerDuty incident (severity: critical)
  - Trigger on-call escalation if not acknowledged in 15 min

Threshold:
  - Warning: 0.25% error rate
  - Critical: 0.5% error rate
```

**Specific High-Severity Errors**

```yaml
# Alert Rule: Critical Service Errors
Conditions:
  - Error code in [GMAIL_AUTH_FAILED, DB_CONNECTION_REFUSED, REDIS_CONNECTION_TIMEOUT]
  - Environment == production

Actions:
  - Send to #critical-alerts
  - Page on-call engineer immediately
  - Create critical incident in PagerDuty

Priority: P1 (Immediate response required)
```

**Daily Error Digest**

```yaml
# Scheduled Alert: Daily Error Summary
Schedule: "0 9 * * *" (9 AM UTC daily)

Content:
  - Total errors (24h): {{total_errors}}
  - Error rate (24h): {{error_rate}}%
  - Top 5 errors by frequency:
    1. {{error_1_title}} - {{count}} occurrences
    2. {{error_2_title}} - {{count}} occurrences
    ...
  - Affected users: {{affected_user_count}}
  - P1 errors: {{critical_error_count}}

Recipient: #notifications-digest email list
```

### 4.2 Slack Integration

**slack.config.ts**

```typescript
import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function sendErrorAlert(
  error: {
    code: string;
    message: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    context?: Record<string, any>;
  },
  channel: string
) {
  const colorMap = {
    LOW: "#FFAA00",
    MEDIUM: "#FF6600",
    HIGH: "#FF3300",
    CRITICAL: "#FF0000",
  };

  await slack.chat.postMessage({
    channel,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${error.severity} Error Alert`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Code:*\n\`${error.code}\``,
          },
          {
            type: "mrkdwn",
            text: `*Severity:*\n${error.severity}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Message:*\n${error.message}`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_${new Date().toISOString()}_`,
          },
        ],
      },
    ],
  });
}

// Usage
await sendErrorAlert(
  {
    code: "GMAIL_AUTH_FAILED",
    message: "Failed to authenticate with Gmail API",
    severity: "CRITICAL",
    context: { userId: "user-123" },
  },
  "#notifications-alerts"
);
```

### 4.3 PagerDuty Integration

**pagerduty.config.ts**

```typescript
import axios from "axios";

export async function triggerPagerDutyIncident(
  errorInfo: {
    code: string;
    message: string;
    severity: "warning" | "critical";
    context?: Record<string, any>;
  }
) {
  const severityMap = {
    warning: "warning",
    critical: "critical",
  };

  const response = await axios.post(
    "https://events.pagerduty.com/v2/enqueue",
    {
      routing_key: process.env.PAGERDUTY_ROUTING_KEY,
      event_action: "trigger",
      payload: {
        summary: `[${errorInfo.severity.toUpperCase()}] ${errorInfo.code}: ${errorInfo.message}`,
        severity: severityMap[errorInfo.severity],
        source: "TaskFlow Notification System",
        custom_details: errorInfo.context,
      },
      client: "TaskFlow Monitoring",
      client_url: `${process.env.APP_URL}/admin/incidents`,
    }
  );

  return response.data;
}
```

---

## SECTION 5: Error Analysis

### 5.1 Error Trends Dashboard

**Implementation using Sentry Stats API**

```typescript
// pages/admin/error-dashboard.tsx
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

export function ErrorDashboard() {
  const { data: errors } = useQuery({
    queryKey: ["error-stats"],
    queryFn: async () => {
      const response = await fetch("/api/admin/error-stats?days=7");
      return response.json();
    },
  });

  return (
    <div className="grid grid-cols-4 gap-4 mb-8">
      <MetricCard
        title="Total Errors (24h)"
        value={errors?.last24h.total}
        trend={errors?.last24h.trend}
      />
      <MetricCard
        title="Error Rate"
        value={`${errors?.errorRate.toFixed(2)}%`}
        threshold={0.5}
      />
      <MetricCard
        title="Affected Users"
        value={errors?.affectedUsers}
      />
      <MetricCard
        title="P1 Errors"
        value={errors?.p1Count}
        severity="critical"
      />
    </div>
  );
}
```

**Backend Implementation (api/admin/error-stats.ts)**

```typescript
import { getSentry } from "@/lib/sentry-server";

export async function getErrorStats(days: number = 7) {
  const sentry = getSentry();
  
  // Query error events from past N days
  const query = `
    is:error
    is:resolved:false
    age:-${days}d
  `;

  const stats = await sentry.client.get(`/organizations/your-org/events-stats/`, {
    params: {
      query,
      interval: "1h",
      statsPeriod: `${days}d`,
    },
  });

  return {
    last24h: {
      total: stats.data[stats.data.length - 1].total,
      trend: calculateTrend(stats.data),
    },
    errorRate: calculateErrorRate(stats),
    affectedUsers: await getAffectedUserCount(stats),
    p1Count: await getP1ErrorCount(),
  };
}
```

### 5.2 Error Grouping & Analysis

**API: Group errors by type/endpoint**

```typescript
// api/admin/error-groups.ts
export async function getErrorGroups(
  groupBy: "type" | "endpoint" | "user",
  limit: number = 10
) {
  const groups = await db.sql`
    SELECT 
      CASE 
        WHEN $1 = 'type' THEN error_code
        WHEN $1 = 'endpoint' THEN endpoint
        WHEN $1 = 'user' THEN user_id
      END as group_key,
      COUNT(*) as count,
      MAX(created_at) as last_occurrence,
      ARRAY_AGG(DISTINCT error_code) as error_codes
    FROM error_logs
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY group_key
    ORDER BY count DESC
    LIMIT $2
  ` [groupBy, limit];

  return groups;
}
```

**Example Output**

```json
[
  {
    "group_key": "GMAIL_RATE_LIMITED",
    "count": 2341,
    "last_occurrence": "2026-08-18T14:32:00Z",
    "error_codes": ["GMAIL_RATE_LIMITED"]
  },
  {
    "group_key": "/api/notifications/send",
    "count": 1205,
    "last_occurrence": "2026-08-18T14:28:00Z",
    "error_codes": ["GMAIL_API_ERROR", "DB_TIMEOUT", "REDIS_ERROR"]
  }
]
```

### 5.3 Stack Trace Aggregation

**Sentry Grouping Rules**

```yaml
# .sentry/sentry.conf.yaml
group-by-error-attributes:
  - error.type
  - error.value
  - stack.module
  - stack.function

group-by-message-patterns:
  - "^\\[([A-Z_]+)\\]"  # Extract error code
  - "^(ConnectionError|TimeoutError|ValidationError)"

group-by-fingerprint:
  - "{{ error.type }}"
  - "{{ error.value }}"
  - "{{ stack.frames.-1.function }}"
```

### 5.4 Reproduction Steps Collection

**Automatic Collection via Error Boundary**

```typescript
// components/ErrorBoundary.tsx
export class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const steps = this.getReproductionSteps();

    Sentry.captureException(error, {
      contexts: {
        reproduction: {
          steps,
          url: window.location.href,
          userAgent: navigator.userAgent,
          pageTitle: document.title,
        },
      },
    });
  }

  private getReproductionSteps(): string[] {
    // Get browser history from sessionStorage
    return JSON.parse(
      sessionStorage.getItem("reproductionSteps") || "[]"
    );
  }
}

// Track user actions for reproduction
export function useReproductionTracking() {
  useEffect(() => {
    const steps = [];

    const handleClick = (e: MouseEvent) => {
      steps.push(`Clicked: ${(e.target as HTMLElement).textContent}`);
      saveSteps(steps);
    };

    document.addEventListener("click", handleClick);

    return () => document.removeEventListener("click", handleClick);
  }, []);
}

function saveSteps(steps: string[]) {
  sessionStorage.setItem("reproductionSteps", JSON.stringify(steps));
}
```

---

## SECTION 6: Integration Points

### 6.1 Sentry SDK Integration in Node.js

**Automatic Error Capture**

```typescript
// server/middleware/sentry-handler.ts
import express from "express";
import * as Sentry from "@sentry/node";

const app = express();

// Initialize Sentry
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.OnUncaughtException(),
    new Sentry.Integrations.OnUnhandledRejection(),
  ],
  tracesSampleRate: 0.1,
});

// Must be first middleware
app.use(Sentry.Handlers.requestHandler());

// Your routes...
app.use("/api", apiRouter);

// Error handler - must be last
app.use(Sentry.Handlers.errorHandler());
```

**Manual Error Capture**

```typescript
// Anywhere in code
import * as Sentry from "@sentry/node";

try {
  await sendNotification(notificationId);
} catch (error) {
  Sentry.captureException(error, {
    tags: {
      service: "notifications",
      operation: "send",
    },
    extra: {
      notificationId,
    },
  });
}
```

### 6.2 Error Boundary in React Components

**React Error Boundary**

```typescript
// components/ErrorBoundary.tsx
import * as Sentry from "@sentry/react";
import { useEffect } from "react";

const ErrorBoundaryComponent = ({ children }) => {
  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div className="error-container">
          <h1>Something went wrong</h1>
          <p>{error?.message}</p>
          <button onClick={resetError}>Try again</button>
        </div>
      )}
      showDialog
    >
      {children}
    </Sentry.ErrorBoundary>
  );
};

export default Sentry.withErrorBoundary(ErrorBoundaryComponent, {
  fallback: <div>An error occurred</div>,
  showDialog: true,
});
```

**Profiler for Performance Monitoring**

```typescript
import * as Sentry from "@sentry/react";

export function NotificationList() {
  return (
    <Sentry.Profiler name="NotificationList">
      <div>
        {notifications.map(notification => (
          <NotificationCard key={notification.id} {...notification} />
        ))}
      </div>
    </Sentry.Profiler>
  );
}
```

### 6.3 Error Middleware in API Routes

**Error Handler Middleware**

```typescript
// middleware/error-handler.ts
import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { NotificationError } from "@/lib/custom-errors";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Log the error
  console.error("Unhandled error:", err);

  // Capture in Sentry
  Sentry.captureException(err, {
    tags: {
      endpoint: req.path,
      method: req.method,
    },
  });

  // Handle custom notification errors
  if (err instanceof NotificationError) {
    return res.status(400).json({
      error: err.code,
      message: err.message,
      context: err.context,
    });
  }

  // Handle generic errors
  const statusCode = (err as any).statusCode || 500;
  const errorId = Sentry.captureException(err);

  res.status(statusCode).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
    errorId,
  });
}

// Usage in Express app
app.use(errorHandler);
```

### 6.4 Webhook Error Notifications

**Setup Sentry Webhooks**

```typescript
// pages/api/webhooks/sentry-events.ts
export async function POST(req: Request) {
  const event = req.body;

  // Determine channel based on severity
  const channel = determineChannel(event);

  // Send to Slack
  await sendSlackNotification(channel, event);

  // Create database record for audit
  await db.errorEvents.create({
    sentryEventId: event.id,
    errorCode: event.tags?.errorCode,
    severity: event.level,
    message: event.message,
    context: event.contexts,
  });

  return Response.json({ success: true });
}

function determineChannel(event: any): string {
  if (event.level === "fatal" || event.tags?.severity === "CRITICAL") {
    return "#critical-alerts";
  }
  if (event.level === "error") {
    return "#notifications-errors";
  }
  return "#notifications-debug";
}
```

**Register webhook in Sentry Dashboard**

```
Settings → Integrations → Webhooks
URL: https://yourapp.com/api/webhooks/sentry-events
Events: Issue Created, Issue Assigned, Issue Resolved
Auth: Token (set as X-Sentry-Hook-Signature header)
```

---

## SECTION 7: On-Call Workflow

### 7.1 Error Routing to Slack/PagerDuty

**Escalation Matrix**

```
ERROR SEVERITY → RESPONSE CHANNEL → ON-CALL ROUTING
├─ P1 (Critical)
│  ├─ Channel: #critical-alerts
│  ├─ PagerDuty: Trigger incident (urgency: high)
│  ├─ Page: On-call engineer immediately
│  └─ Response SLA: 5 minutes
│
├─ P2 (High)
│  ├─ Channel: #notifications-alerts
│  ├─ PagerDuty: Trigger incident (urgency: low)
│  ├─ Page: On-call if not auto-resolved in 10 min
│  └─ Response SLA: 30 minutes
│
└─ P3 (Medium)
   ├─ Channel: #notifications-errors
   ├─ PagerDuty: Create alert (no paging)
   ├─ Daily digest: Include in morning standup
   └─ Response SLA: 24 hours
```

### 7.2 On-Call Assignment

**Rotation Setup**

```
// schedule.json - On-call rotation
{
  "rotations": [
    {
      "id": "notifications-primary",
      "name": "Notifications Team (Primary)",
      "members": [
        { "name": "Alice", "start": "2026-08-18", "duration": "1 week" },
        { "name": "Bob", "start": "2026-08-25", "duration": "1 week" },
        { "name": "Carol", "start": "2026-09-01", "duration": "1 week" }
      ],
      "backupRotation": "notifications-secondary"
    },
    {
      "id": "notifications-secondary",
      "name": "Notifications Team (Secondary)",
      "members": [
        { "name": "David", "start": "2026-08-18" },
        { "name": "Emma", "start": "2026-08-25" }
      ]
    }
  ]
}
```

**PagerDuty Schedule API Integration**

```typescript
// lib/pagerduty-schedule.ts
import axios from "axios";

export async function getOnCallEngineer(rotationId: string) {
  const response = await axios.get(
    `https://api.pagerduty.com/schedules/${rotationId}`,
    {
      headers: {
        Authorization: `Token token=${process.env.PAGERDUTY_API_TOKEN}`,
        Accept: "application/vnd.pagerduty+json;version=2",
      },
    }
  );

  const schedule = response.data.schedule;
  const oncall = await axios.get(
    `https://api.pagerduty.com/schedules/${rotationId}/renderedScheduleEntries`,
    {
      params: {
        since: new Date().toISOString(),
        until: new Date(Date.now() + 86400000).toISOString(),
      },
      headers: {
        Authorization: `Token token=${process.env.PAGERDUTY_API_TOKEN}`,
        Accept: "application/vnd.pagerduty+json;version=2",
      },
    }
  );

  return {
    engineer: oncall.data.renderedScheduleEntries[0].user.summary,
    startTime: oncall.data.renderedScheduleEntries[0].start,
    endTime: oncall.data.renderedScheduleEntries[0].end,
  };
}
```

### 7.3 Escalation if Not Acknowledged in 15 Minutes

**Escalation Policy**

```typescript
// jobs/escalation-handler.ts
import { Queue } from "bullmq";
import { logger } from "@/lib/logger";

const escalationQueue = new Queue("escalation", {
  connection: redisClient,
});

// When incident is triggered
export async function triggerIncident(incident: {
  id: string;
  severity: string;
  incidentKey: string;
}) {
  // Schedule escalation check in 15 minutes
  await escalationQueue.add(
    "check-acknowledgment",
    {
      incidentId: incident.id,
      incidentKey: incident.incidentKey,
    },
    {
      delay: 15 * 60 * 1000, // 15 minutes
    }
  );

  logger.info("Incident escalation scheduled", { incidentId: incident.id });
}

// Job processor
escalationQueue.process("check-acknowledgment", async (job) => {
  const { incidentId } = job.data;

  // Check if acknowledged in PagerDuty
  const incident = await getPagerDutyIncident(incidentId);

  if (!incident.acknowledged) {
    // Escalate to secondary on-call
    await escalateToSecondary(incidentId);

    logger.warn("Incident escalated to secondary on-call", {
      incidentId,
      reason: "not-acknowledged-15min",
    });
  }

  return { escalated: !incident.acknowledged };
});

async function escalateToSecondary(incidentId: string) {
  const secondaryEngineer = await getOnCallEngineer("notifications-secondary");

  await triggerPagerDutyIncident({
    incidentId,
    assignee: secondaryEngineer.engineer,
    message: `Primary on-call did not acknowledge within 15 minutes. Escalating to secondary.`,
  });
}
```

### 7.4 Post-Incident Review Process

**Post-Incident Review (PIR) Template**

```markdown
# Post-Incident Review: [INCIDENT_ID]

## Incident Summary
- **Date/Time:** [UTC timestamp]
- **Duration:** [X minutes]
- **Severity:** [P1/P2/P3]
- **Impact:** [X users affected, Y transactions failed]
- **Root Cause:** [Description]

## Timeline
- **14:32 UTC** - Alert triggered (Error rate spike detected)
- **14:33 UTC** - On-call engineer paged
- **14:35 UTC** - Engineer acknowledged incident
- **14:40 UTC** - Root cause identified (Gmail rate limit)
- **14:45 UTC** - Mitigation applied (throttling enabled)
- **14:50 UTC** - System recovered

## Root Cause Analysis
[Detailed explanation of what went wrong]

## Corrective Actions
- [ ] Action 1 - Assigned to: [Name] - Due: [Date]
- [ ] Action 2 - Assigned to: [Name] - Due: [Date]

## Lessons Learned
1. [Learning 1]
2. [Learning 2]
3. [Learning 3]

## Metrics
- Time to Detection (TTD): 3 minutes
- Time to Mitigation (TTM): 18 minutes
- Users Impacted: 250
- Transactions Lost: 5,000

---
**Review Date:** [Date]  
**Facilitator:** [Name]  
**Participants:** [Names]  
**Status:** Completed / In Progress
```

**PIR Workflow**

```
1. Incident Resolved
   ↓
2. Automated PIR Creation (within 1 hour)
   - Gather metrics from monitoring
   - Timeline from alerts
   - Alert team to review
   ↓
3. Team Review Meeting (within 24 hours)
   - Discuss root cause
   - Identify action items
   - Assign owners
   ↓
4. Action Item Tracking
   - Review board in Jira
   - Weekly standup discussions
   - Completion verification
   ↓
5. PIR Closure
   - All actions assigned
   - Metrics verified
   - Lessons documented
```

---

## Appendix A: Configuration Checklist

- [ ] Sentry project created and DSN configured
- [ ] Sentry SDK initialized in Node.js backend
- [ ] Sentry initialized in Next.js frontend
- [ ] Sourcemaps uploaded to Sentry
- [ ] Release tracking configured
- [ ] Error sampling rules configured
- [ ] PII scrubbing enabled
- [ ] Custom error types created
- [ ] Logger utility implemented
- [ ] Log retention policies set (30/90 days)
- [ ] Structured logging format (JSON) implemented
- [ ] Log sampling configured for high-volume endpoints
- [ ] Slack integration configured
- [ ] PagerDuty integration configured
- [ ] Error alert rules created (all 4 types)
- [ ] Error dashboard built
- [ ] Error boundary components implemented
- [ ] Error middleware in API routes
- [ ] Webhook error notifications configured
- [ ] On-call rotation setup in PagerDuty
- [ ] Escalation policy configured
- [ ] PIR process documented

---

## Appendix B: Key Metrics & Thresholds

| Metric | Threshold | Action |
|--------|-----------|--------|
| Error Rate | > 0.5% | Page on-call |
| Error Rate | 0.25-0.5% | Alert to Slack |
| API Response Time (p95) | > 2s | Investigate |
| Job Processing Timeout | > 5 min | Fail and retry |
| Log Volume | > 10GB/day | Review sampling |
| Sentry quota | > 80% | Alert ops |

---

## Appendix C: Useful Commands

```bash
# Test Sentry connection
curl -X POST https://sentry.io/api/hooks/release/builtin/0/
  -H 'Content-Type: application/json'

# Create release via CLI
sentry-cli releases create taskflow-notifications@1.0.0

# Upload sourcemaps
sentry-cli sourcemaps upload --org your-org --project notifications ./dist

# List recent errors
sentry-cli issues list --org your-org --project notifications

# Query error data
curl https://sentry.io/api/0/organizations/your-org/events-stats/
  -H 'Authorization: Bearer <token>'
  -d 'query=is:error&interval=1h'
```

---

**End of Document**  
*Last Updated: 2026-08-18*  
*Version: 1.0*
