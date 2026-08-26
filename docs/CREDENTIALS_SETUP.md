# TaskFlow Notification System - Credentials Setup Guide

Complete step-by-step instructions for obtaining and configuring credentials for all external services used by the TaskFlow Notification System.

## Table of Contents

1. [Slack Integration](#slack-integration)
2. [PagerDuty Integration](#pagerduty-integration)
3. [Twilio Integration](#twilio-integration)
4. [Gmail API Configuration](#gmail-api-configuration)
5. [Sentry Error Tracking](#sentry-error-tracking)
6. [Datadog Monitoring](#datadog-monitoring)
7. [Supabase Configuration](#supabase-configuration)
8. [Verification & Testing](#verification--testing)

---

## Slack Integration

### Getting Started

Slack webhook allows TaskFlow to send alert notifications and status updates to a Slack channel.

### Setup Steps

1. **Create a Slack App**
   - Go to https://api.slack.com/apps
   - Click "Create New App" → "From scratch"
   - Name: "TaskFlow Notifications"
   - Select your Slack workspace
   - Click "Create App"

2. **Enable Incoming Webhooks**
   - In the app sidebar, click "Incoming Webhooks"
   - Toggle "Activate Incoming Webhooks" to ON
   - Click "Add New Webhook to Workspace"
   - Select the channel (e.g., #alerts-taskflow)
   - Click "Allow"

3. **Copy the Webhook URL**
   - The webhook URL appears on the Incoming Webhooks page
   - Format: `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX`
   - Copy this to `SLACK_WEBHOOK_URL` in `.env.local`

4. **Optional: Get Bot Token (for advanced features)**
   - Click "OAuth & Permissions" in the sidebar
   - Under "Bot Token Scopes", add:
     - `chat:write`
     - `channels:read`
     - `users:read`
   - Copy the "Bot User OAuth Token" (starts with `xoxb-`)
   - Add to `SLACK_BOT_TOKEN` in `.env.local`

5. **Optional: Get Signing Secret (for webhook verification)**
   - Click "Basic Information" in the sidebar
   - Copy "Signing Secret"
   - Add to `SLACK_SIGNING_SECRET` in `.env.local`

### Validation

```bash
# Test webhook connectivity
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Test message from TaskFlow",
    "channel": "#alerts-taskflow"
  }'

# Expected: Response code 200 with empty body
```

---

## PagerDuty Integration

### Getting Started

PagerDuty integration enables automatic incident creation and escalation for critical alerts.

### Setup Steps

1. **Create a PagerDuty Service**
   - Log in to https://www.pagerduty.com
   - Click "Services" → "New Service"
   - Name: "TaskFlow Notification System"
   - Select an escalation policy (or create new one)
   - Click "Create Service"

2. **Create Integration Key (Events API v2)**
   - In the service page, click "Integrations" tab
   - Click "Add Integrations"
   - Search for "Events API V2"
   - Click "Add Integration"
   - Copy the "Integration Key"
   - Add to `PAGERDUTY_INTEGRATION_KEY` in `.env.local`

3. **Get PagerDuty API Token (optional, for advanced operations)**
   - Click account avatar → "Account Settings"
   - Click "API Access" → "Create Token"
   - Name: "TaskFlow API"
   - Copy the token
   - Add to `PAGERDUTY_API_TOKEN` in `.env.local`

4. **Configure Base URL (if using EU)**
   - Default (US): `https://events.pagerduty.com/v2/enqueue`
   - EU: `https://events.eu.pagerduty.com/v2/enqueue`
   - Update `PAGERDUTY_BASE_URL` accordingly in `.env.local`

### Validation

```bash
# Test incident creation
curl -X POST $PAGERDUTY_BASE_URL \
  -H 'Content-Type: application/json' \
  -d '{
    "routing_key": "'$PAGERDUTY_INTEGRATION_KEY'",
    "event_action": "trigger",
    "payload": {
      "summary": "Test alert from TaskFlow",
      "severity": "warning",
      "source": "taskflow-test"
    }
  }'

# Expected: Response code 202 with event_id
# Check PagerDuty console for incident creation
```

---

## Twilio Integration

### Getting Started

Twilio enables SMS notifications to on-call engineers for critical incidents.

### Setup Steps

1. **Create Twilio Account**
   - Go to https://www.twilio.com/console
   - Sign up for account
   - Verify your phone number

2. **Get Account SID & Auth Token**
   - Dashboard shows "Account SID" and "Auth Token"
   - Copy "Account SID" to `TWILIO_ACCOUNT_SID` in `.env.local`
   - Copy "Auth Token" to `TWILIO_AUTH_TOKEN` in `.env.local`

3. **Purchase a Phone Number**
   - Click "Phone Numbers" → "Get Started"
   - Click "Get a Phone Number"
   - Choose country/area code
   - Click "Search"
   - Click "Buy" for desired number
   - Phone number added to your account

4. **Configure Twilio Number**
   - In "Phone Numbers" → "Active Numbers", copy your phone number
   - Format: +1234567890 (with country code)
   - Add to `TWILIO_FROM_NUMBER` in `.env.local`

5. **Add On-Call Phone Number**
   - Get the primary on-call engineer's phone number
   - Format: +1234567890 (with country code)
   - Add to `ON_CALL_PRIMARY_PHONE` in `.env.local`

### Validation

```bash
# Test SMS sending
curl -X POST https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "From=$TWILIO_FROM_NUMBER" \
  -d "To=+1234567890" \
  -d "Body=Test SMS from TaskFlow"

# Expected: Response code 201 with MessageSid
# You should receive the SMS on the test phone number
```

---

## Gmail API Configuration

### Getting Started

Gmail API enables email parsing for replying to notifications via email and sending emails through Gmail.

### Setup Steps - OAuth 2.0 (Recommended)

1. **Create Google Cloud Project**
   - Go to https://console.cloud.google.com
   - Click "Select a Project" → "New Project"
   - Name: "TaskFlow Notifications"
   - Click "Create"

2. **Enable Gmail API**
   - Search for "Gmail API"
   - Click "Gmail API" in results
   - Click "Enable"

3. **Create OAuth 2.0 Credentials**
   - Click "Create Credentials" → "OAuth 2.0 Client ID"
   - If prompted, first configure OAuth consent screen:
     - Click "Configure Consent Screen"
     - User Type: "Internal" (development) or "External" (production)
     - Fill in app name, user support email
     - Add scopes: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`
     - Click "Save and Continue" → "Save and Continue" → "Back to Dashboard"
   - Click "Create Credentials" → "OAuth 2.0 Client ID" again
   - Application Type: "Web application"
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/gmail/callback`
     - `https://your-domain.com/api/auth/gmail/callback` (production)
   - Click "Create"
   - Copy Client ID to `GMAIL_CLIENT_ID` in `.env.local`
   - Copy Client Secret to `GMAIL_CLIENT_SECRET` in `.env.local`

4. **Generate Gmail Refresh Token**
   - Run the OAuth flow script:
     ```bash
     npm run scripts:gmail-auth
     ```
   - Browser opens, log in with Google account
   - Grant permissions to TaskFlow app
   - Copy the refresh token displayed
   - Add to `GMAIL_REFRESH_TOKEN` in `.env.local`

### Setup Steps - Service Account (Alternative)

1. **Create Service Account**
   - Go to https://console.cloud.google.com/iam-admin/serviceaccounts
   - Click "Create Service Account"
   - Service account name: "taskflow-notifications"
   - Click "Create and Continue"

2. **Grant Permissions**
   - Grant these roles:
     - `Editor` (for testing)
     - Or `Gmail API Admin` (more restricted)
   - Click "Continue" → "Done"

3. **Create Key**
   - Click the service account created
   - Click "Keys" tab
   - Click "Add Key" → "Create new key"
   - Key type: "JSON"
   - Click "Create"
   - File automatically downloads
   - Convert to single-line JSON and add to `GMAIL_SERVICE_ACCOUNT_JSON` in `.env.local`

4. **Enable Domain-Wide Delegation (for sending emails)**
   - In service account, click "Details"
   - Enable "Domain-wide delegation"
   - Add OAuth scopes:
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.readonly`

### Validation

```bash
# Test Gmail API connectivity
curl -X GET https://www.googleapis.com/gmail/v1/users/me/profile \
  -H "Authorization: Bearer $GMAIL_API_TOKEN"

# Expected: Response code 200 with profile information

# Test sending email
curl -X POST https://www.googleapis.com/gmail/v1/users/me/messages/send \
  -H "Authorization: Bearer $GMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "raw": "Base64-encoded email message"
  }'
```

---

## Sentry Error Tracking

### Getting Started

Sentry provides error tracking and monitoring for production issues.

### Setup Steps

1. **Create Sentry Account**
   - Go to https://sentry.io
   - Sign up for account

2. **Create Project**
   - Click "Create Project"
   - Select runtime: "Next.js" or "Node.js"
   - Name: "TaskFlow Notifications"
   - Click "Create Project"

3. **Get DSN**
   - Project Settings appear
   - Copy "Client Keys (DSN)" value (public key)
   - Add to `NEXT_PUBLIC_SENTRY_DSN` in `.env.local`
   - Also copy to `SENTRY_DSN` for server-side

4. **Optional: Get Auth Token**
   - Click account avatar → "Account Settings"
   - Click "Auth Tokens"
   - Click "Create New Token"
   - Grant permissions: `event:read`, `event:write`, `project:write`
   - Copy token to `SENTRY_AUTH_TOKEN` in `.env.local`

5. **Set Environment**
   - Add `NEXT_PUBLIC_SENTRY_ENVIRONMENT=development` (or staging/production)
   - Update `.env.local` accordingly

### Validation

```bash
# Test Sentry by triggering an error
# In your app code:
import * as Sentry from "@sentry/nextjs";
Sentry.captureException(new Error("Test error from TaskFlow"));

# Check Sentry dashboard for error
```

---

## Datadog Monitoring

### Getting Started

Datadog provides metrics, logging, and monitoring dashboards.

### Setup Steps

1. **Create Datadog Account**
   - Go to https://www.datadoghq.com/free-datadog-trial/
   - Sign up for free trial or account

2. **Get API Key**
   - Click account menu → "Organization Settings"
   - Click "API Keys"
   - Copy "default" key or create new one
   - Add to `DD_API_KEY` in `.env.local`

3. **Get Application Key**
   - Click "Application Keys"
   - Copy existing key or create new one
   - Add to `DD_APP_KEY` in `.env.local`

4. **Set Site**
   - Determine your Datadog site:
     - US: `datadoghq.com`
     - US (gov): `ddog-gov.com`
     - EU: `datadoghq.eu`
   - Add to `DD_SITE` in `.env.local`

### Validation

```bash
# Test Datadog API
curl -X GET "https://api.${DD_SITE}/api/v1/validate" \
  -H "DD-API-KEY: $DD_API_KEY"

# Expected: Response code 200 with validation status
```

---

## Supabase Configuration

### Getting Started

Supabase provides PostgreSQL database and real-time capabilities.

### Setup Steps

1. **Create Supabase Project**
   - Go to https://app.supabase.com
   - Click "New Project"
   - Organization: Select or create
   - Name: "taskflow-notifications"
   - Password: Create strong password (save it!)
   - Region: Select closest region
   - Click "Create new project"

2. **Get API Keys**
   - Once project is created, go to "Settings" → "API"
   - Copy "Project URL" to `NEXT_PUBLIC_SUPABASE_URL`
   - Copy "anon public" key to `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copy "service_role secret" key to `SUPABASE_SERVICE_ROLE_KEY`
   - Add all to `.env.local`

3. **Get Database Connection Info**
   - Go to "Settings" → "Database"
   - Copy host, port, database name
   - Create connection string and add to:
     - `DATABASE_URL` in `.env.local`
     - `SUPABASE_USER`, `SUPABASE_PASSWORD`, `SUPABASE_HOST`, `SUPABASE_PORT`

### Validation

```bash
# Test Supabase connection
npm run supabase:status

# Test API connectivity
curl -X GET "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"

# Expected: Response code 200 with version info
```

---

## Verification & Testing

### Pre-Flight Checklist

```bash
# Copy .env.example to .env.local
cp .env.example .env.local

# Edit .env.local with your credentials
nano .env.local

# Validate all credentials are set
./scripts/validate-credentials.sh

# Test each service individually
npm run test:slack
npm run test:pagerduty
npm run test:gmail
npm run test:sentry
npm run test:twilio
```

### Test Command Examples

```bash
# Test Slack
./dev/2-debug-utils.sh debug_api_request POST /api/webhooks/slack \
  '{"text":"Test from TaskFlow"}'

# Test PagerDuty
./dev/2-debug-utils.sh debug_api_request POST /api/webhooks/pagerduty \
  '{"severity":"warning","summary":"Test alert"}'

# Test Gmail
./dev/2-debug-utils.sh debug_api_request GET /api/webhooks/gmail/status

# Test SMS
./dev/2-debug-utils.sh debug_api_request POST /api/webhooks/sms \
  '{"to":"+1234567890","message":"Test SMS"}'
```

### Troubleshooting

#### Slack Issues
- **Webhook not working**: Verify channel still exists and bot has access
- **Rate limited**: Check Slack API rate limits in workspace settings
- **Message formatting**: Validate JSON payload format

#### PagerDuty Issues
- **No incidents created**: Verify integration key is correct
- **EU connectivity**: Check `PAGERDUTY_BASE_URL` is set to EU endpoint
- **Escalation not triggering**: Verify escalation policy is configured

#### Gmail Issues
- **Auth token expired**: Refresh token using `npm run scripts:gmail-auth`
- **Rate limited**: Implement exponential backoff in email sending
- **Quota exceeded**: Check Gmail API quotas in Google Cloud Console

#### Sentry Issues
- **No errors captured**: Verify DSN is correct and `NODE_ENV=production`
- **Missing source maps**: Ensure source maps are uploaded to Sentry
- **Rate limited**: Check Sentry plan limits

#### Twilio Issues
- **SMS not delivered**: Verify phone number is correctly formatted (+1234567890)
- **Authentication failed**: Double-check Account SID and Auth Token
- **No SMS balance**: Add credits to Twilio account

### Monitoring Setup

Once credentials are configured, set up monitoring:

```bash
# Enable Sentry error tracking
export SENTRY_DSN=your-dsn

# Enable Datadog metrics
export DD_API_KEY=your-api-key
export DD_APP_KEY=your-app-key

# Start application
npm run dev

# Check health endpoint
curl http://localhost:3000/api/health
```

---

## Security Best Practices

1. **Never commit `.env.local`** - Add to `.gitignore`
2. **Rotate credentials regularly** - Update keys every 90 days
3. **Use different credentials per environment**:
   - Development: Use test/sandbox accounts
   - Staging: Use separate credentials
   - Production: Use production credentials with minimal permissions
4. **Store in secure vault** - Use Vercel Secrets, AWS Secrets Manager, etc.
5. **Audit access** - Monitor who has access to credentials
6. **Enable webhook verification** - Use signing secrets to verify requests
7. **Limit API permissions** - Grant only required scopes/permissions

---

## Support & Documentation

- **Slack API Docs**: https://api.slack.com/messaging/webhooks
- **PagerDuty API Docs**: https://developer.pagerduty.com/docs/events-api-v2/overview
- **Gmail API Docs**: https://developers.google.com/gmail/api
- **Twilio SMS Docs**: https://www.twilio.com/docs/sms
- **Sentry Docs**: https://docs.sentry.io
- **Datadog Docs**: https://docs.datadoghq.com

---

Last updated: 2026-08-18
