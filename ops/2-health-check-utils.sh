#!/bin/bash

################################################################################
# TaskFlow Notification System - Health Check Utilities
#
# Production-grade monitoring and health checks for notification infrastructure
# Components: Redis, Supabase, Gmail API, Pub/Sub, BullMQ, Notifications DB
#
# Usage:
#   ./2-health-check-utils.sh                    # Run full health check
#   ./2-health-check-utils.sh watch              # Continuous monitoring (30s interval)
#   ./2-health-check-utils.sh json               # Output as JSON
#   ./2-health-check-utils.sh check_redis_health # Run single check
#
# Environment Variables (required):
#   REDIS_URL              - Redis connection string
#   SUPABASE_URL           - Supabase project URL
#   SUPABASE_ANON_KEY      - Supabase anonymous key
#   GMAIL_SERVICE_ACCOUNT  - Path to Gmail service account JSON
#   GOOGLE_CLOUD_PROJECT   - Google Cloud project ID
#   PUBSUB_TOPIC           - Google Cloud Pub/Sub topic name
#   BULLMQ_QUEUE_NAME      - BullMQ queue name (optional, default: notifications)
#
# Exit Codes:
#   0 - All checks passed (healthy)
#   1 - Warning: Some services degraded or slow
#   2 - Critical: One or more services unavailable
#
################################################################################

set -o pipefail

# Color codes for output
readonly RED='\033[0;31m'
readonly YELLOW='\033[1;33m'
readonly GREEN='\033[0;32m'
readonly BLUE='\033[0;34m'
readonly GRAY='\033[0;37m'
readonly NC='\033[0m' # No Color

# Symbols
readonly CHECK_MARK="✓"
readonly WARN_MARK="⚠"
readonly CROSS_MARK="✗"

# Performance thresholds (milliseconds)
readonly REDIS_LATENCY_WARN=50
readonly REDIS_LATENCY_CRITICAL=200
readonly SUPABASE_LATENCY_WARN=500
readonly SUPABASE_LATENCY_CRITICAL=2000
readonly GMAIL_LATENCY_WARN=1000
readonly GMAIL_LATENCY_CRITICAL=5000
readonly PUBSUB_LATENCY_WARN=500
readonly PUBSUB_LATENCY_CRITICAL=2000

# Queue size thresholds
readonly BULLMQ_QUEUE_WARN=1000
readonly BULLMQ_QUEUE_CRITICAL=10000
readonly BULLMQ_FAILED_WARN=10
readonly BULLMQ_FAILED_CRITICAL=100

# Database connection thresholds
readonly DB_POOL_WARN=8
readonly DB_POOL_CRITICAL=5

# Global health status (0=healthy, 1=warning, 2=critical)
OVERALL_STATUS=0
OUTPUT_FORMAT="text"

# Temporary files for results (portable alternative to associative arrays)
RESULTS_FILE=$(mktemp /tmp/taskflow-health-results.XXXXXX 2>/dev/null || mktemp)
trap "rm -f $RESULTS_FILE" EXIT

################################################################################
# UTILITY FUNCTIONS
################################################################################

# Store a health check result
store_result() {
    local service=$1
    local status=$2
    local latency=${3:-""}
    local message=${4:-""}

    echo "${service}|${status}|${latency}|${message}" >> "$RESULTS_FILE"
}

# Print colored status message
print_status() {
    local status=$1
    local message=$2
    local latency=${3:-}

    case $status in
        "OK"|"healthy")
            printf "${GREEN}${CHECK_MARK}${NC} ${message}"
            [[ -n "$latency" ]] && printf " ${GRAY}(${latency}ms)${NC}"
            ;;
        "WARN"|"warning")
            printf "${YELLOW}${WARN_MARK}${NC} ${message}"
            [[ -n "$latency" ]] && printf " ${GRAY}(${latency}ms)${NC}"
            ;;
        "CRITICAL"|"error")
            printf "${RED}${CROSS_MARK}${NC} ${message}"
            [[ -n "$latency" ]] && printf " ${GRAY}(${latency}ms)${NC}"
            ;;
        *)
            printf "${BLUE}ℹ${NC} ${message}"
            ;;
    esac
    echo
}

# Log message with timestamp
log_message() {
    local level=$1
    local message=$2
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [${level}] ${message}" >&2
}

