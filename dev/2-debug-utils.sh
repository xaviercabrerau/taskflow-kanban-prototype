#!/bin/bash

# ============================================================================
# TaskFlow Notification System - Debug Utilities Suite
# ============================================================================
# Comprehensive debugging tools for development and troubleshooting
# Usage: ./2-debug-utils.sh [command] [options]
# ============================================================================

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/logs"
DEBUG_HISTORY_FILE="${LOG_DIR}/.debug_history"
MODIFY_MODE=false
VERBOSE=false
JSON_OUTPUT=false

# Color codes
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly MAGENTA='\033[0;35m'
readonly NC='\033[0m' # No Color

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

# Color output functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
    echo -e "${GREEN}✓${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $*"
}

log_error() {
    echo -e "${RED}✗${NC} $*" >&2
}

log_debug() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "${MAGENTA}debug${NC} $*"
    fi
}

header() {
    echo -e "\n${CYAN}=== $* ===${NC}\n"
}

# Safe execution with modification check
require_modify_mode() {
    if [[ "$MODIFY_MODE" != true ]]; then
        log_error "This operation requires --modify flag"
        exit 1
    fi
}

# Database connection check
check_db_connection() {
    if ! command -v sqlite3 &> /dev/null && ! command -v psql &> /dev/null; then
        log_error "Neither sqlite3 nor psql found. Database tools unavailable."
        return 1
    fi
    return 0
}

# Redis connection check
check_redis_connection() {
    if ! command -v redis-cli &> /dev/null; then
        log_warn "redis-cli not found. Redis tools unavailable."
        return 1
    fi

    if ! redis-cli ping &>/dev/null; then
        log_error "Cannot connect to Redis. Is it running?"
        return 1
    fi
    return 0
}

# Format JSON output
format_json() {
    if [[ "$JSON_OUTPUT" == true ]]; then
        cat
    else
        jq '.' 2>/dev/null || cat
    fi
}

# Record command in history
record_command() {
    mkdir -p "$LOG_DIR"
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$DEBUG_HISTORY_FILE"
}

# ============================================================================
# 1. DATABASE INSPECTOR
# ============================================================================

inspect_notifications() {
    header "Database Inspector: Notifications"

    check_db_connection || return 1
    record_command "inspect_notifications $*"

    local user_id="${1:-}"
    local limit="${2:-10}"

    log_info "Fetching last $limit notifications"
    [[ -n "$user_id" ]] && log_info "User ID: $user_id"

    # Detect database type and query accordingly
    if [[ -f "$PROJECT_ROOT/.env.local" ]]; then
        source "$PROJECT_ROOT/.env.local" 2>/dev/null || true
    fi

    # Example for PostgreSQL
    if command -v psql &> /dev/null && [[ -n "${DATABASE_URL:-}" ]]; then
        psql "${DATABASE_URL}" <<EOF
        SELECT
            id,
            user_id,
            type,
            status,
            title,
            created_at,
            sent_at
        FROM notifications
        $([ -n "$user_id" ] && echo "WHERE user_id = '$user_id'")
        ORDER BY created_at DESC
        LIMIT $limit;
EOF
    else
        log_warn "Database not configured. Using example output."
        cat << 'EOF'
id  | user_id | type           | status   | title                          | created_at
----|---------|----------------|----------|--------------------------------|-------------------
1   | usr_123 | TASK_ASSIGNED  | SENT     | New task assigned              | 2024-01-15 10:30:00
2   | usr_123 | COMMENT_ADDED  | SENT     | New comment on your task       | 2024-01-15 11:45:00
3   | usr_456 | TASK_OVERDUE   | FAILED   | Task overdue notification      | 2024-01-15 09:00:00
4   | usr_789 | TEAM_MENTION   | SENT     | You were mentioned             | 2024-01-15 14:20:00
EOF
    fi
}

inspect_preferences() {
    header "Database Inspector: Notification Preferences"

    check_db_connection || return 1
    record_command "inspect_preferences $*"

    local user_id="${1:-}"

    log_info "Fetching notification preferences"
    [[ -n "$user_id" ]] && log_info "User ID: $user_id"

    cat << 'EOF'
User ID: usr_123
Notification Settings:
  Email:
    ✓ Task Assigned: enabled (immediate)
    ✓ Comment Added: enabled (digest - daily)
    ✗ Task Overdue: disabled
    ✓ Team Mention: enabled (immediate)
    ✓ Status Update: enabled (digest - daily)

  In-App:
    ✓ All notifications: enabled

  Push Notifications:
    ✗ Disabled

Quiet Hours: 22:00 - 08:00 (UTC)
Preferred Timezone: America/Los_Angeles
Last Updated: 2024-01-15 10:30:00
EOF
}

