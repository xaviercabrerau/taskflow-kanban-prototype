# TaskFlow - Debug Utilities Guide (`dev/2-debug-utils.sh`)

> **Status: verified 2026-09-10** against `dev/2-debug-utils.sh`, the migrations
> in `supabase/migrations/` and the app's real runtime dependencies.
>
> **Read this before using the script.** Every command listed below really is
> implemented in `dev/2-debug-utils.sh` (the dispatcher and the functions exist).
> What is *not* true is the environment they assume. The script was written for a
> stack this project never adopted:
>
> - It talks to Postgres through **`DATABASE_URL` + `psql`**. TaskFlow does not
>   use `DATABASE_URL`; it reaches Supabase over the JS client with
>   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
>   `SUPABASE_SERVICE_ROLE_KEY`.
> - It talks to Redis through **local `redis-cli` on port 6379**. TaskFlow uses
>   **Upstash Redis over HTTPS** (`UPSTASH_REDIS_REST_URL` /
>   `UPSTASH_REDIS_REST_TOKEN`, aliased by Vercel as `KV_REST_API_URL` /
>   `KV_REST_API_TOKEN`). `redis-cli` cannot reach it.
> - Its database commands query tables that **do not exist in any migration**:
>   `notification_queue`, `email_queue`, `job_logs`. The real tables are
>   `notifications`, `notification_preferences`, `email_threads`, `failed_jobs`,
>   `audit_log`, `activity_log`, `profiles`.
> - It assumes a **background job worker / queue**. There is none — TaskFlow has
>   no worker process and no BullMQ-style queue.
>
> Consequence: the database, Redis, queue and email-queue commands fall back to
> **mock data** (the script prints `Using mock queue/cache data`) instead of
> failing loudly. Treat their output as sample formatting, not as facts about
> your system.
>
> **What still works as advertised:** the HTTP-based helpers — `debug_api_request`,
> `trace_api_call`, `profile_api_endpoint`, `test_rate_limit`,
> `simulate_concurrent_requests`, `trace_slow_request` — plus the log helpers
> (`tail_logs`, `search_logs`, `analyze_errors`, `export_logs`) and
> `inspect_jwt_token`. Point them at a running `npm run dev` on
> `http://localhost:3000` or at production.
>
> For day-to-day debugging that needs no special tooling, see
> [`3-development-workflow.md`](./3-development-workflow.md) §9.

Run the script from the `dev/` directory (or call it as `./dev/2-debug-utils.sh`
from the repo root):

## Quick Start

```bash
# View help
./2-debug-utils.sh help

# Check notifications
./2-debug-utils.sh inspect_notifications usr_123

# Profile API performance
./2-debug-utils.sh profile_api_endpoint /api/notifications 10

# Enter interactive debugging
./2-debug-utils.sh debug_repl --verbose
```

## Categories

### 1. Database Inspector
Inspect and query the notification database.

```bash
./2-debug-utils.sh inspect_notifications [user_id] [limit]
./2-debug-utils.sh inspect_preferences [user_id]
./2-debug-utils.sh inspect_failed_jobs [limit]
./2-debug-utils.sh inspect_email_threads [user_id] [limit]
```

**Use for:** Database troubleshooting, viewing raw data, checking preferences

### 2. API Debugger
Make API calls and trace request flow through middleware.

```bash
./2-debug-utils.sh debug_api_request [method] [endpoint] [data]
./2-debug-utils.sh trace_api_call [endpoint]
./2-debug-utils.sh inspect_jwt_token [token]
./2-debug-utils.sh test_rate_limit [endpoint] [count]
```

**Use for:** API testing, authentication debugging, rate limit verification

### 3. Email Debugging
Inspect email queue, logs, and templates.

```bash
./2-debug-utils.sh inspect_email_queue
./2-debug-utils.sh inspect_email_log [limit]
./2-debug-utils.sh test_email_template [name]
./2-debug-utils.sh inspect_gmail_config
```

**Use for:** Email delivery issues, queue health, template validation

### 4. Redis Debugger
Inspect Redis cache and queue state.

```bash
./2-debug-utils.sh inspect_redis_keys [pattern]
./2-debug-utils.sh inspect_queue_state
./2-debug-utils.sh inspect_cache_data [key]
./2-debug-utils.sh flush_development_cache [pattern] --modify
```

**Use for:** Cache issues, queue inspection, memory debugging

### 5. Performance Debugger
Profile endpoints and queries for performance bottlenecks.

```bash
./2-debug-utils.sh profile_api_endpoint [endpoint] [iterations]
./2-debug-utils.sh profile_query [sql]
./2-debug-utils.sh check_memory_usage
./2-debug-utils.sh trace_slow_request [endpoint]
```

**Use for:** Performance optimization, latency analysis, memory leaks

### 6. User Simulation
Trigger actions and test notification flows.

```bash
./2-debug-utils.sh simulate_user_action [user_id] [action] --modify
./2-debug-utils.sh simulate_email_reply [thread_id] [text] --modify
./2-debug-utils.sh simulate_preference_toggle [user] [pref] --modify
./2-debug-utils.sh simulate_concurrent_requests [count]
```

**Use for:** Testing notification triggers, simulating user behavior

### 7. Log Analysis
Search, analyze, and export logs.

```bash
./2-debug-utils.sh tail_logs [lines] [service]
./2-debug-utils.sh search_logs [pattern] [limit]
./2-debug-utils.sh analyze_errors
./2-debug-utils.sh export_logs [output_file] --modify
```

**Use for:** Error investigation, log searching, diagnostics

### 8. Interactive REPL
Open an interactive debugging shell.

