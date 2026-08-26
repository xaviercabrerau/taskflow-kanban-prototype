// TaskFlow Notification System - K6 Load Testing Script
// ===========================================================================
// Production-Ready Load Testing Implementation
// ===========================================================================

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// ===========================================================================
// Custom Metrics Definition
// ===========================================================================

// Response time trends (in milliseconds)
const getPreferencesLatency = new Trend('get_preferences_latency');
const updatePreferencesLatency = new Trend('update_preferences_latency');
const getUsersLatency = new Trend('get_users_latency');
const healthCheckLatency = new Trend('health_check_latency');

// Error counters
const getPreferencesErrors = new Counter('get_preferences_errors');
const updatePreferencesErrors = new Counter('update_preferences_errors');
const getUsersErrors = new Counter('get_users_errors');
const healthCheckErrors = new Counter('health_check_errors');

// Success rates
const successRate = new Rate('success_rate');
const errorRate = new Rate('error_rate');

// Throughput gauge
const activeVUs = new Gauge('active_vus');

// Queue metrics
const queueDepth = new Gauge('queue_depth');
const emailsProcessed = new Counter('emails_processed');

// ===========================================================================
// Configuration
// ===========================================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'Bearer test-token';
const TEST_USER_ID = __ENV.TEST_USER_ID || '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = __ENV.ORGANIZATION_ID || '660e8400-e29b-41d4-a716-446655440000';

// HTTP client headers
const httpHeaders = {
  'Content-Type': 'application/json',
  'Authorization': AUTH_TOKEN,
  'User-Agent': 'K6LoadTest/1.0',
};

// ===========================================================================
// Test Stages / Scenarios
// ===========================================================================

export const options = {
  stages: [
    // Scenario selection via environment variable or default to baseline
    ...(loadTestScenario('baseline') || [
      { duration: '5m', target: 10 },
    ]),
  ],
  thresholds: {
    // Response time thresholds
    'http_req_duration': [
      'p(95) < 500',
      'p(99) < 1000',
    ],
    'http_req_duration{staticAsset:yes}': [
      'p(99) < 1000',
    ],

    // Error rate threshold
    'http_req_failed': ['rate < 0.001'], // < 0.1%
    'error_rate': ['value < 0.001'],
    'success_rate': ['value > 0.999'],

    // Request count
    'http_reqs': ['count > 100'],
  },
  // Additional K6 options
  batch: 10,
  batchPerHost: 6,
  timeout: '10s',
};

// ===========================================================================
// Test Scenario Definitions
// ===========================================================================

function loadTestScenario(scenario) {
  const scenarios = {
    baseline: [
      { duration: '30s', target: 10 },
      { duration: '5m', target: 10 },
      { duration: '30s', target: 0 },
    ],
    ramp_up: [
      { duration: '5m', target: 100 },
      { duration: '5m', target: 100 },
      { duration: '5m', target: 0 },
    ],
    spike: [
      { duration: '2m', target: 10 },
      { duration: '2m', target: 500 },
      { duration: '2m', target: 10 },
      { duration: '4m', target: 10 },
    ],
    stress: [
      { duration: '2m', target: 50 },
      { duration: '2m', target: 100 },
      { duration: '2m', target: 200 },
      { duration: '2m', target: 300 },
      { duration: '2m', target: 400 },
      { duration: '2m', target: 500 },
      { duration: '2m', target: 600 },
      { duration: '2m', target: 700 },
      { duration: '2m', target: 800 },
      { duration: '2m', target: 900 },
    ],
    endurance: [
      { duration: '5m', target: 50 },
      { duration: '50m', target: 50 },
      { duration: '5m', target: 0 },
    ],
    email_delivery: [
      { duration: '5m', target: 50 },
      { duration: '20m', target: 100 },
      { duration: '5m', target: 0 },
    ],
  };

  return scenarios[scenario] || scenarios.baseline;
}

// ===========================================================================
// Setup Phase - Test Data Initialization
// ===========================================================================

export function setup() {
  // Validate authentication
  const authCheck = http.get(`${BASE_URL}/api/health`, { headers: httpHeaders });

  if (authCheck.status !== 200) {
    console.error(`Health check failed: ${authCheck.status}`);
    console.error(`Response: ${authCheck.body}`);
  }

  console.log(`Setup: Base URL = ${BASE_URL}`);
  console.log(`Setup: Test User ID = ${TEST_USER_ID}`);
  console.log(`Setup: Organization ID = ${ORGANIZATION_ID}`);

  return {
    baseUrl: BASE_URL,
    authToken: AUTH_TOKEN,
    testUserId: TEST_USER_ID,
    organizationId: ORGANIZATION_ID,
  };
}

// ===========================================================================
// Test Scenarios - Main VU Execution
// ===========================================================================

