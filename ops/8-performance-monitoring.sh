#!/bin/bash

################################################################################
# TASKFLOW NOTIFICATION SYSTEM - PERFORMANCE MONITORING SUITE
#
# Comprehensive monitoring and profiling for all system components:
# - Database performance (slow queries, table sizes, index usage)
# - API performance (latency distribution, throughput)
# - Email delivery (latency, retry patterns, throughput)
# - Redis performance (memory, commands, persistence)
# - System performance (CPU, memory, file descriptors)
# - External dependencies (Supabase, Gmail, PubSub)
# - Reporting and trending analysis
#
# Usage: ./8-performance-monitoring.sh [command] [options]
# Commands: db, api, email, redis, system, deps, report, watch, help
################################################################################

set -euo pipefail

# ===============================================================================
# SECTION 0: CONFIGURATION & COLORS
# ===============================================================================

# Color codes for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly MAGENTA='\033[0;35m'
readonly NC='\033[0m' # No Color

# Performance thresholds (configurable)
readonly SLOW_QUERY_MS=${SLOW_QUERY_MS:-100}
readonly SLOW_API_MS=${SLOW_API_MS:-500}
readonly SLOW_EMAIL_MS=${SLOW_EMAIL_MS:-2000}
readonly SLOW_REDIS_MS=${SLOW_REDIS_MS:-10}
readonly CPU_THRESHOLD=${CPU_THRESHOLD:-80}
readonly MEM_THRESHOLD=${MEM_THRESHOLD:-85}
readonly MAX_CONNECTIONS=${MAX_CONNECTIONS:-100}

# Paths
readonly LOG_DIR="${LOG_DIR:-.}/monitoring-logs"
readonly METRICS_DIR="${METRICS_DIR:-.}/metrics"
readonly BASELINE_FILE="${BASELINE_FILE:-.}/baseline.json"
readonly ALERT_LOG="${ALERT_LOG:-${LOG_DIR}/alerts.log}"

# Database defaults (override via env vars)
readonly DB_HOST=${DB_HOST:-localhost}
readonly DB_PORT=${DB_PORT:-5432}
readonly DB_NAME=${DB_NAME:-taskflow}
readonly DB_USER=${DB_USER:-postgres}

# Redis defaults
readonly REDIS_HOST=${REDIS_HOST:-localhost}
readonly REDIS_PORT=${REDIS_PORT:-6379}

# API endpoint
readonly API_BASE_URL=${API_BASE_URL:-http://localhost:3000}

# Gmail API
readonly GMAIL_API_ENDPOINT="https://gmail.googleapis.com/gmail/v1"

# Initialize directories
mkdir -p "${LOG_DIR}" "${METRICS_DIR}"

# ===============================================================================
# SECTION 0A: UTILITY FUNCTIONS
# ===============================================================================

# Color-coded logging
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "${LOG_DIR}/monitoring.log"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "${LOG_DIR}/monitoring.log"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "${LOG_DIR}/monitoring.log"
}

log_error() {
    echo -e "${RED}[✗]${NC} $(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "${LOG_DIR}/monitoring.log"
}

# Send alert
alert() {
    local severity=$1
    local message=$2

    local alert_msg="[${severity}] $(date '+%Y-%m-%d %H:%M:%S'): ${message}"
    echo "${alert_msg}" >> "${ALERT_LOG}"

    case "${severity}" in
        CRITICAL)
            log_error "${message}"
            # TODO: Integrate with alerting system (PagerDuty, Slack, etc.)
            ;;
        WARNING)
            log_warn "${message}"
            ;;
        INFO)
            log_info "${message}"
            ;;
    esac
}

# Output as JSON
output_json() {
    local name=$1
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local json_data=$2

    echo "{\"metric\": \"${name}\", \"timestamp\": \"${timestamp}\", \"data\": ${json_data}}"
}

# Format bytes to human-readable
format_bytes() {
    local bytes=$1
    if (( bytes < 1024 )); then
        echo "${bytes}B"
    elif (( bytes < 1048576 )); then
        echo "$((bytes / 1024))KB"
    elif (( bytes < 1073741824 )); then
        echo "$((bytes / 1048576))MB"
    else
        echo "$((bytes / 1073741824))GB"
    fi
}

# Parse and compare against threshold
check_threshold() {
    local value=$1
    local threshold=$2
    local name=$3

    if (( $(echo "$value > $threshold" | bc -l) )); then
        log_warn "${name}: ${value} exceeds threshold ${threshold}"
        return 1
    fi
    return 0
}

