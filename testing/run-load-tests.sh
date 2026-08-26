#!/bin/bash

# TaskFlow Load Testing Runner Script
# ===========================================================================
# Convenience script for running K6 load tests with validation and reporting
# ===========================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
K6_SCRIPT="${SCRIPT_DIR}/load-test.js"
RESULTS_DIR="${SCRIPT_DIR}/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${RESULTS_DIR}/load-test_${TIMESTAMP}.log"

# Default values
BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
TEST_SCENARIO="${TEST_SCENARIO:-baseline}"
VERBOSE="${VERBOSE:-false}"
EXPORT_FORMAT="${EXPORT_FORMAT:-json}"
DRY_RUN="${DRY_RUN:-false}"

# ===========================================================================
# Helper Functions
# ===========================================================================

print_header() {
  echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║ TaskFlow Load Testing Runner${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

print_section() {
  echo -e "${BLUE}➜ $1${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_info() {
  echo "  $1"
}

# ===========================================================================
# Validation Functions
# ===========================================================================

check_prerequisites() {
  print_section "Checking Prerequisites"

  # Check K6 is installed
  if ! command -v k6 &> /dev/null; then
    print_error "K6 is not installed"
    echo "Install from: https://k6.io/docs/getting-started/installation/"
    exit 1
  fi
  print_success "K6 found: $(k6 version)"

  # Check K6 script exists
  if [ ! -f "$K6_SCRIPT" ]; then
    print_error "K6 script not found: $K6_SCRIPT"
    exit 1
  fi
  print_success "K6 script found"

  # Check BASE_URL is reachable
  if [ "$DRY_RUN" != "true" ]; then
    print_info "Checking service health..."
    if ! curl -s -m 5 "$BASE_URL/api/health" > /dev/null 2>&1; then
      print_warning "Service at $BASE_URL may not be accessible"
      read -p "Continue anyway? (y/n) " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
      fi
    else
      print_success "Service is healthy"
    fi
  fi

  # Validate AUTH_TOKEN (with helpful setup guide)
  if [ -z "$AUTH_TOKEN" ]; then
    print_error "AUTH_TOKEN environment variable is not set"
    echo ""
    echo "  To generate test credentials:"
    echo "  1. Follow docs/LOAD_TEST_SETUP.md"
    echo "  2. Create test users in Supabase"
    echo "  3. Generate JWT token:"
    echo "     node scripts/generate-test-tokens.js"
    echo "  4. Export token:"
    echo "     export AUTH_TOKEN='Bearer <your_token>'"
    echo ""
    exit 1
  fi
  print_success "AUTH_TOKEN is set (${AUTH_TOKEN:0:20}...)"

  # Create results directory
  mkdir -p "$RESULTS_DIR"
  print_success "Results directory ready: $RESULTS_DIR"
}

validate_scenario() {
  local scenario=$1
  local valid_scenarios=("baseline" "ramp_up" "spike" "stress" "endurance" "email_delivery")

  for valid in "${valid_scenarios[@]}"; do
    if [ "$scenario" = "$valid" ]; then
      return 0
    fi
  done

  print_error "Invalid scenario: $scenario"
  echo "Valid scenarios:"
  for scenario in "${valid_scenarios[@]}"; do
    echo "  - $scenario"
  done
  exit 1
}

# ===========================================================================
# Execution Functions
# ===========================================================================

build_k6_command() {
  local cmd="k6 run"

  # Add script
  cmd="$cmd $K6_SCRIPT"

  # Add environment variables
  cmd="K6_VUS=${K6_VUS:-} K6_DURATION=${K6_DURATION:-} $cmd"

  # Add output format
  if [ "$EXPORT_FORMAT" = "json" ]; then
    cmd="$cmd --out json=${RESULTS_DIR}/load-test_${TIMESTAMP}.json"
  elif [ "$EXPORT_FORMAT" = "csv" ]; then
    cmd="$cmd --out csv=${RESULTS_DIR}/load-test_${TIMESTAMP}.csv"
  elif [ "$EXPORT_FORMAT" = "html" ]; then
    cmd="$cmd --out html=${RESULTS_DIR}/load-test_${TIMESTAMP}.html"
  fi

  # Add verbosity
  if [ "$VERBOSE" = "true" ]; then
    cmd="$cmd -v"
  fi

  echo "$cmd"
}

run_load_test() {
  print_section "Starting Load Test: $TEST_SCENARIO"
  echo "  Duration: As configured in scenario"
  echo "  Target URL: $BASE_URL"
  echo "  VUs: As configured in scenario"
  echo ""

  # Build environment
  export BASE_URL
  export AUTH_TOKEN
  export TEST_USER_ID="${TEST_USER_ID:-550e8400-e29b-41d4-a716-446655440000}"
  export ORGANIZATION_ID="${ORGANIZATION_ID:-660e8400-e29b-41d4-a716-446655440000}"

  # Build and display command
  K6_CMD=$(build_k6_command)
  print_info "Command: $K6_CMD"
  echo ""

  # Run test
  if [ "$DRY_RUN" = "true" ]; then
    print_warning "DRY RUN MODE - Not actually executing test"
    echo "$K6_CMD"
    return 0
  fi

  # Execute K6 test
  eval "$K6_CMD" | tee -a "$LOG_FILE"
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    print_success "Load test completed successfully"
  else
    print_error "Load test failed with exit code $exit_code"
  fi

  return $exit_code
}

# ===========================================================================
# Analysis Functions
# ===========================================================================

analyze_results() {
  local result_file="${RESULTS_DIR}/load-test_${TIMESTAMP}.json"

  if [ ! -f "$result_file" ]; then
    print_warning "No results file found to analyze"
    return 1
  fi

  print_section "Analyzing Results"

  # Parse JSON and extract key metrics
  if command -v jq &> /dev/null; then
    print_info "Extracting metrics..."

    # Extract metrics
    local total_reqs=$(jq '.metrics.http_reqs.value' "$result_file" 2>/dev/null || echo "N/A")
    local failed_reqs=$(jq '.metrics.http_req_failed.value' "$result_file" 2>/dev/null || echo "N/A")
    local p95=$(jq '.metrics.http_req_duration.values."p(95)"' "$result_file" 2>/dev/null || echo "N/A")
    local p99=$(jq '.metrics.http_req_duration.values."p(99)"' "$result_file" 2>/dev/null || echo "N/A")

    echo ""
    echo -e "${BLUE}Key Metrics:${NC}"
    echo "  Total Requests: $total_reqs"
    echo "  Failed Requests: $failed_reqs"
    echo "  P95 Latency: ${p95}ms"
    echo "  P99 Latency: ${p99}ms"

    # Validate against SLAs
    validate_slas "$p95" "$p99" "$failed_reqs"
  else
    print_warning "jq not installed - skipping detailed analysis"
    print_info "Install jq for better analysis: brew install jq"
    echo ""
    print_info "Raw results available at: $result_file"
  fi
}

validate_slas() {
  local p95=$1
  local p99=$2
  local failed=$3

  print_section "SLA Validation"

  # P95 Latency
  if (( $(echo "$p95 < 500" | bc -l) )); then
    print_success "P95 Latency: ${p95}ms (< 500ms)"
  else
    print_warning "P95 Latency: ${p95}ms (>= 500ms) - EXCEEDS SLA"
  fi

  # P99 Latency
  if (( $(echo "$p99 < 1000" | bc -l) )); then
    print_success "P99 Latency: ${p99}ms (< 1000ms)"
  else
    print_warning "P99 Latency: ${p99}ms (>= 1000ms) - EXCEEDS SLA"
  fi

  # Error Rate
  if (( $(echo "$failed < 0.001" | bc -l) )); then
    print_success "Error Rate: ${failed} (< 0.1%)"
  else
    print_warning "Error Rate: ${failed} (>= 0.1%) - EXCEEDS SLA"
  fi

  echo ""
}

generate_report() {
  local report_file="${RESULTS_DIR}/report_${TIMESTAMP}.md"

  print_section "Generating Report"

  cat > "$report_file" << EOF
# Load Test Report

**Date:** $(date)
**Scenario:** $TEST_SCENARIO
**Target:** $BASE_URL

## Configuration

- Base URL: $BASE_URL
- Scenario: $TEST_SCENARIO
- Export Format: $EXPORT_FORMAT

## Results Location

- Log: $LOG_FILE
- Results: ${RESULTS_DIR}/load-test_${TIMESTAMP}.${EXPORT_FORMAT}
- Report: $report_file

## Next Steps

1. **Review detailed results** in the results directory
2. **Compare against SLAs** documented in 1-load-testing.yaml
3. **Identify bottlenecks** using the analysis guide
4. **Create issues** for any performance regressions
5. **Plan capacity** based on stress test results

## Resources

- Complete guide: LOAD_TESTING_README.md
- Test configuration: 1-load-testing.yaml
- K6 documentation: https://k6.io/docs/

---
Generated by load test runner on $(date)
EOF

  print_success "Report generated: $report_file"
}

# ===========================================================================
# Usage
# ===========================================================================

print_usage() {
  cat << EOF
${BLUE}TaskFlow Load Testing Runner${NC}

${BLUE}Usage:${NC}
  $0 [OPTIONS]

${BLUE}Options:${NC}
  -s, --scenario SCENARIO    Test scenario to run
                             (baseline, ramp_up, spike, stress, endurance, email_delivery)
                             Default: baseline

  -u, --url URL              Base URL of service to test
                             Default: http://localhost:3000

  -f, --format FORMAT        Export format (json, csv, html)
                             Default: json

  -v, --verbose              Enable verbose output

  -d, --dry-run              Show what would run without executing

  -h, --help                 Show this help message

${BLUE}Environment Variables:${NC}
  BASE_URL                   Service URL (default: http://localhost:3000)
  AUTH_TOKEN                 Bearer token for authentication (required)
  TEST_USER_ID               User ID for testing
  ORGANIZATION_ID            Organization ID for testing
  VERBOSE                    Enable verbose mode (true/false)
  DRY_RUN                    Show command without running (true/false)

${BLUE}Examples:${NC}
  # Run baseline test with defaults
  $0

  # Run stress test
  $0 -s stress

  # Run ramp-up test with CSV export
  $0 -s ramp_up -f csv

  # Run spike test against staging
  $0 -s spike -u https://staging.taskflow.app

  # Dry run to see what would execute
  $0 -s stress --dry-run

${BLUE}Quick Start:${NC}
  1. Set AUTH_TOKEN: export AUTH_TOKEN='Bearer <your_token>'
  2. Run baseline:   $0
  3. Check results:  open results/

EOF
}

# ===========================================================================
# Main
# ===========================================================================

main() {
  print_header

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      -s|--scenario)
        TEST_SCENARIO="$2"
        shift 2
        ;;
      -u|--url)
        BASE_URL="$2"
        shift 2
        ;;
      -f|--format)
        EXPORT_FORMAT="$2"
        shift 2
        ;;
      -v|--verbose)
        VERBOSE="true"
        shift
        ;;
      -d|--dry-run)
        DRY_RUN="true"
        shift
        ;;
      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        print_error "Unknown option: $1"
        print_usage
        exit 1
        ;;
    esac
  done

  # Validate scenario
  validate_scenario "$TEST_SCENARIO"

  # Check prerequisites
  check_prerequisites

  # Display configuration
  print_section "Configuration"
  print_info "Scenario: $TEST_SCENARIO"
  print_info "Base URL: $BASE_URL"
  print_info "Export Format: $EXPORT_FORMAT"
  print_info "Verbose: $VERBOSE"
  print_info "Results Directory: $RESULTS_DIR"
  echo ""

  # Run load test
  run_load_test
  TEST_RESULT=$?

  # Generate report
  if [ $TEST_RESULT -eq 0 ]; then
    analyze_results
    generate_report

    echo ""
    print_section "Load Test Complete"
    echo -e "${GREEN}✓ Test scenario '$TEST_SCENARIO' completed successfully${NC}"
    echo ""
    print_info "Results saved to: $RESULTS_DIR"
    print_info "View log: tail -f $LOG_FILE"
  else
    print_error "Load test failed"
    exit 1
  fi
}

# Run main
main "$@"