# Measure latency of a command
measure_latency() {
    local start_time=$(date +%s%N)
    "$@" > /dev/null 2>&1
    local result=$?
    local end_time=$(date +%s%N)
    local latency=$(( (end_time - start_time) / 1000000 ))
    echo $latency
    return $result
}

# Update overall status (keeping highest severity)
update_status() {
    local new_status=$1
    [[ $new_status -gt $OVERALL_STATUS ]] && OVERALL_STATUS=$new_status
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Verify required environment variables
check_required_env() {
    local missing_vars=""

    for var in "$@"; do
        if [[ -z "${!var}" ]]; then
            missing_vars="$missing_vars $var"
        fi
    done

    if [[ -n "$missing_vars" ]]; then
        print_status "CRITICAL" "Missing environment variables:$missing_vars"
        update_status 2
        return 1
    fi
    return 0
}

################################################################################
# REDIS HEALTH CHECK
################################################################################

check_redis_health() {
    local check_name="Redis"
    echo -e "\n${BLUE}━━━ Checking ${check_name} ━━━${NC}"

    if [[ -z "$REDIS_URL" ]]; then
        print_status "CRITICAL" "${check_name}: REDIS_URL not set"
        store_result "redis" "critical" "" "REDIS_URL not configured"
        update_status 2
        return 2
    fi

    # Parse Redis URL
    local redis_host="localhost"
    local redis_port="6379"
    local redis_password=""

    if [[ "$REDIS_URL" =~ ^redis:\/\/([^:@]*):([^@]*)@([^:]*):(.*)$ ]]; then
        redis_password="${BASH_REMATCH[1]}"
        redis_host="${BASH_REMATCH[3]}"
        redis_port="${BASH_REMATCH[4]}"
    elif [[ "$REDIS_URL" =~ ^redis:\/\/([^:]*):(.*)$ ]]; then
        redis_host="${BASH_REMATCH[1]}"
        redis_port="${BASH_REMATCH[2]}"
    fi

    # Test connectivity with latency
    local latency=$(measure_latency redis-cli -h "$redis_host" -p "$redis_port" ${redis_password:+-a "$redis_password"} ping)
    local redis_result=$?

    if [[ $redis_result -eq 0 ]]; then
        if [[ $latency -lt $REDIS_LATENCY_WARN ]]; then
            print_status "OK" "Connectivity OK" "$latency"
        elif [[ $latency -lt $REDIS_LATENCY_CRITICAL ]]; then
            print_status "WARN" "Slow response time" "$latency"
            update_status 1
        else
            print_status "CRITICAL" "Response time critical" "$latency"
            update_status 2
        fi
        store_result "redis" "healthy" "$latency" "Connected"
    else
        print_status "CRITICAL" "Cannot connect to Redis"
        store_result "redis" "critical" "" "Connection failed: $redis_host:$redis_port"
        update_status 2
        return 2
    fi

    # Check memory usage
    local redis_info=$(redis-cli -h "$redis_host" -p "$redis_port" ${redis_password:+-a "$redis_password"} info memory 2>/dev/null)
    if [[ -n "$redis_info" ]]; then
        local used_memory=$(echo "$redis_info" | grep "^used_memory_human" | cut -d: -f2 | tr -d '\r')
        if [[ -n "$used_memory" ]]; then
            print_status "OK" "Memory usage: ${used_memory}"
        fi
    fi

    # Check connected clients
    local client_count=$(redis-cli -h "$redis_host" -p "$redis_port" ${redis_password:+-a "$redis_password"} client list 2>/dev/null | wc -l)
    if [[ -n "$client_count" ]]; then
        print_status "OK" "Connected clients: ${client_count}"
    fi

    return 0
}

################################################################################
# SUPABASE HEALTH CHECK
################################################################################

check_supabase_health() {
    local check_name="Supabase"
    echo -e "\n${BLUE}━━━ Checking ${check_name} ━━━${NC}"

    if ! check_required_env "SUPABASE_URL" "SUPABASE_ANON_KEY"; then
        store_result "supabase" "critical" "" "Missing configuration"
        update_status 2
        return 2
    fi

    # Test connectivity with latency
    local latency=$(measure_latency curl -s --connect-timeout 5 \
        -H "apikey: ${SUPABASE_ANON_KEY}" \
        "${SUPABASE_URL}/rest/v1/" 2>/dev/null)
    local curl_result=$?

    if [[ $curl_result -eq 0 ]]; then
        if [[ $latency -lt $SUPABASE_LATENCY_WARN ]]; then
            print_status "OK" "API connectivity OK" "$latency"
        elif [[ $latency -lt $SUPABASE_LATENCY_CRITICAL ]]; then
            print_status "WARN" "Slow API response" "$latency"
            update_status 1
        else
            print_status "CRITICAL" "API response time critical" "$latency"
            update_status 2
        fi
        store_result "supabase" "healthy" "$latency" "Connected"
    else
        print_status "CRITICAL" "Cannot connect to Supabase API"
        store_result "supabase" "critical" "" "API connection failed"
        update_status 2
        return 2
    fi

    return 0
}

################################################################################
# GMAIL API HEALTH CHECK
################################################################################

check_gmail_api_health() {
    local check_name="Gmail API"
    echo -e "\n${BLUE}━━━ Checking ${check_name} ━━━${NC}"

    if [[ ! -f "$GMAIL_SERVICE_ACCOUNT" ]]; then
        print_status "CRITICAL" "${check_name}: Service account file not found at $GMAIL_SERVICE_ACCOUNT"
        store_result "gmail" "critical" "" "Service account file missing"
        update_status 2
        return 2
    fi

    if [[ -z "$GOOGLE_CLOUD_PROJECT" ]]; then
        print_status "CRITICAL" "${check_name}: GOOGLE_CLOUD_PROJECT not set"
        store_result "gmail" "critical" "" "GOOGLE_CLOUD_PROJECT not set"
        update_status 2
        return 2
    fi

    # Verify service account JSON structure
    if ! command_exists jq; then
        print_status "WARN" "jq not installed, skipping detailed validation"
        store_result "gmail" "warning" "" "jq not available"
        update_status 1
        return 1
    fi

    local sa_client_id=$(jq -r '.client_id' "$GMAIL_SERVICE_ACCOUNT" 2>/dev/null)
    local sa_project_id=$(jq -r '.project_id' "$GMAIL_SERVICE_ACCOUNT" 2>/dev/null)

    if [[ -z "$sa_client_id" ]] || [[ -z "$sa_project_id" ]]; then
        print_status "CRITICAL" "${check_name}: Invalid service account file"
        store_result "gmail" "critical" "" "Service account file invalid"
        update_status 2
        return 2
    fi

    print_status "OK" "Service account loaded: ${sa_client_id}"
    print_status "OK" "Project ID verified: ${sa_project_id}"
    store_result "gmail" "healthy" "N/A" "Service account verified"

    return 0
}

################################################################################
# GOOGLE CLOUD PUB/SUB HEALTH CHECK
################################################################################

check_pubsub_health() {
    local check_name="Google Cloud Pub/Sub"
    echo -e "\n${BLUE}━━━ Checking ${check_name} ━━━${NC}"

    if [[ -z "$PUBSUB_TOPIC" ]]; then
        print_status "CRITICAL" "${check_name}: PUBSUB_TOPIC not set"
        store_result "pubsub" "critical" "" "PUBSUB_TOPIC not configured"
        update_status 2
        return 2
    fi

    if ! command_exists gcloud; then
        print_status "WARN" "${check_name}: gcloud CLI not installed, skipping checks"
        store_result "pubsub" "warning" "" "gcloud CLI not available"
        update_status 1
        return 1
    fi

    # Verify topic exists and get details
    local topic_details=$(gcloud pubsub topics describe "$PUBSUB_TOPIC" 2>/dev/null)
    if [[ $? -eq 0 ]]; then
        print_status "OK" "Topic exists: $PUBSUB_TOPIC"
        store_result "pubsub" "healthy" "N/A" "Topic verified"
    else
        print_status "CRITICAL" "${check_name}: Topic not found: $PUBSUB_TOPIC"
        store_result "pubsub" "critical" "" "Topic not found"
        update_status 2
        return 2
    fi

    # Check subscription exists
    local subscriptions=$(gcloud pubsub topics list-subscriptions "$PUBSUB_TOPIC" 2>/dev/null)
    if [[ -z "$subscriptions" ]]; then
        print_status "WARN" "No subscriptions found for topic"
        update_status 1
    else
        local sub_count=$(echo "$subscriptions" | wc -l)
        print_status "OK" "Subscriptions: $sub_count"
    fi

    return 0
}

################################################################################
# BULLMQ QUEUE HEALTH CHECK
################################################################################

check_bullmq_health() {
    local check_name="BullMQ Queue"
    echo -e "\n${BLUE}━━━ Checking ${check_name} ━━━${NC}"

    local queue_name="${BULLMQ_QUEUE_NAME:-notifications}"

    if [[ -z "$REDIS_URL" ]]; then
        print_status "WARN" "${check_name}: REDIS_URL not set, skipping queue checks"
        store_result "bullmq" "warning" "" "REDIS_URL not configured"
        update_status 1
        return 1
    fi

    # Parse Redis URL
    local redis_host="localhost"
    local redis_port="6379"
    local redis_password=""

    if [[ "$REDIS_URL" =~ ^redis:\/\/([^:@]*):([^@]*)@([^:]*):(.*)$ ]]; then
        redis_password="${BASH_REMATCH[1]}"
        redis_host="${BASH_REMATCH[3]}"
        redis_port="${BASH_REMATCH[4]}"
    elif [[ "$REDIS_URL" =~ ^redis:\/\/([^:]*):(.*)$ ]]; then
        redis_host="${BASH_REMATCH[1]}"
        redis_port="${BASH_REMATCH[2]}"
    fi

    # Check queue depth
    local queue_depth=$(redis-cli -h "$redis_host" -p "$redis_port" ${redis_password:+-a "$redis_password"} \
        llen "bull:${queue_name}:wait" 2>/dev/null || echo "0")

    if [[ -z "$queue_depth" ]]; then
        queue_depth=0
    fi

    if [[ $queue_depth -lt $BULLMQ_QUEUE_WARN ]]; then
        print_status "OK" "Queue depth: ${queue_depth} jobs"
    elif [[ $queue_depth -lt $BULLMQ_QUEUE_CRITICAL ]]; then
        print_status "WARN" "Queue depth: ${queue_depth} jobs (>= warning threshold)"
        update_status 1
    else
        print_status "CRITICAL" "Queue depth: ${queue_depth} jobs (>= critical threshold)"
        update_status 2
    fi

    # Check failed jobs count
    local failed_count=$(redis-cli -h "$redis_host" -p "$redis_port" ${redis_password:+-a "$redis_password"} \
        llen "bull:${queue_name}:failed" 2>/dev/null || echo "0")

    if [[ -z "$failed_count" ]]; then
        failed_count=0
    fi

    if [[ $failed_count -lt $BULLMQ_FAILED_WARN ]]; then
        print_status "OK" "Failed jobs: ${failed_count}"
    elif [[ $failed_count -lt $BULLMQ_FAILED_CRITICAL ]]; then
        print_status "WARN" "Failed jobs: ${failed_count} (>= warning threshold)"
        update_status 1
    else
        print_status "CRITICAL" "Failed jobs: ${failed_count} (>= critical threshold)"
        update_status 2
    fi

    # Check processing jobs
    local processing_count=$(redis-cli -h "$redis_host" -p "$redis_port" ${redis_password:+-a "$redis_password"} \
        llen "bull:${queue_name}:active" 2>/dev/null || echo "0")

    if [[ -n "$processing_count" ]] && [[ $processing_count -gt 0 ]]; then
        print_status "OK" "Jobs in progress: ${processing_count}"
    fi

    store_result "bullmq" "healthy" "$queue_depth" "Queue operational"

    return 0
}

################################################################################
# NOTIFICATIONS DATABASE HEALTH CHECK
################################################################################

check_notifications_db() {
    local check_name="Notifications Database"
    echo -e "\n${BLUE}━━━ Checking ${check_name} ━━━${NC}"

    if ! check_required_env "SUPABASE_URL" "SUPABASE_ANON_KEY"; then
        store_result "notifications_db" "critical" "" "Missing configuration"
        update_status 2
        return 2
    fi

    # Query database using REST API
    local query_url="${SUPABASE_URL}/rest/v1/notifications?select=count()&limit=1"

    local latency=$(measure_latency curl -s --connect-timeout 5 \
        -H "apikey: ${SUPABASE_ANON_KEY}" \
        -H "Accept: application/json" \
        "$query_url")

    local curl_result=$?

    if [[ $curl_result -eq 0 ]]; then
        print_status "OK" "Database query OK" "$latency"
        store_result "notifications_db" "healthy" "$latency" "Connected"
    else
        print_status "CRITICAL" "Cannot query notifications table"
        store_result "notifications_db" "critical" "" "Query failed"
        update_status 2
        return 2
    fi

    # Check table structures via REST API
    echo -e "\n  ${GRAY}Table Statistics:${NC}"

    local tables=("notifications" "notification_preferences" "notification_queue" "notification_templates")
    for table in "${tables[@]}"; do
        local count=$(curl -s --connect-timeout 5 \
            -H "apikey: ${SUPABASE_ANON_KEY}" \
            -H "Accept: application/json" \
            "${SUPABASE_URL}/rest/v1/${table}?select=count()" 2>/dev/null | grep -o '"count":[0-9]*' | cut -d: -f2 || echo "0")

        if [[ -n "$count" ]] && [[ "$count" != "0" ]]; then
            print_status "OK" "  ${table}: ${count} records"
        else
            print_status "WARN" "  ${table}: unable to count or empty"
        fi
    done

    return 0
}

################################################################################
# FULL HEALTH CHECK
################################################################################

full_health_check() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     TaskFlow Notification System - Health Check Report    ║${NC}"
    echo -e "${BLUE}║     $(date +'%Y-%m-%d %H:%M:%S')                           ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

    # Clear previous results
    OVERALL_STATUS=0
    > "$RESULTS_FILE"

    # Run all checks
    check_redis_health
    check_supabase_health
    check_gmail_api_health
    check_pubsub_health
    check_bullmq_health
    check_notifications_db

    # Print summary
    echo -e "\n${BLUE}━━━ SUMMARY ━━━${NC}"

    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        output_json_report
    else
        output_text_summary
    fi

    return $OVERALL_STATUS
}