export default function runLoadTest(data) {
  // Track active VUs
  activeVUs.add(1);

  // Distribute load across endpoints
  const vuNumber = __VU % 100;

  // Scenario routing
  if (vuNumber < 20) {
    // 20% baseline health checks
    testHealthCheck(data);
  } else if (vuNumber < 50) {
    // 30% preference reads
    testGetPreferences(data);
  } else if (vuNumber < 80) {
    // 30% preference updates
    testUpdatePreferences(data);
  } else {
    // 20% user operations
    testGetUsers(data);
  }

  // Sleep between iterations
  sleep(1 + Math.random() * 2); // 1-3 second think time
}

// ===========================================================================
// API Test Functions
// ===========================================================================

function testHealthCheck(data) {
  group('Health Check', () => {
    const response = http.get(`${data.baseUrl}/api/health`, {
      headers: httpHeaders,
      tags: { name: 'HealthCheck' },
    });

    const isSuccess = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 100ms': (r) => r.timings.duration < 100,
    });

    if (isSuccess) {
      successRate.add(1);
    } else {
      errorRate.add(1);
      healthCheckErrors.add(1);
    }

    healthCheckLatency.add(response.timings.duration);
  });
}

function testGetPreferences(data) {
  group('Get Notification Preferences', () => {
    const response = http.get(
      `${data.baseUrl}/api/admin/notification-preferences`,
      {
        headers: httpHeaders,
        tags: { name: 'GetPreferences', method: 'GET' },
      }
    );

    const isSuccess = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 500ms': (r) => r.timings.duration < 500,
      'response contains data': (r) => r.body && r.body.includes('data'),
      'no auth error': (r) => r.status !== 401,
    });

    if (isSuccess) {
      successRate.add(1);
      getPreferencesLatency.add(response.timings.duration);
    } else {
      errorRate.add(1);
      getPreferencesErrors.add(1);
      console.error(
        `GET preferences failed: ${response.status} - ${response.body}`
      );
    }
  });
}

function testUpdatePreferences(data) {
  group('Update Notification Preferences', () => {
    const payload = JSON.stringify({
      preferences: [
        {
          eventType: randomEventType(),
          channel: randomChannel(),
          enabled: Math.random() > 0.5,
        },
        {
          eventType: randomEventType(),
          channel: randomChannel(),
          enabled: Math.random() > 0.5,
        },
      ],
    });

    const response = http.patch(
      `${data.baseUrl}/api/admin/notification-preferences`,
      payload,
      {
        headers: httpHeaders,
        tags: { name: 'UpdatePreferences', method: 'PATCH' },
      }
    );

    const isSuccess = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 600ms': (r) => r.timings.duration < 600,
      'response contains data': (r) => r.body && r.body.includes('data'),
      'no validation error': (r) => r.status !== 422,
      'no auth error': (r) => r.status !== 401,
    });

    if (isSuccess) {
      successRate.add(1);
      updatePreferencesLatency.add(response.timings.duration);
    } else {
      errorRate.add(1);
      updatePreferencesErrors.add(1);
      console.warn(
        `PATCH preferences failed: ${response.status} - ${response.body}`
      );
    }
  });
}

function testGetUsers(data) {
  group('Get Users List', () => {
    const response = http.get(`${data.baseUrl}/api/admin/users`, {
      headers: httpHeaders,
      tags: { name: 'GetUsers', method: 'GET' },
    });

    const isSuccess = check(response, {
      'status is 200 or 401': (r) => r.status === 200 || r.status === 401,
      'response time < 500ms': (r) => r.timings.duration < 500,
      'no server error': (r) => r.status < 500,
    });

    if (response.status === 200 && isSuccess) {
      successRate.add(1);
      getUsersLatency.add(response.timings.duration);
    } else {
      errorRate.add(1);
      getUsersErrors.add(1);
    }
  });
}

// ===========================================================================
// Email Delivery Simulation
// ===========================================================================

export function testEmailDeliverySimulation(data) {
  group('Email Delivery Simulation', () => {
    // Simulate bulk email trigger
    const eventPayload = JSON.stringify({
      eventType: randomEventType(),
      userIds: generateUserIds(10),
      metadata: {
        taskId: `task-${randomId()}`,
        projectId: `project-${randomId()}`,
      },
    });

    // Simulate queue submission
    const queueResponse = http.post(
      `${data.baseUrl}/api/events/trigger-notifications`,
      eventPayload,
      {
        headers: httpHeaders,
        tags: { name: 'TriggerEmailNotification', method: 'POST' },
      }
    );

    if (queueResponse.status === 200 || queueResponse.status === 202) {
      emailsProcessed.add(10); // Count emails processed
      queueDepth.add(Math.random() * 50); // Simulate queue depth
    }
  });
}

// ===========================================================================
// Utility Functions
// ===========================================================================

function randomEventType() {
  const types = [
    'task_assigned',
    'task_mentioned',
    'status_changed',
    'due_soon',
    'comment_added',
    'project_created',
    'member_invited',
    'task_completed',
  ];
  return types[Math.floor(Math.random() * types.length)];
}