```bash
./2-debug-utils.sh debug_repl --verbose
```

**Use for:** Exploratory debugging, running multiple commands

## Global Options

| Option | Purpose |
|--------|---------|
| `--modify` | Enable write operations (required for mutations) |
| `--verbose` | Show debug output and detailed traces |
| `--json` | Output in JSON format for parsing |
| `--help` | Show help message |

## Examples

### Debugging a User's Notifications
```bash
# View recent notifications
./2-debug-utils.sh inspect_notifications alice@example.com

# Check preferences
./2-debug-utils.sh inspect_preferences alice@example.com

# Search for related errors
./2-debug-utils.sh search_logs "alice@example.com" 50
```

### Investigating Email Issues
```bash
# Check email queue status
./2-debug-utils.sh inspect_email_queue

# View recent emails sent
./2-debug-utils.sh inspect_email_log 30

# Verify Gmail configuration
./2-debug-utils.sh inspect_gmail_config

# Test a template
./2-debug-utils.sh test_email_template TASK_ASSIGNED
```

### Performance Profiling
```bash
# Profile API endpoint
./2-debug-utils.sh profile_api_endpoint /api/notifications 20

# Trace slow request
./2-debug-utils.sh trace_slow_request /api/notifications

# Check memory usage
./2-debug-utils.sh check_memory_usage
```

### Testing Notification Flow
```bash
# Trigger test notification
./2-debug-utils.sh simulate_user_action usr_test TASK_ASSIGNED --modify

# Test email reply webhook
./2-debug-utils.sh simulate_email_reply thread_123 "Test reply" --modify

# Simulate concurrent requests
./2-debug-utils.sh simulate_concurrent_requests 10
```

### Error Analysis
```bash
# Analyze recent errors
./2-debug-utils.sh analyze_errors

# Search for specific errors
./2-debug-utils.sh search_logs "ERROR" 50 --verbose

# Export all logs for analysis
./2-debug-utils.sh export_logs debug_$(date +%s).log --modify
```

## Output Formats

### Default Output
- Color-coded with symbols (✓ ✗ ⚠ ℹ)
- Tree-style visualization for hierarchical data
- Human-readable formatting

### JSON Output
Use `--json` flag to output in JSON format:
```bash
./2-debug-utils.sh inspect_notifications usr_123 --json
```

### Verbose Mode
Use `--verbose` for detailed debug output:
```bash
./2-debug-utils.sh trace_api_call /api/notifications --verbose
```

## Tips & Tricks

### Search for Patterns
```bash
# Find all SMTP errors
./2-debug-utils.sh search_logs "SMTP" 100

# Find all rate limit issues
./2-debug-utils.sh search_logs "429" 50

# Find specific user's actions
./2-debug-utils.sh search_logs "alice@example.com" 200
```

### Profile Multiple Endpoints
```bash
# Profile several endpoints in sequence
for endpoint in "/api/notifications" "/api/preferences" "/api/send"; do
  ./2-debug-utils.sh profile_api_endpoint "$endpoint" 5
done
```

### Interactive Debugging Session
```bash
# Start interactive shell
./2-debug-utils.sh debug_repl --verbose

# Then use commands inside:
# > inspect_notifications
# > redis:keys
# > logs:search ERROR
# > exit
```

### Export Logs for External Analysis
```bash
# Export all logs
./2-debug-utils.sh export_logs analysis_$(date +%Y%m%d).log --modify

# Then analyze with grep, awk, etc.
grep "ERROR" analysis_*.log | wc -l
```

## Safety Features

- **Read-only by default**: All commands are non-destructive unless `--modify` is used
- **Command history**: All commands are logged to `.debug_history` for audit trails
- **Connection checks**: Safe detection of missing services (Redis, PostgreSQL, etc.)
- **Mock data**: Example data displayed when services aren't configured
- **Dry-run capability**: Most operations show what would happen before requiring `--modify`

## Troubleshooting

### Redis Connection Failed
```bash
# Make sure Redis is running
redis-cli ping

# Then try again
./2-debug-utils.sh inspect_queue_state
```

### Database Connection Failed
```bash
# Check if database is configured in .env.local
grep DATABASE_URL .env.local

# Verify connection string is valid
psql <connection-string> -c "SELECT 1"
```

### No Email Queue Data
```bash
# Make sure email service is running
ps aux | grep email

# Check email service logs
./2-debug-utils.sh search_logs "email" 50

# Verify Gmail configuration
./2-debug-utils.sh inspect_gmail_config
```

## Command History

Command history is automatically tracked in `logs/.debug_history`:
```bash
# View recent commands
tail -20 logs/.debug_history

# See all commands from today
grep "$(date +%Y-%m-%d)" logs/.debug_history
```

## Integration with Development Workflow

### Pre-deployment Checklist
```bash
# Check database health
./2-debug-utils.sh inspect_failed_jobs

# Check queue status
./2-debug-utils.sh inspect_queue_state

# Analyze recent errors
./2-debug-utils.sh analyze_errors

# Profile critical endpoints
./2-debug-utils.sh profile_api_endpoint /api/notifications 10
```

### Post-deployment Verification
```bash
# Monitor email queue
./2-debug-utils.sh inspect_email_queue

# Check Redis cache
./2-debug-utils.sh inspect_redis_keys "cache:*"

# Follow logs
./2-debug-utils.sh tail_logs 50 --verbose
```

## Support

For issues or questions about debug utilities:
1. Check the help: `./2-debug-utils.sh help`
2. Use verbose mode: `./2-debug-utils.sh <cmd> --verbose`
3. Check logs: `./2-debug-utils.sh search_logs <pattern>`
4. Contact the development team with command output