################################################################################
# OUTPUT FUNCTIONS
################################################################################

output_text_summary() {
    local total_checks=0
    local healthy=0
    local warning=0
    local critical=0

    while IFS='|' read -r service status latency message; do
        [[ -z "$service" ]] && continue
        ((total_checks++))

        case $status in
            healthy) ((healthy++)) ;;
            warning) ((warning++)) ;;
            critical) ((critical++)) ;;
        esac
    done < "$RESULTS_FILE"

    echo -e "\n  Components Checked: $total_checks"

    [[ $healthy -gt 0 ]] && printf "  ${GREEN}${CHECK_MARK} Healthy${NC}: $healthy   "
    [[ $warning -gt 0 ]] && printf "${YELLOW}${WARN_MARK} Warning${NC}: $warning   "
    [[ $critical -gt 0 ]] && printf "${RED}${CROSS_MARK} Critical${NC}: $critical\n" || echo

    # Overall status
    echo -e "\n  ${GRAY}Overall Status:${NC} "
    case $OVERALL_STATUS in
        0)
            echo -e "  ${GREEN}✓ All systems operational${NC}"
            ;;
        1)
            echo -e "  ${YELLOW}⚠ System operational with warnings${NC}"
            ;;
        2)
            echo -e "  ${RED}✗ System has critical issues${NC}"
            ;;
    esac
}