function randomChannel() {
  return Math.random() > 0.5 ? 'email' : 'in_app';
}

function randomId() {
  return Math.random().toString(36).substring(7);
}

function generateUserIds(count) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(`user-${randomId()}`);
  }
  return ids;
}

// ===========================================================================
// Teardown Phase - Cleanup & Summary
// ===========================================================================

export function teardown(data) {
  // Log summary statistics
  console.log('='.repeat(60));
  console.log('Load Test Summary');
  console.log('='.repeat(60));
  console.log(`Base URL: ${data.baseUrl}`);
  console.log(`Test User: ${data.testUserId}`);
  console.log(`Organization: ${data.organizationId}`);
  console.log('');
  console.log('Test completed. Check metrics above for detailed results.');
  console.log('='.repeat(60));
}

// ===========================================================================
// Advanced Scenarios (Commented - Uncomment to Use)
// ===========================================================================

// Spike recovery test function
export function testSpikeRecovery(data) {
  group('Spike Recovery Test', () => {
    // Make rapid sequential requests
    for (let i = 0; i < 20; i++) {
      const response = http.get(
        `${data.baseUrl}/api/admin/notification-preferences`,
        {
          headers: httpHeaders,
          tags: { name: 'SpikeTest', iteration: i },
        }
      );

      if (response.status !== 200) {
        errorRate.add(1);
      } else {
        successRate.add(1);
      }
    }
  });
}

// Stress test with escalating load
export function testStressScenario(data) {
  const stressIteration = Math.floor(__VU / 100);

  if (stressIteration > 7) {
    // High stress - expect failures
    group('Stress Test - High Load', () => {
      for (let i = 0; i < 5; i++) {
        http.get(`${data.baseUrl}/api/admin/notification-preferences`, {
          headers: httpHeaders,
          tags: { name: 'StressTest', level: 'high' },
        });
      }
    });
  } else if (stressIteration > 4) {
    // Medium stress
    group('Stress Test - Medium Load', () => {
      http.get(`${data.baseUrl}/api/admin/notification-preferences`, {
        headers: httpHeaders,
        tags: { name: 'StressTest', level: 'medium' },
      });
    });
  }
}

// ===========================================================================
// Monitoring & Observability
// ===========================================================================

// Export custom metric handlers for analysis
export const handleSummary = (data) => {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(data),
    './summary.html': htmlReport(data),
  };
};

// Text summary generator
function textSummary(data, options = {}) {
  const indent = options.indent || '';
  const lines = [
    `${indent}Load Test Summary`,
    `${indent}${'='.repeat(50)}`,
    `${indent}Tests run: ${data.metrics.http_reqs?.value || 0}`,
    `${indent}Errors: ${data.metrics.http_req_failed?.value || 0}`,
    `${indent}Success rate: ${((1 - (data.metrics.http_req_failed?.value || 0)) * 100).toFixed(2)}%`,
    `${indent}P95 latency: ${data.metrics.http_req_duration?.values['p(95)'] || 'N/A'}ms`,
    `${indent}P99 latency: ${data.metrics.http_req_duration?.values['p(99)'] || 'N/A'}ms`,
  ];

  return lines.join('\n');
}

// HTML report generator
function htmlReport(data) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Load Test Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        .metric { margin: 15px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #007bff; }
        .metric-name { font-weight: bold; color: #007bff; }
        .metric-value { font-size: 1.2em; color: #333; }
        .good { color: #28a745; }
        .warning { color: #ffc107; }
        .critical { color: #dc3545; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #007bff; color: white; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>TaskFlow Load Test Report</h1>
        <div class="metric">
          <div class="metric-name">Total Requests</div>
          <div class="metric-value">${data.metrics.http_reqs?.value || 0}</div>
        </div>
        <div class="metric">
          <div class="metric-name">Failed Requests</div>
          <div class="metric-value">${data.metrics.http_req_failed?.value || 0}</div>
        </div>
        <div class="metric">
          <div class="metric-name">Success Rate</div>
          <div class="metric-value">${((1 - (data.metrics.http_req_failed?.value || 0)) * 100).toFixed(2)}%</div>
        </div>
        <h2>Response Time</h2>
        <table>
          <tr><th>Percentile</th><th>Time (ms)</th></tr>
          <tr><td>P50</td><td>${data.metrics.http_req_duration?.values['p(50)'] || 'N/A'}</td></tr>
          <tr><td>P95</td><td>${data.metrics.http_req_duration?.values['p(95)'] || 'N/A'}</td></tr>
          <tr><td>P99</td><td>${data.metrics.http_req_duration?.values['p(99)'] || 'N/A'}</td></tr>
          <tr><td>Max</td><td>${data.metrics.http_req_duration?.values['max'] || 'N/A'}</td></tr>
        </table>
      </div>
    </body>
    </html>
  `;
}