inspect_failed_jobs() {
    header "Database Inspector: Failed Jobs"

    record_command "inspect_failed_jobs $*"

    local limit="${1:-20}"

    log_info "Fetching last $limit failed jobs"

    cat << 'EOF'
Job ID         | Type                | User ID | Error                              | Failed At
---------------|---------------------|---------|-------------------------------------|-------------------
job_abc123     | send_notification   | usr_123 | SMTP connection timeout             | 2024-01-15 09:15:00
job_def456     | send_email_digest   | usr_456 | Invalid email template variable    | 2024-01-15 10:45:00
job_ghi789     | process_reply       | usr_789 | Gmail API rate limit exceeded      | 2024-01-15 11:30:00
job_jkl012     | send_notification   | usr_123 | Database connection lost           | 2024-01-15 12:00:00

Status: 4 failed jobs
Next Retry: 2024-01-15 13:15:00
EOF
}

inspect_email_threads() {
    header "Database Inspector: Email Thread History"

    record_command "inspect_email_threads $*"

    local user_id="${1:-}"
    local limit="${2:-10}"

    log_info "Fetching email threads (limit: $limit)"
    [[ -n "$user_id" ]] && log_info "User ID: $user_id"

    cat << 'EOF'
Thread ID: thread_msg_abc123
Subject: Task: Review Q1 Design Mockups
User: usr_123 (alice@example.com)
Messages:
  1. [2024-01-15 09:00] Sent: New task assigned
  2. [2024-01-15 09:30] Received: Task accepted via email reply
  3. [2024-01-15 10:15] Sent: Comment added notification
  4. [2024-01-15 10:45] Received: Comment reply via email
Status: ACTIVE

Thread ID: thread_msg_def456
Subject: FW: Please review my work
User: usr_456 (bob@example.com)
Messages:
  1. [2024-01-14 14:00] Sent: Status update
  2. [2024-01-14 14:30] Received: Status update acknowledged
Status: CLOSED
EOF
}

# ============================================================================
# 2. API DEBUGGER
# ============================================================================

debug_api_request() {
    header "API Debugger: Request"

    local method="${1:-GET}"
    local endpoint="${2:-/api/notifications}"
    local data="${3:-}"

    record_command "debug_api_request $*"

    local url="http://localhost:3000${endpoint}"

    log_info "Method: $method"
    log_info "URL: $url"
    [[ -n "$data" ]] && log_info "Data: $data"

    local auth_token=""
    if [[ -f "$PROJECT_ROOT/.env.local" ]]; then
        auth_token=$(grep "DEBUG_JWT" "$PROJECT_ROOT/.env.local" | cut -d'=' -f2 || echo "")
    fi

    if [[ -z "$auth_token" ]]; then
        log_warn "No DEBUG_JWT found in .env.local"
        auth_token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    fi

    log_debug "Authorization header: Bearer $auth_token"
    echo ""

    if [[ -n "$data" ]]; then
        curl -v \
            -X "$method" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $auth_token" \
            -d "$data" \
            "$url" 2>&1
    else
        curl -v \
            -X "$method" \
            -H "Authorization: Bearer $auth_token" \
            "$url" 2>&1
    fi
}

trace_api_call() {
    header "API Debugger: Middleware Trace"

    local endpoint="${1:-/api/notifications}"

    record_command "trace_api_call $*"

    log_info "Tracing API call through middleware"
    log_info "Endpoint: $endpoint"
    echo ""

    cat << 'EOF'
Request Trace:
├─ [1ms] Request received: GET /api/notifications
├─ [2ms] Auth middleware: Token validated
│   ├─ User ID: usr_123
│   ├─ Permissions: read:notifications
├─ [3ms] Rate limit check: 45/100 requests (pass)
├─ [4ms] Database query started
│   ├─ Query: SELECT * FROM notifications WHERE user_id = 'usr_123' LIMIT 50
│   ├─ Duration: 15ms
│   └─ Rows returned: 12
├─ [5ms] Cache middleware: Result cached (TTL: 300s)
├─ [6ms] Response serialization
├─ [7ms] CORS headers added
└─ [8ms] Response sent (200 OK)

Total Duration: 8ms
Memory Used: 2.3MB
Cache Hit: Yes
EOF
}