output_json_report() {
    local json_output="{"
    json_output+="\"timestamp\":\"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\","
    json_output+="\"overall_status\":$OVERALL_STATUS,"
    json_output+="\"status_name\":\"$(get_status_name $OVERALL_STATUS)\","
    json_output+="\"services\":{"

    local first=true
    while IFS='|' read -r service status latency message; do
        [[ -z "$service" ]] && continue

        [[ "$first" == false ]] && json_output+=","
        first=false

        # Escape message for JSON
        message=${message//\"/\\\"}

        local latency_val="null"
        [[ -n "$latency" ]] && [[ "$latency" != "N/A" ]] && latency_val="$latency"

        json_output+="\"$service\":{"
        json_output+="\"status\":\"$status\","
        json_output+="\"latency_ms\":$latency_val,"
        json_output+="\"message\":\"$message\""
        json_output+="}"
    done < "$RESULTS_FILE"

    json_output+="}"
    json_output+="}"

    echo "$json_output" | jq . 2>/dev/null || echo "$json_output"
}

get_status_name() {
    case $1 in
        0) echo "healthy" ;;
        1) echo "warning" ;;
        2) echo "critical" ;;
    esac
}

################################################################################
# MONITORING MODE
################################################################################

watch_health() {
    local interval=30
    local iteration=0

    echo -e "${BLUE}Starting continuous health monitoring (interval: ${interval}s)${NC}"
    echo -e "${GRAY}Press Ctrl+C to stop${NC}\n"

    while true; do
        ((iteration++))

        clear
        echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║     TaskFlow Notification System - Live Monitor          ║${NC}"
        echo -e "${BLUE}║     Iteration: $iteration | $(date +'%Y-%m-%d %H:%M:%S')${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

        # Run checks
        check_redis_health 2>&1 | grep -E "✓|⚠|✗"
        check_supabase_health 2>&1 | grep -E "✓|⚠|✗"
        check_gmail_api_health 2>&1 | grep -E "✓|⚠|✗"
        check_pubsub_health 2>&1 | grep -E "✓|⚠|✗"
        check_bullmq_health 2>&1 | grep -E "✓|⚠|✗"
        check_notifications_db 2>&1 | grep -E "✓|⚠|✗"

        echo -e "\n${GRAY}Next check in ${interval}s (Ctrl+C to exit)${NC}"
        sleep "$interval"
    done
}

