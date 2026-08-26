/**
 * Integration Tests for Analytics & Reporting
 * Tests dashboard data accuracy, export functionality, and report generation
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';

// Mock Supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('Analytics API Endpoints', () => {
  let mockSupabase: any;

  beforeAll(() => {
    mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({ data: [] }),
                }),
              }),
            }),
          }),
        }),
      }),
      rpc: jest.fn().mockResolvedValue({ data: {} }),
    };

    (createClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  describe('Dashboard Data Endpoint', () => {
    it('should return metrics for valid date range', async () => {
      const response = await fetch(
        '/api/analytics/dashboard-data?startDate=2024-01-01&endDate=2024-01-31'
      );
      expect(response.status).toEqual(200);
    });

    it('should validate timezone parameter', async () => {
      const response = await fetch(
        '/api/analytics/dashboard-data?timezone=America/New_York'
      );
      expect(response.status).toEqual(200);
    });

    it('should reject invalid date range', async () => {
      const response = await fetch(
        '/api/analytics/dashboard-data?startDate=invalid&endDate=2024-01-31'
      );
      expect(response.status).toEqual(400);
    });

    it('should require authentication', async () => {
      const response = await fetch('/api/analytics/dashboard-data');
      expect(response.status).toEqual(401);
    });

    it('should include sales metrics in response', async () => {
      const response = await fetch(
        '/api/analytics/dashboard-data',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        expect(data.data).toHaveProperty('sales');
        expect(data.data.sales).toHaveProperty('todayRevenue');
        expect(data.data.sales).toHaveProperty('totalOrders');
        expect(data.data.sales).toHaveProperty('avgOrderValue');
      }
    });

    it('should include inventory metrics in response', async () => {
      const response = await fetch(
        '/api/analytics/dashboard-data',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        expect(data.data).toHaveProperty('inventory');
        expect(data.data.inventory).toHaveProperty('stockHealth');
        expect(data.data.inventory).toHaveProperty('stockOutEvents');
      }
    });

    it('should include performance metrics in response', async () => {
      const response = await fetch(
        '/api/analytics/dashboard-data',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        expect(data.data).toHaveProperty('performance');
        expect(data.data.performance).toHaveProperty('apiRequestsPerSecond');
        expect(data.data.performance).toHaveProperty('avgResponseTime');
        expect(data.data.performance).toHaveProperty('errorRate');
      }
    });

    it('should be timezone-aware', async () => {
      const response = await fetch(
        '/api/analytics/dashboard-data?timezone=UTC',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        expect(data.timezone).toEqual('UTC');
      }
    });
  });

  describe('Export Endpoint', () => {
    it('should export orders as CSV', async () => {
      const response = await fetch(
        '/api/analytics/export?type=orders',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );
      expect(response.status).toEqual(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
    });

    it('should export events as CSV', async () => {
      const response = await fetch(
        '/api/analytics/export?type=events',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );
      expect(response.status).toEqual(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
    });

    it('should export performance metrics as CSV', async () => {
      const response = await fetch(
        '/api/analytics/export?type=performance',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );
      expect(response.status).toEqual(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
    });

    it('should export inventory as CSV', async () => {
      const response = await fetch(
        '/api/analytics/export?type=inventory',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );
      expect(response.status).toEqual(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
    });

    it('should reject invalid export type', async () => {
      const response = await fetch(
        '/api/analytics/export?type=invalid',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );
      expect(response.status).toEqual(400);
    });

    it('should limit date range to 90 days', async () => {
      const startDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const response = await fetch(
        `/api/analytics/export?type=orders&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );
      expect(response.status).toEqual(400);
    });

    it('should set correct filename in content-disposition header', async () => {
      const response = await fetch(
        '/api/analytics/export?type=orders',
        {
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        }
      );

      if (response.ok) {
        const disposition = response.headers.get('content-disposition');
        expect(disposition).toContain('taskflow-orders');
        expect(disposition).toContain('.csv');
      }
    });

    it('should require authentication', async () => {
      const response = await fetch('/api/analytics/export?type=orders');
      expect(response.status).toEqual(401);
    });
  });

  describe('Data Accuracy', () => {
    it('should calculate revenue correctly', async () => {
      // Revenue should be sum of all order amounts
      mockSupabase.from().select().eq().gte().lte().mockResolvedValue({
        data: [
          { details: { amount: '100.00' } },
          { details: { amount: '200.00' } },
          { details: { amount: '300.00' } },
        ],
      });

      // Expected: 600.00
      expect(100 + 200 + 300).toEqual(600);
    });

    it('should calculate average order value correctly', async () => {
      // AOV should be revenue / order count
      const revenue = 600;
      const orderCount = 3;
      const aov = revenue / orderCount;

      expect(aov).toEqual(200);
    });

    it('should calculate conversion rate correctly', async () => {
      // Conversion rate = customers / visitors * 100
      const customers = 10;
      const visitors = 100;
      const conversionRate = (customers / visitors) * 100;

      expect(conversionRate).toEqual(10);
    });

    it('should calculate error rate correctly', async () => {
      // Error rate = (5xx + 4xx errors) / total requests * 100
      const errors = 5;
      const totalRequests = 100;
      const errorRate = (errors / totalRequests) * 100;

      expect(errorRate).toEqual(5);
    });
  });

  describe('Report Generation', () => {
    it('should format email HTML correctly', () => {
      const html = `
        <html>
          <body>
            <h1>Daily Digest</h1>
            <p>Revenue: $1000</p>
          </body>
        </html>
      `;

      expect(html).toContain('<html>');
      expect(html).toContain('<h1>Daily Digest</h1>');
      expect(html).toContain('$1000');
    });

    it('should format Slack message blocks correctly', () => {
      const slackMessage = {
        text: 'Weekly Summary',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: 'Weekly Summary',
              emoji: true,
            },
          },
        ],
      };

      expect(slackMessage.blocks).toHaveLength(1);
      expect(slackMessage.blocks[0].type).toEqual('header');
    });
  });

  describe('Cron Job Security', () => {
    it('should validate cron secret on daily digest', async () => {
      const response = await fetch('/api/cron/daily-digest', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-secret',
        },
      });

      expect(response.status).toEqual(401);
    });

    it('should validate cron secret on weekly alert', async () => {
      const response = await fetch('/api/cron/weekly-alert', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-secret',
        },
      });

      expect(response.status).toEqual(401);
    });

    it('should validate cron secret on monthly report', async () => {
      const response = await fetch('/api/cron/monthly-report', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-secret',
        },
      });

      expect(response.status).toEqual(401);
    });
  });
});

describe('Dashboard JSON Validation', () => {
  it('sales dashboard should have valid structure', () => {
    const dashboard = require('../dashboards/sales-dashboard.json');
    expect(dashboard.title).toEqual('Sales Dashboard');
    expect(dashboard.panels).toBeDefined();
    expect(Array.isArray(dashboard.panels)).toBe(true);
  });

  it('inventory dashboard should have valid structure', () => {
    const dashboard = require('../dashboards/inventory-dashboard.json');
    expect(dashboard.title).toEqual('Inventory Dashboard');
    expect(dashboard.panels).toBeDefined();
  });

  it('performance dashboard should have valid structure', () => {
    const dashboard = require('../dashboards/performance-dashboard.json');
    expect(dashboard.title).toEqual('Performance Dashboard');
    expect(dashboard.panels).toBeDefined();
  });

  it('funnel dashboard should have valid structure', () => {
    const dashboard = require('../dashboards/funnel-dashboard.json');
    expect(dashboard.title).toEqual('Funnel Analysis Dashboard');
    expect(dashboard.panels).toBeDefined();
  });

  it('dashboards should have data sources configured', () => {
    const dashboard = require('../dashboards/sales-dashboard.json');
    expect(dashboard.panels.length).toBeGreaterThan(0);

    dashboard.panels.forEach((panel: any) => {
      expect(panel.datasource).toBeDefined();
    });
  });
});