# Calculate percentile
calculate_percentile() {
    local percentile=$1
    local -a values=("${@:2}")

    # Sort values
    readarray -t sorted < <(printf '%s\n' "${values[@]}" | sort -n)

    local idx=$(( (${#sorted[@]} * percentile) / 100 ))
    echo "${sorted[$idx]}"
}

# Load baseline metrics
load_baseline() {
    if [[ -f "${BASELINE_FILE}" ]]; then
        cat "${BASELINE_FILE}"
    else
        echo "{}"
    fi
}

# Save baseline metrics
save_baseline() {
    local metrics=$1
    echo "${metrics}" > "${BASELINE_FILE}"
}

# ===============================================================================
# SECTION 1: DATABASE PERFORMANCE MONITORING
# ===============================================================================

# Find slow queries (> SLOW_QUERY_MS)
profile_slow_queries() {
    log_info "Profiling slow queries (> ${SLOW_QUERY_MS}ms)..."

    local query="
    SELECT
        mean_exec_time::numeric as mean_ms,
        max_exec_time::numeric as max_ms,
        calls,
        query
    FROM pg_stat_statements
    WHERE mean_exec_time > ${SLOW_QUERY_MS}
    ORDER BY mean_exec_time DESC
    LIMIT 20;
    "

    local results=$(PGPASSWORD="${DB_USER}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -d "${DB_NAME}" -U "${DB_USER}" -tAc "${query}" 2>/dev/null || echo "")

    if [[ -z "${results}" ]]; then
        log_info "Extension pg_stat_statements not enabled or no slow queries found"
        return 0
    fi

    echo -e "\n${CYAN}=== SLOW QUERIES ===${NC}"
    echo "Mean Time | Max Time | Calls | Query"
    echo "----------|----------|-------|------"
    echo "${results}" | while IFS='|' read -r mean max calls query; do
        if [[ -n "${mean}" ]]; then
            printf "%-9.2fms | %-8.2fms | %-5s | %.80s\n" "${mean}" "${max}" "${calls}" "${query}"

            # Alert on critical slow queries
            if (( $(echo "${mean} > 500" | bc -l) )); then
                alert "WARNING" "Slow query detected: ${mean}ms - ${query:0:100}"
            fi
        fi
    done

    # Export to JSON
    local json=$(echo "${results}" | jq -Rs 'split("\n") | map(select(length > 0) | split("|") | {mean_ms: (.[0] | tonumber), max_ms: (.[1] | tonumber), calls: (.[2] | tonumber), query: .[3]})' 2>/dev/null || echo "[]")
    output_json "slow_queries" "${json}" > "${METRICS_DIR}/slow_queries.json"
}

# Analyze table and index sizes
analyze_table_size() {
    log_info "Analyzing table and index sizes..."

    local query="
    SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
        pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
        pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) AS indexes_size
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
    "

    echo -e "\n${CYAN}=== TABLE SIZES ===${NC}"
    PGPASSWORD="${DB_USER}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -d "${DB_NAME}" -U "${DB_USER}" -c "${query}" 2>/dev/null || log_error "Failed to connect to database"
}

# Monitor connection pool
monitor_connection_pool() {
    log_info "Monitoring connection pool..."

    local query="
    SELECT
        datname,
        usename,
        count(*) as connections,
        state
    FROM pg_stat_activity
    GROUP BY datname, usename, state
    ORDER BY count(*) DESC;
    "

    echo -e "\n${CYAN}=== CONNECTION POOL ===${NC}"
    PGPASSWORD="${DB_USER}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -d "${DB_NAME}" -U "${DB_USER}" -c "${query}" 2>/dev/null || log_error "Failed to connect to database"

    # Check active connections
    local active_connections=$(PGPASSWORD="${DB_USER}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -d "${DB_NAME}" -U "${DB_USER}" -tAc "SELECT count(*) FROM pg_stat_activity WHERE datname = '${DB_NAME}';" 2>/dev/null || echo "0")

    if [[ -n "${active_connections}" ]]; then
        if (( active_connections > MAX_CONNECTIONS )); then
            alert "CRITICAL" "Connection pool at ${active_connections}/${MAX_CONNECTIONS}"
        fi

        # Export metrics
        echo "{\"active_connections\": ${active_connections}, \"max_allowed\": ${MAX_CONNECTIONS}, \"utilization_percent\": $((active_connections * 100 / MAX_CONNECTIONS))}" | \
            output_json "connection_pool" - > "${METRICS_DIR}/connection_pool.json"
    fi
}

# Check index usage
check_index_usage() {
    log_info "Checking index usage..."

    local query="
    SELECT
        schemaname,
        tablename,
        indexname,
        idx_scan as scans,
        pg_size_pretty(pg_relation_size(indexrelid)) as size
    FROM pg_stat_user_indexes
    ORDER BY idx_scan ASC
    LIMIT 20;
    "

    echo -e "\n${CYAN}=== UNUSED/UNDERUSED INDEXES ===${NC}"
    PGPASSWORD="${DB_USER}" psql -h "${DB_HOST}" -p "${DB_PORT}" \
        -d "${DB_NAME}" -U "${DB_USER}" -c "${query}" 2>/dev/null || log_error "Failed to connect to database"
}

# Main database monitoring function
monitor_database() {
    log_info "Starting database performance monitoring..."

    profile_slow_queries
    analyze_table_size
    monitor_connection_pool
    check_index_usage

    log_success "Database monitoring complete"
}

# ===============================================================================
# SECTION 2: API PERFORMANCE MONITORING
# ===============================================================================

# Profile API endpoints for latency
profile_api_endpoints() {
    log_info "Profiling API endpoints..."

    local endpoints=(
        "/api/notifications"
        "/api/notifications/preferences"
        "/api/health"
        "/api/metrics"
    )

    echo -e "\n${CYAN}=== API LATENCY ===${NC}"
    echo "Endpoint | P50 (ms) | P95 (ms) | P99 (ms) | Calls"
    echo "---------|----------|----------|----------|-------"

    declare -A latencies

    for endpoint in "${endpoints[@]}"; do
        local -a times=()
        local calls=0

        # Make 10 requests to each endpoint
        for i in {1..10}; do
            local start=$(date +%s%N)
            local response=$(curl -s -o /dev/null -w "%{http_code}" \
                "${API_BASE_URL}${endpoint}" 2>/dev/null || echo "000")
            local end=$(date +%s%N)

            if [[ "${response}" == "200" ]]; then
                local duration=$(( (end - start) / 1000000 )) # Convert to ms
                times+=("${duration}")
                ((calls++))
            fi
        done

        if [[ ${#times[@]} -gt 0 ]]; then
            local p50=$(calculate_percentile 50 "${times[@]}")
            local p95=$(calculate_percentile 95 "${times[@]}")
            local p99=$(calculate_percentile 99 "${times[@]}")

            printf "%-40s | %-8d | %-8d | %-8d | %-5d\n" \
                "${endpoint}" "${p50}" "${p95}" "${p99}" "${calls}"

            # Alert on high latency
            if [[ ${p99} -gt ${SLOW_API_MS} ]]; then
                alert "WARNING" "API endpoint ${endpoint} P99 latency: ${p99}ms (threshold: ${SLOW_API_MS}ms)"
            fi

            latencies["${endpoint}"]="${p50}|${p95}|${p99}"
        fi
    done

    # Export to JSON
    local json="{}"
    for endpoint in "${!latencies[@]}"; do
        IFS='|' read -r p50 p95 p99 <<< "${latencies[${endpoint}]}"
        json=$(echo "${json}" | jq --arg ep "${endpoint}" --arg p50 "${p50}" --arg p95 "${p95}" --arg p99 "${p99}" \
            '.[$ep] = {p50_ms: ($p50 | tonumber), p95_ms: ($p95 | tonumber), p99_ms: ($p99 | tonumber)}')
    done
    echo "${json}" | output_json "api_latency" - > "${METRICS_DIR}/api_latency.json"
}

# Load test API with synthetic load
load_test_api() {
    log_info "Running load test (100 concurrent requests)..."

    local endpoint="${1:-/api/notifications}"
    local concurrency="${2:-100}"
    local duration="${3:-10}"

    echo -e "\n${CYAN}=== API LOAD TEST ===${NC}"
    echo "Endpoint: ${endpoint}"
    echo "Concurrency: ${concurrency}"
    echo "Duration: ${duration}s"
    echo ""

    # Use GNU parallel if available, fallback to background jobs
    if command -v parallel &> /dev/null; then
        echo "Using GNU parallel..."
        seq 1 "${concurrency}" | parallel -j "${concurrency}" \
            "curl -s -o /dev/null -w 'Code: %{http_code} Time: %{time_total}s\n' '${API_BASE_URL}${endpoint}'" 2>/dev/null | \
            tee "${METRICS_DIR}/load_test.log"
    else
        log_info "GNU parallel not found, using background jobs..."
        local start_time=$(date +%s)
        local -a pids=()

        for i in $(seq 1 "${concurrency}"); do
            curl -s -o /dev/null -w "Code: %{http_code} Time: %{time_total}s\n" \
                "${API_BASE_URL}${endpoint}" 2>/dev/null >> "${METRICS_DIR}/load_test.log" &
            pids+=("$!")
        done

        # Wait for all requests to complete or timeout
        for pid in "${pids[@]}"; do
            wait "${pid}" 2>/dev/null || true
        done
    fi

    # Analyze results
    if [[ -f "${METRICS_DIR}/load_test.log" ]]; then
        echo ""
        echo "Results summary:"
        grep "Code:" "${METRICS_DIR}/load_test.log" | grep -o "Code: [0-9]*" | sort | uniq -c
        local avg_time=$(grep "Time:" "${METRICS_DIR}/load_test.log" | grep -o "Time: [0-9.]*" | \
            awk '{sum+=$2; count++} END {print sum/count}')
        echo "Average response time: ${avg_time}s"
    fi
}

# Trace slow requests
trace_slow_requests() {
    log_info "Tracing requests slower than ${SLOW_API_MS}ms..."

    local endpoint="${1:-/api/notifications}"

    echo -e "\n${CYAN}=== REQUEST TRACING ===${NC}"
    echo "Endpoint: ${endpoint}"
    echo "Making 5 requests with detailed timing..."
    echo ""

    for i in {1..5}; do
        echo "Request $i:"
        curl -w "\nTime: %{time_total}s\nConnect: %{time_connect}s\nStartTransfer: %{time_starttransfer}s\n" \
            "${API_BASE_URL}${endpoint}" 2>/dev/null | head -c 200
        echo ""
        echo "---"
    done
}

# Analyze bundle size
analyze_bundle_size() {
    log_info "Analyzing bundle sizes..."

    echo -e "\n${CYAN}=== BUNDLE SIZE ANALYSIS ===${NC}"

    # Check if build directory exists
    if [[ -d "./dist" ]]; then
        echo "JavaScript bundles:"
        find ./dist -name "*.js" -type f -exec du -h {} \; | sort -rh | head -10

        echo ""
        echo "CSS bundles:"
        find ./dist -name "*.css" -type f -exec du -h {} \; | sort -rh | head -10

        # Calculate total
        local total=$(du -sh ./dist | cut -f1)
        echo ""
        echo "Total dist size: ${total}"
    else
        log_warn "Build directory not found at ./dist"
    fi
}

# Main API monitoring function
monitor_api() {
    log_info "Starting API performance monitoring..."

    profile_api_endpoints
    load_test_api "$@"
    trace_slow_requests
    analyze_bundle_size

    log_success "API monitoring complete"
}

# ===============================================================================
# SECTION 3: EMAIL DELIVERY PERFORMANCE MONITORING
# ===============================================================================

# Measure email delivery latency
measure_email_latency() {
    log_info "Measuring email delivery latency..."

    echo -e "\n${CYAN}=== EMAIL DELIVERY LATENCY ===${NC}"

    # Look for email metrics in logs or database
    if [[ -f "./logs/email-delivery.log" ]]; then
        echo "Analyzing recent email sends..."

        # Extract send times and delivery times
        local -a latencies=()
        while IFS='|' read -r timestamp template send_time delivery_time status; do
            if [[ -n "${delivery_time}" ]] && [[ "${status}" == "success" ]]; then
                local latency=$(echo "${delivery_time} - ${send_time}" | bc)
                latencies+=("${latency}")
            fi
        done < <(grep -oP 'template=\K[^|]*(?=\|[^|]*\|[^|]*\|[^|]*\|success)' "./logs/email-delivery.log" 2>/dev/null || echo "")

        if [[ ${#latencies[@]} -gt 0 ]]; then
            local p50=$(calculate_percentile 50 "${latencies[@]}")
            local p95=$(calculate_percentile 95 "${latencies[@]}")
            local p99=$(calculate_percentile 99 "${latencies[@]}")

            echo "Email Delivery Latency:"
            printf "P50: %dms | P95: %dms | P99: %dms\n" "${p50}" "${p95}" "${p99}"

            if [[ ${p99} -gt ${SLOW_EMAIL_MS} ]]; then
                alert "WARNING" "Email delivery P99 latency: ${p99}ms (threshold: ${SLOW_EMAIL_MS}ms)"
            fi
        fi
    else
        log_info "Email delivery log not found, attempting to fetch from API..."
        # Could query an email metrics API endpoint here
    fi
}

# Analyze retry patterns
analyze_retry_pattern() {
    log_info "Analyzing email retry patterns..."

    echo -e "\n${CYAN}=== EMAIL RETRY PATTERNS ===${NC}"

    if [[ -f "./logs/email-retry.log" ]]; then
        echo "Retry statistics:"

        local total_attempts=$(wc -l < "./logs/email-retry.log")
        local successful=$(grep -c "status=success" "./logs/email-retry.log" || echo "0")
        local failed=$(grep -c "status=failed" "./logs/email-retry.log" || echo "0")
        local rate_limited=$(grep -c "status=rate_limited" "./logs/email-retry.log" || echo "0")

        local success_rate=$(( successful * 100 / total_attempts ))

        printf "Total attempts: %d\n" "${total_attempts}"
        printf "Successful: %d (%.1f%%)\n" "${successful}" "${success_rate}"
        printf "Failed: %d\n" "${failed}"
        printf "Rate limited: %d\n" "${rate_limited}"

        if [[ ${success_rate} -lt 95 ]]; then
            alert "WARNING" "Email success rate below 95%: ${success_rate}%"
        fi
    fi
}

# Measure template rendering time
measure_template_render_time() {
    log_info "Measuring email template render time..."

    echo -e "\n${CYAN}=== EMAIL TEMPLATE RENDERING ===${NC}"

    # Look for rendering metrics
    if [[ -d "./logs" ]]; then
        # Search for rendering time patterns in logs
        local -a render_times=()
        while read -r line; do
            if [[ $line =~ render_time=([0-9.]+)ms ]]; then
                render_times+=("${BASH_REMATCH[1]}")
            fi
        done < <(grep -r "render_time=" "./logs" 2>/dev/null || echo "")

        if [[ ${#render_times[@]} -gt 0 ]]; then
            local p50=$(calculate_percentile 50 "${render_times[@]}")
            local p95=$(calculate_percentile 95 "${render_times[@]}")
            local p99=$(calculate_percentile 99 "${render_times[@]}")

            printf "P50: %.2fms | P95: %.2fms | P99: %.2fms\n" "${p50}" "${p95}" "${p99}"
        fi
    fi
}

# Check email throughput
check_email_throughput() {
    log_info "Checking email throughput (messages/second)..."

    echo -e "\n${CYAN}=== EMAIL THROUGHPUT ===${NC}"

    if [[ -f "./logs/email-delivery.log" ]]; then
        # Count emails sent in last minute
        local one_min_ago=$(date -u -d "1 minute ago" '+%Y-%m-%d %H:%M' 2>/dev/null || date -u -v-1M '+%Y-%m-%d %H:%M')
        local recent_count=$(grep "${one_min_ago}" "./logs/email-delivery.log" 2>/dev/null | wc -l || echo "0")

        local throughput=$(( recent_count / 60 ))
        echo "Last minute: ${throughput} emails/second (${recent_count} total)"

        # Check peak hour
        local one_hour_ago=$(date -u -d "1 hour ago" '+%Y-%m-%d' 2>/dev/null || date -u -v-1H '+%Y-%m-%d')
        local hourly_count=$(grep "${one_hour_ago}" "./logs/email-delivery.log" 2>/dev/null | wc -l || echo "0")
        local peak_throughput=$(( hourly_count / 3600 ))

        echo "Peak hour average: ${peak_throughput} emails/second (${hourly_count} total)"
    fi
}

# Main email monitoring function
monitor_email() {
    log_info "Starting email delivery performance monitoring..."

    measure_email_latency
    analyze_retry_pattern
    measure_template_render_time
    check_email_throughput

    log_success "Email monitoring complete"
}

# ===============================================================================
# SECTION 4: REDIS PERFORMANCE MONITORING
# ===============================================================================

# Monitor Redis memory usage
monitor_redis_memory() {
    log_info "Monitoring Redis memory..."

    echo -e "\n${CYAN}=== REDIS MEMORY ===${NC}"

    if command -v redis-cli &> /dev/null; then
        local info=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" INFO memory 2>/dev/null || echo "")

        if [[ -n "${info}" ]]; then
            local used_memory=$(echo "${info}" | grep "^used_memory:" | cut -d':' -f2 | tr -d '\r')
            local max_memory=$(echo "${info}" | grep "^maxmemory:" | cut -d':' -f2 | tr -d '\r')
            local evicted=$(echo "${info}" | grep "^evicted_keys:" | cut -d':' -f2 | tr -d '\r')

            echo "Used memory: $(format_bytes ${used_memory})"

            if [[ -n "${max_memory}" ]] && [[ ${max_memory} -gt 0 ]]; then
                local utilization=$(( used_memory * 100 / max_memory ))
                echo "Max memory: $(format_bytes ${max_memory})"
                echo "Utilization: ${utilization}%"

                if [[ ${utilization} -gt 90 ]]; then
                    alert "CRITICAL" "Redis memory utilization at ${utilization}%"
                fi
            fi

            echo "Evicted keys: ${evicted}"
            if [[ ${evicted} -gt 0 ]]; then
                alert "WARNING" "Redis evicting keys: ${evicted} keys evicted"
            fi
        fi
    else
        log_warn "redis-cli not found, skipping Redis memory monitoring"
    fi
}

# Profile Redis commands
profile_redis_commands() {
    log_info "Profiling Redis commands..."

    echo -e "\n${CYAN}=== REDIS COMMAND PROFILE ===${NC}"

    if command -v redis-cli &> /dev/null; then
        # Get slowlog
        local slowlog=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" SLOWLOG GET 10 2>/dev/null || echo "")

        if [[ -n "${slowlog}" ]]; then
            echo "Slowest commands (last 10):"
            redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" SLOWLOG GET 10 2>/dev/null | grep -E "^[0-9]+\)" | while read -r line; do
                echo "${line}"
            done || true
        fi

        # Get command stats
        local stats=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" INFO stats 2>/dev/null || echo "")
        if [[ -n "${stats}" ]]; then
            echo ""
            echo "Command statistics:"
            echo "${stats}" | grep "^cmdstat_" | head -10
        fi
    fi
}

# Check Redis key patterns
check_key_patterns() {
    log_info "Checking Redis key patterns..."

    echo -e "\n${CYAN}=== REDIS KEY PATTERNS ===${NC}"

    if command -v redis-cli &> /dev/null; then
        local db_size=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" DBSIZE 2>/dev/null | grep -oP '\d+$' || echo "0")
        echo "Total keys: ${db_size}"

        # Sample key patterns
        echo "Key pattern distribution (sample):"
        redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" --scan --pattern "*" 2>/dev/null | \
            head -100 | sed 's/:.*$//' | sed 's/[0-9]\+/N/g' | sort | uniq -c | sort -rn | head -10 || true
    fi
}

# Measure persistence
measure_persistence() {
    log_info "Measuring Redis persistence..."

    echo -e "\n${CYAN}=== REDIS PERSISTENCE ===${NC}"

    if command -v redis-cli &> /dev/null; then
        local persistence_info=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" INFO persistence 2>/dev/null || echo "")

        if [[ -n "${persistence_info}" ]]; then
            echo "Persistence status:"
            echo "${persistence_info}" | grep -E "^(rdb_|aof_)" | head -15

            # Check for long-running saves
            local last_save=$(echo "${persistence_info}" | grep "^last_save_time:" | cut -d':' -f2)
            echo "Last save time: ${last_save}"
        fi
    fi
}

# Main Redis monitoring function
monitor_redis() {
    log_info "Starting Redis performance monitoring..."

    monitor_redis_memory
    profile_redis_commands
    check_key_patterns
    measure_persistence

    log_success "Redis monitoring complete"
}

# ===============================================================================
# SECTION 5: SYSTEM PERFORMANCE MONITORING
# ===============================================================================

# Monitor CPU usage per process
monitor_cpu_usage() {
    log_info "Monitoring CPU usage..."

    echo -e "\n${CYAN}=== CPU USAGE ===${NC}"

    # Overall CPU
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        local cpu_info=$(top -bn1 | grep "Cpu(s)" | sed 's/.*, *\([0-9.]*\)%* id.*/\1/')
        local cpu_usage=$(echo "100 - $cpu_info" | bc)
        echo "Overall CPU usage: ${cpu_usage}%"

        if (( $(echo "${cpu_usage} > ${CPU_THRESHOLD}" | bc -l) )); then
            alert "WARNING" "CPU usage at ${cpu_usage}%"
        fi

        # Top processes
        echo ""
        echo "Top CPU consuming processes:"
        ps aux --sort=-%cpu | head -6 | tail -5
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "System CPU usage:"
        ps aux --sort=-%cpu | head -6 | tail -5
    fi
}

# Monitor memory usage
monitor_memory_usage() {
    log_info "Monitoring memory usage..."

    echo -e "\n${CYAN}=== MEMORY USAGE ===${NC}"

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        local mem_info=$(free | grep Mem)
        local total=$(echo "$mem_info" | awk '{print $2}')
        local used=$(echo "$mem_info" | awk '{print $3}')
        local mem_percent=$(echo "scale=1; $used * 100 / $total" | bc)

        echo "Total: $(format_bytes $total)"
        echo "Used: $(format_bytes $used)"
        echo "Usage: ${mem_percent}%"

        if (( $(echo "${mem_percent} > ${MEM_THRESHOLD}" | bc -l) )); then
            alert "WARNING" "Memory usage at ${mem_percent}%"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        local vm_info=$(vm_stat | grep "Pages free")
        echo "Memory info (macOS):"
        vm_stat | head -10
    fi

    # Top memory consuming processes
    echo ""
    echo "Top memory consuming processes:"
    ps aux --sort=-%mem | head -6 | tail -5 || ps aux -m | head -6 | tail -5
}

# Check file descriptors
check_file_descriptors() {
    log_info "Checking file descriptors..."

    echo -e "\n${CYAN}=== FILE DESCRIPTORS ===${NC}"

    if [[ -d "/proc/self/fd" ]] || [[ -d "/proc/$$/fd" ]]; then
        local pid=$BASHPID
        local fd_count=$(ls -1 /proc/${pid}/fd 2>/dev/null | wc -l)

        echo "Process file descriptors: ${fd_count}"

        # Check system-wide limits
        if [[ -f "/proc/sys/fs/file-max" ]]; then
            local system_max=$(cat /proc/sys/fs/file-max)
            echo "System max file descriptors: ${system_max}"
        fi
    else
        echo "File descriptor information not available on this system"
    fi
}

# Monitor network I/O
monitor_network_io() {
    log_info "Monitoring network I/O..."

    echo -e "\n${CYAN}=== NETWORK I/O ===${NC}"

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v iftop &> /dev/null; then
            echo "Network traffic (top connections):"
            iftop -n -s 5 2>/dev/null | head -20 || echo "iftop requires root"
        else
            echo "Interface statistics:"
            ip -s link show 2>/dev/null | head -30 || ifconfig -v 2>/dev/null | head -30
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Interface statistics:"
        netstat -i | head -10
    fi
}

# Main system monitoring function
monitor_system() {
    log_info "Starting system performance monitoring..."

    monitor_cpu_usage
    monitor_memory_usage
    check_file_descriptors
    monitor_network_io

    log_success "System monitoring complete"
}

# ===============================================================================
# SECTION 6: DEPENDENCY PERFORMANCE MONITORING
# ===============================================================================

# Profile Supabase queries
profile_supabase_queries() {
    log_info "Profiling Supabase queries..."

    echo -e "\n${CYAN}=== SUPABASE QUERY PERFORMANCE ===${NC}"

    # This would typically connect to Supabase logging or query the pg_stat_statements
    # if running against a managed Supabase instance
    log_info "Supabase query profiling would query the managed instance logs"
    log_info "Configure SUPABASE_PROJECT_ID and SUPABASE_API_KEY to enable"
}

# Measure Gmail API latency
measure_gmail_api_latency() {
    log_info "Measuring Gmail API latency..."

    echo -e "\n${CYAN}=== GMAIL API LATENCY ===${NC}"

    if [[ -z "${GMAIL_ACCESS_TOKEN:-}" ]]; then
        log_warn "GMAIL_ACCESS_TOKEN not set, skipping Gmail latency test"
        return 0
    fi

    # Test Gmail API health
    local start=$(date +%s%N)
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer ${GMAIL_ACCESS_TOKEN}" \
        "${GMAIL_API_ENDPOINT}/users/me/profile" 2>/dev/null || echo "000")
    local end=$(date +%s%N)

    local latency=$(( (end - start) / 1000000 )) # Convert to ms

    if [[ "${response}" == "200" ]]; then
        echo "Gmail API latency: ${latency}ms"

        if [[ ${latency} -gt 500 ]]; then
            alert "WARNING" "Gmail API latency high: ${latency}ms"
        fi
    else
        log_warn "Gmail API health check failed with status ${response}"
    fi
}

# Check PubSub latency
check_pubsub_latency() {
    log_info "Checking Pub/Sub latency..."

    echo -e "\n${CYAN}=== PUBSUB LATENCY ===${NC}"

    if [[ -f "./logs/pubsub-events.log" ]]; then
        local -a latencies=()

        # Extract publish-to-receive times
        while read -r line; do
            if [[ $line =~ publish_time=([0-9.]+),receive_time=([0-9.]+) ]]; then
                local pub_time=${BASH_REMATCH[1]}
                local rec_time=${BASH_REMATCH[2]}
                local latency=$(echo "${rec_time} - ${pub_time}" | bc)
                latencies+=("${latency}")
            fi
        done < "./logs/pubsub-events.log"

        if [[ ${#latencies[@]} -gt 0 ]]; then
            local p50=$(calculate_percentile 50 "${latencies[@]}")
            local p95=$(calculate_percentile 95 "${latencies[@]}")
            local p99=$(calculate_percentile 99 "${latencies[@]}")

            printf "P50: %.2fms | P95: %.2fms | P99: %.2fms\n" "${p50}" "${p95}" "${p99}"
        fi
    else
        log_info "Pub/Sub event log not found"
    fi
}

# Monitor external services
monitor_external_services() {
    log_info "Monitoring external services..."

    echo -e "\n${CYAN}=== EXTERNAL SERVICES ===${NC}"

    local services=(
        "Gmail API:https://www.googleapis.com"
        "Supabase:https://api.supabase.co"
        "Google Cloud:https://www.googleapis.com"
    )

    for service in "${services[@]}"; do
        IFS=':' read -r name url <<< "$service"

        local start=$(date +%s%N)
        local response=$(curl -s -o /dev/null -w "%{http_code}" "${url}" 2>/dev/null || echo "000")
        local end=$(date +%s%N)

        local latency=$(( (end - start) / 1000000 ))

        if [[ "${response}" == "200" ]] || [[ "${response}" == "301" ]] || [[ "${response}" == "302" ]]; then
            printf "%-25s: ${GREEN}UP${NC} (${latency}ms)\n"
        else
            printf "%-25s: ${RED}DOWN${NC} (HTTP ${response})\n"
            alert "CRITICAL" "External service ${name} is down (HTTP ${response})"
        fi
    done
}

# Main dependency monitoring function
monitor_dependencies() {
    log_info "Starting external dependency monitoring..."

    profile_supabase_queries
    measure_gmail_api_latency
    check_pubsub_latency
    monitor_external_services

    log_success "Dependency monitoring complete"
}

# ===============================================================================
# SECTION 7: REPORTING & ANALYSIS
# ===============================================================================

# Generate daily performance report
generate_performance_report() {
    log_info "Generating performance report..."

    local report_file="${METRICS_DIR}/performance_report_$(date +%Y%m%d).txt"

    {
        echo "=========================================="
        echo "TASKFLOW NOTIFICATION SYSTEM"
        echo "DAILY PERFORMANCE REPORT"
        echo "Generated: $(date)"
        echo "=========================================="
        echo ""

        echo "SUMMARY"
        echo "------"

        # Count alerts
        if [[ -f "${ALERT_LOG}" ]]; then
            local critical_count=$(grep -c "\[CRITICAL\]" "${ALERT_LOG}" 2>/dev/null || echo "0")
            local warning_count=$(grep -c "\[WARNING\]" "${ALERT_LOG}" 2>/dev/null || echo "0")

            echo "Critical alerts: ${critical_count}"
            echo "Warning alerts: ${warning_count}"
            echo ""
        fi

        # Include metric summaries
        echo "METRICS SUMMARY"
        echo "---------------"

        for metric_file in "${METRICS_DIR}"/*.json; do
            if [[ -f "${metric_file}" ]]; then
                echo "$(basename ${metric_file}):"
                cat "${metric_file}" | jq . 2>/dev/null | head -10
                echo ""
            fi
        done

        # Recent errors
        echo "RECENT ALERTS"
        echo "-------------"
        if [[ -f "${ALERT_LOG}" ]]; then
            tail -20 "${ALERT_LOG}"
        fi

        echo ""
        echo "=========================================="

    } | tee "${report_file}"

    log_success "Performance report saved to ${report_file}"
}

# Trend analysis (week-over-week)
trend_analysis() {
    log_info "Analyzing performance trends..."

    echo -e "\n${CYAN}=== TREND ANALYSIS ===${NC}"
    echo "This feature would compare metrics from 7 days ago to today"

    local baseline=$(load_baseline)
    echo "Baseline metrics loaded: $(echo "${baseline}" | jq 'keys | length') metrics"
}

# Identify regressions
identify_regressions() {
    log_info "Identifying performance regressions..."

    echo -e "\n${CYAN}=== REGRESSION DETECTION ===${NC}"

    local baseline=$(load_baseline)

    # Compare current metrics to baseline
    for metric_file in "${METRICS_DIR}"/*.json; do
        if [[ -f "${metric_file}" ]]; then
            local metric_name=$(basename "${metric_file}" .json)
            local current=$(cat "${metric_file}" | jq '.data' 2>/dev/null || echo "{}")

            # This is a simplified check - real implementation would compare key metrics
            if [[ $(echo "${baseline}" | jq -r ".${metric_name}.p99_ms // 0") -gt 0 ]]; then
                local baseline_value=$(echo "${baseline}" | jq -r ".${metric_name}.p99_ms // 0")
                local current_value=$(echo "${current}" | jq -r ".p99_ms // 0")

                if (( $(echo "${current_value} > ${baseline_value} * 1.2" | bc -l) )); then
                    alert "WARNING" "Regression detected in ${metric_name}: ${baseline_value}ms -> ${current_value}ms"
                fi
            fi
        fi
    done
}

# Export metrics to CSV
export_metrics_csv() {
    log_info "Exporting metrics to CSV..."

    local csv_file="${METRICS_DIR}/metrics_export_$(date +%Y%m%d_%H%M%S).csv"

    {
        echo "Timestamp,Metric,Value,Unit,Status"

        for metric_file in "${METRICS_DIR}"/*.json; do
            if [[ -f "${metric_file}" ]]; then
                local metric_name=$(basename "${metric_file}" .json)
                local timestamp=$(jq -r '.timestamp' "${metric_file}" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")

                # Flatten JSON to CSV
                jq -r '.data | to_entries[] | "\(.key),\(.value)"' "${metric_file}" 2>/dev/null | while read -r row; do
                    echo "${timestamp},${metric_name},${row}"
                done
            fi
        done
    } > "${csv_file}"

    log_success "Metrics exported to ${csv_file}"
}

# Main reporting function
report() {
    log_info "Generating reports..."

    generate_performance_report
    trend_analysis
    identify_regressions
    export_metrics_csv

    log_success "Report generation complete"
}

# ===============================================================================
# SECTION 8: CONTINUOUS MONITORING
# ===============================================================================

# Start continuous monitoring
start_performance_watch() {
    local interval="${1:-60}" # Default to 60 seconds

    log_info "Starting continuous monitoring (${interval}s interval)"

    local iteration=0

    while true; do
        ((iteration++))

        echo ""
        echo "=========================================="
        echo "MONITORING CYCLE $iteration - $(date)"
        echo "=========================================="

        # Run all monitors
        monitor_database
        monitor_api
        monitor_email
        monitor_redis
        monitor_system
        monitor_dependencies

        log_info "Cycle $iteration complete, waiting ${interval}s..."
        sleep "${interval}"
    done
}

# Performance alert handler
performance_alert_handler() {
    log_info "Starting alert handler..."

    if [[ ! -f "${ALERT_LOG}" ]]; then
        touch "${ALERT_LOG}"
    fi

    local last_processed=0

    while true; do
        # Check for new alerts
        if [[ -f "${ALERT_LOG}" ]]; then
            local file_size=$(stat -f%z "${ALERT_LOG}" 2>/dev/null || stat -c%s "${ALERT_LOG}")

            if [[ ${file_size} -gt ${last_processed} ]]; then
                local new_alerts=$(tail -c $((file_size - last_processed)) "${ALERT_LOG}")

                # Process critical alerts
                if echo "${new_alerts}" | grep -q "\[CRITICAL\]"; then
                    log_error "Critical alert detected!"
                    # TODO: Send to Slack, PagerDuty, etc.
                fi

                last_processed=${file_size}
            fi
        fi

        sleep 10
    done
}

# Export metrics for Prometheus/Datadog
performance_metrics_exporter() {
    log_info "Exporting metrics for Prometheus/Datadog..."

    local export_file="${METRICS_DIR}/prometheus_metrics.txt"

    {
        echo "# HELP taskflow_notification_system Performance metrics"
        echo "# TYPE taskflow_notification_system gauge"

        # Database metrics
        echo "taskflow_db_connections gauge"

        # API metrics
        echo "taskflow_api_latency_p99 gauge"
        echo "taskflow_api_throughput gauge"

        # Email metrics
        echo "taskflow_email_latency_p99 gauge"
        echo "taskflow_email_success_rate gauge"

        # System metrics
        echo "taskflow_cpu_usage gauge"
        echo "taskflow_memory_usage gauge"

    } > "${export_file}"

    log_success "Metrics exported to ${export_file}"
}

# ===============================================================================
# SECTION 9: HELP & MAIN
# ===============================================================================

show_help() {
    cat << 'EOF'
TaskFlow Notification System - Performance Monitoring

Usage: ./8-performance-monitoring.sh [command] [options]

Commands:
    db              Monitor database performance
    api             Monitor API performance
    email           Monitor email delivery performance
    redis           Monitor Redis performance
    system          Monitor system performance
    deps            Monitor external dependencies
    report          Generate performance reports
    watch [SEC]     Start continuous monitoring (default 60s interval)
    alerts          Start alert handler
    export          Export metrics for Prometheus/Datadog
    all             Run all monitoring checks
    help            Show this help message

Configuration via Environment Variables:
    SLOW_QUERY_MS           Slow query threshold (default: 100ms)
    SLOW_API_MS             Slow API threshold (default: 500ms)
    SLOW_EMAIL_MS           Slow email threshold (default: 2000ms)
    SLOW_REDIS_MS           Slow Redis threshold (default: 10ms)
    CPU_THRESHOLD           CPU warning threshold (default: 80%)
    MEM_THRESHOLD           Memory warning threshold (default: 85%)
    MAX_CONNECTIONS         Max DB connections (default: 100)

    DB_HOST                 Database host (default: localhost)
    DB_PORT                 Database port (default: 5432)
    DB_NAME                 Database name (default: taskflow)
    DB_USER                 Database user (default: postgres)

    REDIS_HOST              Redis host (default: localhost)
    REDIS_PORT              Redis port (default: 6379)

    API_BASE_URL            API base URL (default: http://localhost:3000)
    GMAIL_API_ENDPOINT      Gmail API endpoint
    GMAIL_ACCESS_TOKEN      Gmail API access token

Examples:
    # Monitor database with custom threshold
    SLOW_QUERY_MS=50 ./8-performance-monitoring.sh db

    # Run continuous monitoring every 30 seconds
    ./8-performance-monitoring.sh watch 30

    # Generate performance report
    ./8-performance-monitoring.sh report

    # Run all monitors once
    ./8-performance-monitoring.sh all

Output:
    - Color-coded console output for easy reading
    - JSON metrics exported to metrics/
    - Alert log at monitoring-logs/alerts.log
    - Daily reports at metrics/performance_report_YYYYMMDD.txt

EOF
}

# Main dispatcher
main() {
    local command="${1:-all}"

    case "${command}" in
        db)
            monitor_database
            ;;
        api)
            shift || true
            monitor_api "$@"
            ;;
        email)
            monitor_email
            ;;
        redis)
            monitor_redis
            ;;
        system)
            monitor_system
            ;;
        deps|dependencies)
            monitor_dependencies
            ;;
        report)
            report
            ;;
        watch)
            start_performance_watch "${2:-60}"
            ;;
        alerts)
            performance_alert_handler
            ;;
        export)
            performance_metrics_exporter
            ;;
        all)
            monitor_database
            monitor_api
            monitor_email
            monitor_redis
            monitor_system
            monitor_dependencies
            report
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: ${command}"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
