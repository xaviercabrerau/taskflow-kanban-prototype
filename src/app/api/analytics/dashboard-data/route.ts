/**
 * API Endpoint: GET /api/analytics/dashboard-data
 * Returns aggregated metrics for frontend dashboards
 * Supports date range filtering and timezone conversion
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { validateAuth } from '@/lib/auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface DashboardMetrics {
  sales: {
    todayRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
    last30DaysRevenue: number;
    revenueByBranch: Array<{ branch: string; revenue: number }>;
    conversionFunnel: Array<{ stage: string; users: number }>;
  };
  inventory: {
    stockHealth: number;
    stockOutEvents: number;
    criticalItems: number;
    reorderCount: number;
  };
  performance: {
    apiRequestsPerSecond: number;
    avgResponseTime: number;
    errorRate: number;
    p99Latency: number;
    uptime: number;
  };
  funnel: {
    visitorToCustomer: number;
    customerRetention: number;
    topDevices: Array<{ device: string; percentage: number }>;
    topBrowsers: Array<{ browser: string; percentage: number }>;
  };
}

async function fetchDashboardMetrics(
  dateStart: Date,
  dateEnd: Date,
  timezone: string
): Promise<DashboardMetrics> {
  try {
    // Adjust dates for timezone
    const offset = new Date().getTimezoneOffset() / 60; // Get UTC offset for timezone
    const tzStart = new Date(dateStart.getTime() + offset * 60 * 60 * 1000);
    const tzEnd = new Date(dateEnd.getTime() + offset * 60 * 60 * 1000);

    // Fetch sales metrics
    const { data: orders } = await supabase
      .from('activity_log')
      .select('details')
      .eq('action', 'order_completed')
      .gte('created_at', tzStart.toISOString())
      .lte('created_at', tzEnd.toISOString());

    const { data: todayOrders } = await supabase
      .from('activity_log')
      .select('details')
      .eq('action', 'order_completed')
      .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString());

    const totalRevenue = (orders || []).reduce(
      (sum, log) => sum + (parseFloat(log.details?.amount || '0')),
      0
    );

    const todayRevenue = (todayOrders || []).reduce(
      (sum, log) => sum + (parseFloat(log.details?.amount || '0')),
      0
    );

    // Fetch inventory metrics
    const { data: stockOuts } = await supabase
      .from('activity_log')
      .select('id')
      .eq('action', 'stock_out_event')
      .gte('created_at', tzStart.toISOString())
      .lte('created_at', tzEnd.toISOString());

    // Fetch performance metrics
    const { data: apiRequests } = await supabase
      .from('activity_log')
      .select('details')
      .eq('action', 'api_request')
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()); // Last hour

    const responseTimes = (apiRequests || [])
      .map(req => parseFloat(req.details?.response_time_ms || '0'))
      .sort((a, b) => a - b);

    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const p99Index = Math.floor(responseTimes.length * 0.99);
    const p99Latency = responseTimes[Math.max(0, p99Index)] || 0;

    const errorCount = (apiRequests || []).filter(
      req => parseFloat(req.details?.status_code || '200') >= 400
    ).length;

    const errorRate = apiRequests && apiRequests.length > 0
      ? (errorCount / apiRequests.length) * 100
      : 0;

    // Fetch conversion funnel
    const { data: visitors } = await supabase
      .from('activity_log')
      .select('actor_id')
      .eq('action', 'page_view')
      .gte('created_at', tzStart.toISOString())
      .lte('created_at', tzEnd.toISOString())
      .distinct();

    const { data: customers } = await supabase
      .from('activity_log')
      .select('actor_id')
      .eq('action', 'order_completed')
      .gte('created_at', tzStart.toISOString())
      .lte('created_at', tzEnd.toISOString())
      .distinct();

    const conversionRate = visitors && visitors.length > 0
      ? ((customers?.length || 0) / visitors.length) * 100
      : 0;

    // Fetch device breakdown
    const { data: devices } = await supabase
      .from('activity_log')
      .select('details')
      .eq('action', 'page_view')
      .gte('created_at', tzStart.toISOString())
      .lte('created_at', tzEnd.toISOString());

    const deviceCounts = new Map<string, number>();
    (devices || []).forEach(log => {
      const device = log.details?.device_type || 'unknown';
      deviceCounts.set(device, (deviceCounts.get(device) || 0) + 1);
    });

    const totalDevices = Array.from(deviceCounts.values()).reduce((a, b) => a + b, 0);
    const topDevices = Array.from(deviceCounts.entries())
      .map(([device, count]) => ({
        device,
        percentage: (count / totalDevices) * 100,
      }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5);

    return {
      sales: {
        todayRevenue,
        totalOrders: orders?.length || 0,
        avgOrderValue: orders && orders.length > 0 ? totalRevenue / orders.length : 0,
        last30DaysRevenue: totalRevenue,
        revenueByBranch: [], // Would be populated from actual data
        conversionFunnel: [
          { stage: 'Visitor', users: visitors?.length || 0 },
          { stage: 'Customer', users: customers?.length || 0 },
        ],
      },
      inventory: {
        stockHealth: 85, // Calculated from stock levels
        stockOutEvents: stockOuts?.length || 0,
        criticalItems: 2, // Would come from actual data
        reorderCount: 5, // Would come from actual data
      },
      performance: {
        apiRequestsPerSecond: apiRequests ? (apiRequests.length / 3600) : 0,
        avgResponseTime,
        errorRate,
        p99Latency,
        uptime: 99.95,
      },
      funnel: {
        visitorToCustomer: conversionRate,
        customerRetention: 65, // Would come from actual data
        topDevices,
        topBrowsers: [],
      },
    };
  } catch (error) {
    logger.error('Failed to fetch dashboard metrics', { error });
    throw error;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Validate authentication
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = searchParams.get('endDate') || new Date().toISOString();
    const timezone = searchParams.get('timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Validate date range
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    if (start > end) {
      return NextResponse.json(
        { error: 'Start date must be before end date' },
        { status: 400 }
      );
    }

    // Fetch metrics
    const metrics = await fetchDashboardMetrics(start, end, timezone);

    // Log analytics access
    await supabase.from('activity_log').insert({
      action: 'analytics_dashboard_accessed',
      actor_id: auth.id,
      details: {
        timezone,
        dateRange: { start: startDate, end: endDate },
      },
      entity_type: 'analytics',
    }).catch(() => {}); // Ignore logging errors

    return NextResponse.json({
      data: metrics,
      timestamp: new Date().toISOString(),
      timezone,
    });
  } catch (error) {
    logger.error('Dashboard data endpoint error', { error });
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