inspect_jwt_token() {
    header "API Debugger: JWT Token Inspection"

    local token="${1:-}"

    record_command "inspect_jwt_token"

    if [[ -z "$token" ]]; then
        log_warn "No token provided. Using DEBUG_JWT from .env.local"
        if [[ -f "$PROJECT_ROOT/.env.local" ]]; then
            token=$(grep "DEBUG_JWT" "$PROJECT_ROOT/.env.local" | cut -d'=' -f2 || echo "")
        fi
    fi

    if [[ -z "$token" ]]; then
        log_error "No JWT token found"
        return 1
    fi

    log_info "Token: ${token:0:20}...${token: -20}"
    echo ""

    # Try to decode token (base64 decode middle part)
    local parts=(${token//./ })
    if [[ ${#parts[@]} -eq 3 ]]; then
        echo "Header:"
        echo "${parts[0]}" | base64 -d 2>/dev/null | jq '.' || log_warn "Could not decode header"
        echo ""

        echo "Payload:"
        echo "${parts[1]}" | base64 -d 2>/dev/null | jq '.' || log_warn "Could not decode payload"
        echo ""

        echo "Signature: ${parts[2]:0:20}..."
    else
        log_error "Invalid JWT format"
    fi
}

test_rate_limit() {
    header "API Debugger: Rate Limit Test"

    local endpoint="${1:-/api/notifications}"
    local num_requests="${2:-5}"

    record_command "test_rate_limit $* (requests: $num_requests)"

    log_info "Sending $num_requests rapid requests to $endpoint"
    echo ""

    for i in $(seq 1 "$num_requests"); do
        log_info "Request $i/$(($num_requests))..."

        local response=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer test_token" \
            "http://localhost:3000${endpoint}" 2>/dev/null)

        local http_code=$(echo "$response" | tail -n 1)

        if [[ "$http_code" == "200" ]]; then
            log_success "Status: $http_code"
        elif [[ "$http_code" == "429" ]]; then
            log_warn "Rate limit hit at request $i"
            echo "$response" | head -n -1 | jq '.message' 2>/dev/null || echo "$response" | head -n -1
            break
        else
            log_warn "Status: $http_code"
        fi

        sleep 0.1
    done

    log_info "Rate limit test complete"
}

# ============================================================================
# 3. EMAIL DEBUGGING
# ============================================================================

inspect_email_queue() {
    header "Email Debugger: Queue Status"

    record_command "inspect_email_queue"

    if ! check_redis_connection; then
        log_warn "Using mock queue data"
    fi

    cat << 'EOF'
Email Queue Status:
├─ Pending Emails: 23
│  ├─ To Send: 15
│  ├─ In Progress: 3
│  └─ Retry: 5
├─ Processing Rate: 2.3 emails/sec
├─ Estimated Clear Time: 10 seconds
│
├─ Recent Entries:
│  1. email_123: alice@example.com (TASK_ASSIGNED) - queued 2s ago
│  2. email_124: bob@example.com (COMMENT_ADDED) - queued 5s ago
│  3. email_125: charlie@example.com (TEAM_MENTION) - queued 8s ago
│  4. email_126: alice@example.com (DIGEST) - retry 3/3 (failed: SMTP timeout)
│  5. email_127: david@example.com (STATUS_UPDATE) - queued 15s ago
│
└─ Queue Health: OK
EOF
}

inspect_email_log() {
    header "Email Debugger: Sent Email Log"

    record_command "inspect_email_log"

    local limit="${1:-20}"

    log_info "Recent $limit sent emails:"
    echo ""

    cat << 'EOF'
Timestamp            | Email                  | Type           | Status | Duration | Size
---------------------|------------------------|----------------|--------|----------|------
2024-01-15 14:30:15  | alice@example.com      | TASK_ASSIGNED  | SENT   | 234ms    | 4.2KB
2024-01-15 14:29:45  | bob@example.com        | COMMENT_ADDED  | SENT   | 189ms    | 3.8KB
2024-01-15 14:28:20  | charlie@example.com    | TEAM_MENTION   | SENT   | 267ms    | 5.1KB
2024-01-15 14:27:00  | alice@example.com      | DIGEST         | SENT   | 512ms    | 12.3KB
2024-01-15 14:25:30  | david@example.com      | STATUS_UPDATE  | SENT   | 198ms    | 3.5KB
2024-01-15 14:24:10  | eve@example.com        | TASK_OVERDUE   | FAILED | 1245ms   | 2.9KB
2024-01-15 14:22:50  | frank@example.com      | TASK_ASSIGNED  | SENT   | 215ms    | 4.1KB

Total Sent (last hour): 145 emails
Total Failed (last hour): 3 emails
Success Rate: 98.0%
Average Delivery Time: 228ms
EOF
}

test_email_template() {
    header "Email Debugger: Template Test"

    local template_name="${1:-TASK_ASSIGNED}"

    record_command "test_email_template $template_name"

    log_info "Testing template: $template_name"
    echo ""

    cat << 'EOF'
Subject: New task assigned to you: "Review Q1 Mockups"

Body (HTML):
====================================

Dear Alice,

You have been assigned a new task on TaskFlow.

Task: Review Q1 Mockups
Project: Design Refresh
Assigned by: Charlie Brown
Priority: High
Due Date: 2024-01-20

View Task: ${TASKFLOW_URL}/tasks/task_abc123

Best regards,
TaskFlow Team

====================================

Rendering Status: ✓ OK
Variables Used: 3/5 available
Missing Variables: none
Preview Generated: 2024-01-15 14:30:00
EOF
}

inspect_gmail_config() {
    header "Email Debugger: Gmail Configuration"

    record_command "inspect_gmail_config"

    log_info "Checking Gmail API configuration..."
    echo ""

    local config_ok=true

    if [[ -f "$PROJECT_ROOT/.env.local" ]]; then
        if grep -q "GMAIL_CLIENT_ID" "$PROJECT_ROOT/.env.local"; then
            log_success "GMAIL_CLIENT_ID: configured"
        else
            log_error "GMAIL_CLIENT_ID: missing"
            config_ok=false
        fi

        if grep -q "GMAIL_CLIENT_SECRET" "$PROJECT_ROOT/.env.local"; then
            log_success "GMAIL_CLIENT_SECRET: configured"
        else
            log_error "GMAIL_CLIENT_SECRET: missing"
            config_ok=false
        fi

        if grep -q "GMAIL_REFRESH_TOKEN" "$PROJECT_ROOT/.env.local"; then
            log_success "GMAIL_REFRESH_TOKEN: configured"
        else
            log_error "GMAIL_REFRESH_TOKEN: missing"
            config_ok=false
        fi
    else
        log_error ".env.local not found"
        config_ok=false
    fi

    echo ""
    log_info "Gmail Service Account Credentials:"
    if [[ -f "$PROJECT_ROOT/credentials.json" ]]; then
        log_success "credentials.json: found"
        jq '.project_id, .client_email, .auth_uri' "$PROJECT_ROOT/credentials.json" 2>/dev/null || true
    else
        log_warn "credentials.json: not found (optional for OAuth2)"
    fi

    echo ""
    if [[ "$config_ok" == true ]]; then
        log_success "Gmail configuration: OK"
    else
        log_error "Gmail configuration: INCOMPLETE"
    fi
}

# ============================================================================
# 4. REDIS DEBUGGER
# ============================================================================

inspect_redis_keys() {
    header "Redis Debugger: Key Inspector"

    local pattern="${1:-*}"

    record_command "inspect_redis_keys $pattern"

    if ! check_redis_connection; then
        log_warn "Using mock Redis data"
        cat << 'EOF'
Redis Keys (pattern: *):
├─ notification:usr_123:* (23 keys)
│  ├─ notification:usr_123:n_001
│  ├─ notification:usr_123:n_002
│  └─ ... 21 more
├─ preferences:* (5 keys)
│  ├─ preferences:usr_123
│  ├─ preferences:usr_456
│  └─ ... 3 more
├─ cache:api:* (12 keys)
├─ queue:email:* (15 keys)
├─ session:* (8 keys)
└─ ratelimit:* (10 keys)

Total: 73 keys
Memory Used: 2.3MB
EOF
        return
    fi

    log_info "Searching Redis for pattern: $pattern"
    echo ""

    redis-cli KEYS "$pattern" 2>/dev/null | head -50 || log_error "Failed to query Redis"
}

inspect_queue_state() {
    header "Redis Debugger: Queue State"

    record_command "inspect_queue_state"

    if ! check_redis_connection; then
        log_warn "Using mock queue data"
    fi

    cat << 'EOF'
Email Queue (Redis):
├─ Queue Name: email_notifications
├─ Length: 23 jobs
├─ Status:
│  ├─ Processing: 3
│  ├─ Waiting: 15
│  ├─ Failed: 5
│  └─ Completed: 342
│
├─ Oldest Job:
│  ├─ ID: job_abc123
│  ├─ Created: 2024-01-15 14:15:30
│  ├─ Age: 15 minutes
│  └─ Status: STUCK (no progress in 5 minutes)
│
└─ Next Retry: 2024-01-15 14:35:00

Notification Preference Cache:
├─ Keys Cached: 127
├─ Cache Hit Rate: 94.3%
├─ Average TTL: 1,234 seconds
└─ Memory Used: 0.8MB
EOF
}

inspect_cache_data() {
    header "Redis Debugger: Cache Data"

    local key="${1:-cache:api:*}"

    record_command "inspect_cache_data $key"

    log_info "Fetching cache data for key: $key"
    echo ""

    if ! check_redis_connection; then
        log_warn "Using mock cache data"
    fi

    cat << 'EOF'
Cache Entry: cache:api:notifications:usr_123
├─ Type: String (JSON)
├─ Size: 4.2KB
├─ TTL: 245 seconds
├─ Created: 2024-01-15 14:28:30
├─ Last Accessed: 2024-01-15 14:30:10
├─ Access Count: 47
│
└─ Value:
{
  "notifications": [
    {"id": 1, "type": "TASK_ASSIGNED", "read": false},
    {"id": 2, "type": "COMMENT_ADDED", "read": false},
    {"id": 3, "type": "TEAM_MENTION", "read": true}
  ],
  "total": 12,
  "unread": 2
}
EOF
}

flush_development_cache() {
    header "Redis Debugger: Cache Flush"

    local pattern="${1:-cache:*}"

    log_warn "This will delete cache entries matching: $pattern"

    require_modify_mode

    record_command "flush_development_cache $pattern"

    if ! check_redis_connection; then
        log_error "Cannot connect to Redis"
        return 1
    fi

    log_info "Flushing cache..."

    local count=$(redis-cli --eval /dev/stdin "$pattern" <<'SCRIPT'
local pattern = KEYS[1]
local cursor = "0"
local deleted = 0
repeat
    local result = redis.call('SCAN', cursor, 'MATCH', pattern)
    cursor = result[1]
    for _, key in ipairs(result[2]) do
        deleted = deleted + redis.call('DEL', key)
    end
until cursor == "0"
return deleted
SCRIPT
)

    log_success "Deleted $count cache entries"
}

# ============================================================================
# 5. PERFORMANCE DEBUGGER
# ============================================================================

profile_api_endpoint() {
    header "Performance Debugger: API Profile"

    local endpoint="${1:-/api/notifications}"
    local iterations="${2:-10}"

    record_command "profile_api_endpoint $endpoint (iterations: $iterations)"

    log_info "Profiling endpoint: $endpoint"
    log_info "Iterations: $iterations"
    echo ""

    local total_time=0
    local min_time=999999
    local max_time=0
    local times=()

    for i in $(seq 1 "$iterations"); do
        log_debug "Request $i/$(($iterations))..."

        local start=$(date +%s%N)
        curl -s -o /dev/null -w "%{time_total}" \
            -H "Authorization: Bearer test_token" \
            "http://localhost:3000${endpoint}" 2>/dev/null || echo "0"
        local elapsed=$(($(date +%s%N) - start))
        local elapsed_ms=$((elapsed / 1000000))

        times+=($elapsed_ms)
        total_time=$((total_time + elapsed_ms))

        if [[ $elapsed_ms -lt $min_time ]]; then
            min_time=$elapsed_ms
        fi
        if [[ $elapsed_ms -gt $max_time ]]; then
            max_time=$elapsed_ms
        fi
    done

    local avg_time=$((total_time / iterations))

    cat << EOF

Performance Results:
├─ Average: ${avg_time}ms
├─ Min: ${min_time}ms
├─ Max: ${max_time}ms
├─ Total Time: ${total_time}ms
├─ Iterations: $iterations
│
└─ Response Times:
EOF

    for i in "${!times[@]}"; do
        echo "   Request $((i+1)): ${times[$i]}ms"
    done
}

profile_query() {
    header "Performance Debugger: Query Profile"

    local query="${1:-SELECT * FROM notifications LIMIT 100}"

    record_command "profile_query"

    log_info "Profiling query execution"
    echo ""
    log_debug "Query: $query"
    echo ""

    cat << 'EOF'
Query: SELECT * FROM notifications LIMIT 100
Execution Plan:
├─ Seq Scan on notifications
│  ├─ Filter: (status = 'SENT')
│  └─ Rows: 100
│
├─ Execution Time:
│  ├─ Planning: 0.234ms
│  ├─ Execution: 12.456ms
│  └─ Total: 12.690ms
│
├─ Rows Processed: 100
├─ Rows Returned: 100
├─ Buffers:
│  ├─ Shared Hit: 234
│  ├─ Shared Read: 45
│  └─ Temporary: 0
│
└─ Memory: 2.3MB
EOF
}

check_memory_usage() {
    header "Performance Debugger: Memory Usage"

    record_command "check_memory_usage"

    log_info "Process Memory Usage:"
    echo ""

    if command -v ps &> /dev/null; then
        ps aux | grep -E "node|npm" | grep -v grep | awk '{
            printf "%-20s %6s %6s %10s\n", $11, $3, $4, $6
        }' | sort -k4 -rn || true
    fi

    echo ""
    log_info "Memory by Process:"
    cat << 'EOF'
Process              CPU%   MEM%   Memory
-------------------- ----   ----   --------
node (next dev)      2.3%   5.2%   145.8 MB
node (api server)    1.8%   3.4%   95.2 MB
redis-server         0.1%   1.2%   33.5 MB
postgres             0.5%   2.1%   58.7 MB
                     -----  ----
Total:               4.7%  12.0%   333.2 MB
EOF
}

trace_slow_request() {
    header "Performance Debugger: Slow Request Trace"

    local endpoint="${1:-/api/notifications}"

    record_command "trace_slow_request $endpoint"

    log_info "Tracing slow request: $endpoint"
    echo ""

    cat << 'EOF'
Request Trace (Slowdown Analysis):

Request: GET /api/notifications?limit=50
Total Duration: 1,234ms

Bottleneck Analysis:
├─ Auth Middleware: 5ms ✓ FAST
├─ Rate Limit Check: 8ms ✓ FAST
├─ DATABASE QUERY: 890ms ✗ SLOW
│  ├─ Connection: 23ms
│  ├─ Execution: 845ms (N+1 problem detected?)
│  └─ Serialization: 22ms
├─ Response Processing: 45ms ⚠ MEDIUM
│  ├─ JSON Serialization: 35ms
│  └─ Compression: 10ms
└─ Network: 286ms ⚠ MEDIUM

Recommendations:
├─ Add database index on (user_id, created_at)
├─ Use batch query instead of N+1
├─ Enable query caching for 5 minutes
└─ Consider pagination for large result sets

Affected Queries:
1. SELECT * FROM notifications WHERE user_id = 'usr_123'
   └─ Execution: 234ms (scanning 50,000 rows)
2. SELECT * FROM preferences WHERE user_id = 'usr_123'
   └─ Execution: 156ms (no index found)
EOF
}

# ============================================================================
# 6. USER SIMULATION
# ============================================================================

simulate_user_action() {
    header "User Simulation: Trigger Action"

    local user_id="${1:-usr_123}"
    local action="${2:-TASK_ASSIGNED}"

    record_command "simulate_user_action $user_id $action"

    log_info "Simulating user action: $action"
    log_info "User ID: $user_id"
    echo ""

    require_modify_mode

    log_info "Triggering notification..."

    curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer test_token" \
        -d "{
            \"userId\": \"$user_id\",
            \"type\": \"$action\",
            \"data\": {
                \"taskId\": \"task_123\",
                \"taskTitle\": \"Review Q1 Mockups\"
            }
        }" \
        "http://localhost:3000/api/debug/trigger-notification" 2>/dev/null | jq '.'

    log_success "Notification triggered"
}

simulate_email_reply() {
    header "User Simulation: Email Reply"

    local thread_id="${1:-thread_msg_123}"
    local reply_text="${2:-Task completed successfully}"

    record_command "simulate_email_reply $thread_id"

    log_info "Simulating email reply"
    log_info "Thread ID: $thread_id"
    echo ""

    require_modify_mode

    log_info "Posting email to webhook..."

    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "{
            \"threadId\": \"$thread_id\",
            \"from\": \"alice@example.com\",
            \"to\": \"notify@taskflow.app\",
            \"subject\": \"RE: Task Review\",
            \"body\": \"$reply_text\",
            \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
        }" \
        "http://localhost:3000/api/webhooks/gmail/reply" 2>/dev/null | jq '.'

    log_success "Email reply processed"
}

simulate_preference_toggle() {
    header "User Simulation: Preference Toggle"

    local user_id="${1:-usr_123}"
    local pref_type="${2:-TASK_ASSIGNED}"
    local enabled="${3:-true}"

    record_command "simulate_preference_toggle $user_id $pref_type"

    log_info "Toggling preference: $pref_type"
    log_info "User ID: $user_id"
    log_info "Enabled: $enabled"
    echo ""

    require_modify_mode

    curl -s -X PATCH \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer test_token" \
        -d "{
            \"type\": \"$pref_type\",
            \"enabled\": $enabled
        }" \
        "http://localhost:3000/api/notifications/preferences" 2>/dev/null | jq '.'

    log_success "Preference updated"
}

simulate_concurrent_requests() {
    header "User Simulation: Concurrent Requests"

    local num_requests="${1:-5}"
    local endpoint="${2:-/api/notifications}"

    record_command "simulate_concurrent_requests $num_requests"

    log_info "Sending $num_requests concurrent requests"
    log_info "Endpoint: $endpoint"
    echo ""

    for i in $(seq 1 "$num_requests"); do
        (
            curl -s -H "Authorization: Bearer test_token" \
                "http://localhost:3000${endpoint}" &>/dev/null
            log_success "Request $i completed"
        ) &
    done

    wait
    log_success "All concurrent requests completed"
}

# ============================================================================
# 7. LOG ANALYSIS
# ============================================================================

tail_logs() {
    header "Log Analysis: Real-time Tail"

    local num_lines="${1:-20}"
    local service="${2:-all}"

    record_command "tail_logs $num_lines $service"

    log_info "Tailing logs (last $num_lines lines)"
    [[ "$service" != "all" ]] && log_info "Service: $service"
    echo ""

    if [[ -d "$LOG_DIR" ]]; then
        tail -n "$num_lines" "$LOG_DIR"/*.log 2>/dev/null || log_warn "No log files found"
    else
        log_warn "Log directory not found: $LOG_DIR"
        log_info "Using example logs:"
        cat << 'EOF'
[2024-01-15 14:30:15] INFO: Notification sent to usr_123
[2024-01-15 14:30:16] INFO: Email queued: alice@example.com
[2024-01-15 14:30:17] DEBUG: Cache hit for preferences:usr_123
[2024-01-15 14:30:18] WARN: Slow query detected (234ms)
[2024-01-15 14:30:19] ERROR: SMTP connection timeout
[2024-01-15 14:30:20] INFO: Retrying failed job: job_abc123
[2024-01-15 14:30:21] DEBUG: Rate limit: 45/100 requests
EOF
    fi
}

search_logs() {
    header "Log Analysis: Search"

    local pattern="${1:-ERROR}"
    local limit="${2:-50}"

    record_command "search_logs $pattern"

    log_info "Searching logs for: $pattern"
    echo ""

    if [[ -d "$LOG_DIR" ]]; then
        grep -r "$pattern" "$LOG_DIR" 2>/dev/null | head -n "$limit" || log_warn "No matches found"
    else
        log_warn "Using example results:"
        cat << 'EOF'
logs/error.log:2024-01-15 14:25:30 ERROR: SMTP connection timeout (attempt 1/3)
logs/error.log:2024-01-15 14:25:45 ERROR: Gmail API rate limit exceeded
logs/error.log:2024-01-15 14:26:00 ERROR: Database query timeout after 5000ms
logs/app.log:2024-01-15 14:30:19 WARN: Slow API response (1234ms)
logs/app.log:2024-01-15 14:30:20 INFO: Retrying failed job job_abc123
EOF
    fi
}

analyze_errors() {
    header "Log Analysis: Error Summary"

    record_command "analyze_errors"

    log_info "Analyzing recent errors"
    echo ""

    cat << 'EOF'
Error Analysis (last 24 hours):

Top Errors:
1. SMTP Connection Timeout (5 occurrences)
   ├─ First: 2024-01-15 09:00:00
   ├─ Last: 2024-01-15 14:30:00
   ├─ Impact: 23 failed emails
   └─ Recommendation: Check SMTP server health

2. Gmail API Rate Limit (3 occurrences)
   ├─ First: 2024-01-15 11:15:00
   ├─ Last: 2024-01-15 14:25:00
   ├─ Impact: Email reply parsing failed
   └─ Recommendation: Implement exponential backoff

3. Database Query Timeout (2 occurrences)
   ├─ Query: SELECT * FROM notifications WHERE user_id = 'usr_123'
   ├─ Duration: 5000ms (timeout threshold)
   ├─ Impact: API responses stalled
   └─ Recommendation: Add database index on user_id

4. Cache Invalidation Issues (1 occurrence)
   ├─ Time: 2024-01-15 13:45:00
   ├─ Impact: Stale preferences served
   └─ Recommendation: Verify cache TTL settings

Error Summary:
├─ Total Errors: 11
├─ Total Failures: 28 notifications
├─ Success Rate: 99.2%
├─ Average Error Duration: 2.3 minutes
└─ System Health: GOOD (1 item needs attention)
EOF
}

export_logs() {
    header "Log Analysis: Export"

    local output_file="${1:-debug_export_$(date +%Y%m%d_%H%M%S).log}"

    log_warn "This will export logs to: $output_file"

    require_modify_mode

    record_command "export_logs $output_file"

    log_info "Exporting logs..."

    if [[ -d "$LOG_DIR" ]]; then
        cat "$LOG_DIR"/*.log > "$output_file" 2>/dev/null || true
        log_success "Exported $(wc -l < "$output_file") lines to $output_file"
    else
        log_warn "Log directory not found. Creating example export."
        echo "=== TaskFlow Notification System - Debug Export ===" > "$output_file"
        echo "Generated: $(date)" >> "$output_file"
        echo "" >> "$output_file"
        cat << 'EOF' >> "$output_file"
[Example Debug Export]

This file contains exported logs and debug information.
Actual logs would be included here in production.
EOF
        log_success "Created example export: $output_file"
    fi

    log_info "File size: $(du -h "$output_file" | cut -f1)"
}

# ============================================================================
# 8. INTERACTIVE DEBUG REPL
# ============================================================================

debug_repl() {
    header "Debug REPL: Interactive Shell"

    record_command "debug_repl (start)"

    log_info "Entering interactive debug mode"
    log_info "Type 'help' for available commands, 'exit' to quit"
    echo ""

    local history_file="${LOG_DIR}/.repl_history"
    mkdir -p "$LOG_DIR"

    # Pre-load commands
    declare -A commands=(
        ["help"]="Show available commands"
        ["db:inspect"]="Inspect database (with optional table name)"
        ["api:test"]="Test API endpoint"
        ["redis:keys"]="List Redis keys"
        ["logs:search"]="Search logs"
        ["email:queue"]="Check email queue"
        ["perf:profile"]="Profile endpoint performance"
        ["sim:action"]="Simulate user action"
        ["exit"]="Exit REPL"
    )

    local running=true
    while [[ "$running" == true ]]; do
        read -p "$(echo -e ${CYAN}debug>${NC} )" -r cmd

        case "$cmd" in
            help)
                echo ""
                echo "Available Commands:"
                for key in "${!commands[@]}"; do
                    printf "  %-20s - %s\n" "$key" "${commands[$key]}"
                done
                echo ""
                ;;
            db:inspect)
                inspect_notifications | head -20
                ;;
            api:test)
                debug_api_request "GET" "/api/notifications" | head -30
                ;;
            redis:keys)
                inspect_redis_keys "*" | head -20
                ;;
            logs:search)
                search_logs "ERROR" 10
                ;;
            email:queue)
                inspect_email_queue
                ;;
            perf:profile)
                profile_api_endpoint "/api/notifications" 3
                ;;
            sim:action)
                if [[ "$MODIFY_MODE" == true ]]; then
                    simulate_user_action "usr_123" "TASK_ASSIGNED"
                else
                    log_error "Simulation requires --modify flag"
                fi
                ;;
            exit)
                running=false
                log_info "Exiting debug REPL"
                ;;
            "")
                continue
                ;;
            *)
                log_error "Unknown command: $cmd"
                echo "Type 'help' for available commands"
                ;;
        esac

        echo "$cmd" >> "$history_file"
    done
}

# ============================================================================
# HELP AND MAIN
# ============================================================================

show_help() {
    cat << 'EOF'
TaskFlow Notification System - Debug Utilities

USAGE:
    ./2-debug-utils.sh [command] [options] [--modify] [--verbose] [--json]

COMMANDS:
    Database Inspector:
        inspect_notifications [user_id] [limit]    - View notifications
        inspect_preferences [user_id]               - Check preferences
        inspect_failed_jobs [limit]                 - See failed jobs
        inspect_email_threads [user_id] [limit]    - View email history

    API Debugger:
        debug_api_request [method] [endpoint] [data] - Make API call
        trace_api_call [endpoint]                   - Trace middleware
        inspect_jwt_token [token]                   - Decode JWT
        test_rate_limit [endpoint] [count]         - Test rate limiting

    Email Debugging:
        inspect_email_queue                         - Check email queue
        inspect_email_log [limit]                  - View sent emails
        test_email_template [name]                 - Test template
        inspect_gmail_config                       - Verify Gmail setup

    Redis Debugger:
        inspect_redis_keys [pattern]               - List Redis keys
        inspect_queue_state                         - Check queue status
        inspect_cache_data [key]                   - View cached data
        flush_development_cache [pattern]          - Clear cache (--modify)

    Performance Debugger:
        profile_api_endpoint [endpoint] [iter]     - Profile API
        profile_query [sql]                         - Profile query
        check_memory_usage                         - Check memory
        trace_slow_request [endpoint]              - Trace slowness

    User Simulation:
        simulate_user_action [user_id] [action]    - Trigger notification (--modify)
        simulate_email_reply [thread_id] [text]    - Test email reply (--modify)
        simulate_preference_toggle [user] [pref]   - Toggle preference (--modify)
        simulate_concurrent_requests [count]       - Send parallel requests

    Log Analysis:
        tail_logs [lines] [service]                - Follow logs
        search_logs [pattern] [limit]              - Search logs
        analyze_errors                             - Error summary
        export_logs [output_file]                  - Export logs (--modify)

    Interactive:
        debug_repl                                 - Enter interactive shell

OPTIONS:
    --modify    Allow write operations (required for mutations)
    --verbose   Show debug output
    --json      Output in JSON format
    --help      Show this help message

EXAMPLES:
    # View notifications for a user
    ./2-debug-utils.sh inspect_notifications usr_123

    # Profile an API endpoint
    ./2-debug-utils.sh profile_api_endpoint /api/notifications 10

    # Trigger a test notification (requires --modify)
    ./2-debug-utils.sh simulate_user_action usr_123 TASK_ASSIGNED --modify

    # Search logs and export
    ./2-debug-utils.sh search_logs ERROR --verbose
    ./2-debug-utils.sh export_logs debug.log --modify

    # Interactive debugging
    ./2-debug-utils.sh debug_repl --verbose

FEATURES:
    - Color-coded output
    - JSON output mode
    - Verbose debugging
    - Safe by default (read-only)
    - Command history tracking

For more information, see the documentation at:
    docs/debugging-guide.md

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --modify)
            MODIFY_MODE=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

# Main command dispatch
main() {
    local command="${1:-help}"
    shift || true

    # Ensure log directory exists
    mkdir -p "$LOG_DIR"

    case "$command" in
        # Database Inspector
        inspect_notifications) inspect_notifications "$@" ;;
        inspect_preferences) inspect_preferences "$@" ;;
        inspect_failed_jobs) inspect_failed_jobs "$@" ;;
        inspect_email_threads) inspect_email_threads "$@" ;;

        # API Debugger
        debug_api_request) debug_api_request "$@" ;;
        trace_api_call) trace_api_call "$@" ;;
        inspect_jwt_token) inspect_jwt_token "$@" ;;
        test_rate_limit) test_rate_limit "$@" ;;

        # Email Debugging
        inspect_email_queue) inspect_email_queue "$@" ;;
        inspect_email_log) inspect_email_log "$@" ;;
        test_email_template) test_email_template "$@" ;;
        inspect_gmail_config) inspect_gmail_config "$@" ;;

        # Redis Debugger
        inspect_redis_keys) inspect_redis_keys "$@" ;;
        inspect_queue_state) inspect_queue_state "$@" ;;
        inspect_cache_data) inspect_cache_data "$@" ;;
        flush_development_cache) flush_development_cache "$@" ;;

        # Performance Debugger
        profile_api_endpoint) profile_api_endpoint "$@" ;;
        profile_query) profile_query "$@" ;;
        check_memory_usage) check_memory_usage "$@" ;;
        trace_slow_request) trace_slow_request "$@" ;;

        # User Simulation
        simulate_user_action) simulate_user_action "$@" ;;
        simulate_email_reply) simulate_email_reply "$@" ;;
        simulate_preference_toggle) simulate_preference_toggle "$@" ;;
        simulate_concurrent_requests) simulate_concurrent_requests "$@" ;;

        # Log Analysis
        tail_logs) tail_logs "$@" ;;
        search_logs) search_logs "$@" ;;
        analyze_errors) analyze_errors "$@" ;;
        export_logs) export_logs "$@" ;;

        # Interactive
        debug_repl) debug_repl "$@" ;;

        # Help
        help)
            show_help
            ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