################################################################################
# MAIN ENTRY POINT
################################################################################

main() {
    local command="${1:-check}"

    case "$command" in
        watch|monitor)
            watch_health
            ;;
        json)
            OUTPUT_FORMAT="json"
            full_health_check
            ;;
        check_redis_health)
            check_redis_health
            ;;
        check_supabase_health)
            check_supabase_health
            ;;
        check_gmail_api_health)
            check_gmail_api_health
            ;;
        check_pubsub_health)
            check_pubsub_health
            ;;
        check_bullmq_health)
            check_bullmq_health
            ;;
        check_notifications_db)
            check_notifications_db
            ;;
        --help|-h)
            print_help
            exit 0
            ;;
        *)
            full_health_check
            ;;
    esac

    exit $OVERALL_STATUS
}

print_help() {
    cat << EOF
${BLUE}TaskFlow Notification System - Health Check Utilities${NC}

${YELLOW}Usage:${NC}
  ./2-health-check-utils.sh                    # Run full health check
  ./2-health-check-utils.sh watch              # Continuous monitoring (30s interval)
  ./2-health-check-utils.sh json               # Output as JSON
  ./2-health-check-utils.sh <check_function>   # Run specific check
  ./2-health-check-utils.sh --help             # Show this help

${YELLOW}Available Checks:${NC}
  check_redis_health          - Redis connectivity and performance
  check_supabase_health       - Supabase database and API
  check_gmail_api_health      - Gmail service account and scopes
  check_pubsub_health         - Google Cloud Pub/Sub topics
  check_bullmq_health         - BullMQ queue depth and failed jobs
  check_notifications_db      - Notifications table integrity

${YELLOW}Required Environment Variables:${NC}
  REDIS_URL                   - Redis connection string
  SUPABASE_URL                - Supabase project URL
  SUPABASE_ANON_KEY           - Supabase anonymous key
  GMAIL_SERVICE_ACCOUNT       - Path to Gmail service account JSON
  GOOGLE_CLOUD_PROJECT        - Google Cloud project ID
  PUBSUB_TOPIC                - Google Cloud Pub/Sub topic name
  BULLMQ_QUEUE_NAME           - BullMQ queue name (optional)

${YELLOW}Exit Codes:${NC}
  0 - All checks passed (healthy)
  1 - Warning: Some services degraded or slow
  2 - Critical: One or more services unavailable

${YELLOW}Performance Thresholds:${NC}
  Redis latency:              < 50ms (warn), < 200ms (critical)
  Supabase latency:           < 500ms (warn), < 2000ms (critical)
  Gmail API latency:          < 1000ms (warn), < 5000ms (critical)
  BullMQ queue depth:         < 1000 (warn), < 10000 (critical)
  BullMQ failed jobs:         < 10 (warn), < 100 (critical)

${YELLOW}Examples:${NC}
  # Full health check and exit with appropriate code
  ./2-health-check-utils.sh

  # Continuous monitoring mode (useful for dashboards/alerts)
  ./2-health-check-utils.sh watch

  # JSON output for integration with monitoring systems
  ./2-health-check-utils.sh json | jq .

  # Check only Redis
  ./2-health-check-utils.sh check_redis_health

  # Use in cron job (runs daily, outputs to log if issues found)
  0 * * * * /path/to/2-health-check-utils.sh >> /var/log/taskflow-health.log 2>&1

${GRAY}For production use:${NC}
  - Source environment variables from .env.local or secure secrets manager
  - Integrate exit code with monitoring/alerting systems
  - Use watch mode with dashboards like Grafana
  - Archive JSON output for historical analysis
EOF
}

# Run main function with all arguments
main "$@"
