/**
 * API Endpoint: GET /api/analytics/export
 * Exports analytics data as CSV
 * Supports date range filtering and field selection
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { validateAuth } from '@/lib/auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface ExportOptions {
  dataType: 'orders' | 'events' | 'performance' | 'inventory';
  startDate: Date;
  endDate: Date;
  timezone: string;
  includeDetails: boolean;
}

function arrayToCsv(data: Array<Record<string, unknown>>): string {
  if (data.length === 0) {
    return '';
  }

  // Get all unique keys
  const keys = Array.from(new Set(data.flatMap(Object.keys)));

  // Create header
  const header = keys.map(k => `"${k}"`).join(',');

  // Create rows
  const rows = data.map(row =>
    keys.map(key => {
      const value = row[key];
      if (value === null || value === undefined) {
        return '';
      }
      const strValue = String(value);
      // Escape quotes and wrap in quotes if contains comma
      return strValue.includes(',') || strValue.includes('"')
        ? `"${strValue.replace(/"/g, '""')}"`
        : `"${strValue}"`;
    }).join(',')
  );

  return [header, ...rows].join('\n');
}

async function exportOrders(
  startDate: Date,
  endDate: Date,
  includeDetails: boolean
): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('activity_log')
    .select('*')
    .eq('action', 'order_completed')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())
    .order('created_at', { ascending: false });

  return (data || []).map(log => ({
    timestamp: log.created_at,
    order_id: log.details?.order_id,
    amount: log.details?.amount,
    branch: log.details?.branch,
    status: log.details?.status,
    ...(includeDetails && { details: JSON.stringify(log.details) }),
  }));
}

async function exportEvents(
  startDate: Date,
  endDate: Date,
  includeDetails: boolean
): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('activity_log')
    .select('*')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(10000); // Limit for export

  return (data || []).map(log => ({
    timestamp: log.created_at,
    action: log.action,
    actor_id: log.actor_id,
    entity_type: log.entity_type,
    entity_id: log.entity_id,
    ...(includeDetails && { details: JSON.stringify(log.details) }),
  }));
}

async function exportPerformance(
  startDate: Date,
  endDate: Date
): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('activity_log')
    .select('*')
    .eq('action', 'api_request')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(10000);

  return (data || []).map(log => ({
    timestamp: log.created_at,
    endpoint: log.details?.endpoint,
    method: log.details?.method,
    status_code: log.details?.status_code,
    response_time_ms: log.details?.response_time_ms,
    error_message: log.details?.error_message,
  }));
}

async function exportInventory(
  startDate: Date,
  endDate: Date,
  includeDetails: boolean
): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('activity_log')
    .select('*')
    .in('action', ['stock_checked', 'reorder_triggered', 'stock_out_event'])
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(10000);

  return (data || []).map(log => ({
    timestamp: log.created_at,
    action: log.action,
    product: log.details?.product_name,
    stock_level: log.details?.stock_level,
    min_stock: log.details?.min_stock,
    max_stock: log.details?.max_stock,
    ...(includeDetails && { details: JSON.stringify(log.details) }),
  }));
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
    const dataType = (searchParams.get('type') || 'orders') as ExportOptions['dataType'];
    const startDate = new Date(searchParams.get('startDate') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    const endDate = new Date(searchParams.get('endDate') || new Date().toISOString());
    const timezone = searchParams.get('timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const includeDetails = searchParams.get('includeDetails') === 'true';

    // Validate parameters
    if (!['orders', 'events', 'performance', 'inventory'].includes(dataType)) {
      return NextResponse.json(
        { error: 'Invalid export type' },
        { status: 400 }
      );
    }

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    if (startDate > endDate) {
      return NextResponse.json(
        { error: 'Start date must be before end date' },
        { status: 400 }
      );
    }

    // Limit date range to 90 days for performance
    const maxRange = 90 * 24 * 60 * 60 * 1000;
    if (endDate.getTime() - startDate.getTime() > maxRange) {
      return NextResponse.json(
        { error: 'Date range cannot exceed 90 days' },
        { status: 400 }
      );
    }

    // Fetch data based on type
    let data: Array<Record<string, unknown>> = [];

    switch (dataType) {
      case 'orders':
        data = await exportOrders(startDate, endDate, includeDetails);
        break;
      case 'events':
        data = await exportEvents(startDate, endDate, includeDetails);
        break;
      case 'performance':
        data = await exportPerformance(startDate, endDate);
        break;
      case 'inventory':
        data = await exportInventory(startDate, endDate, includeDetails);
        break;
    }

    // Convert to CSV
    const csv = arrayToCsv(data);

    // Log export
    await supabase.from('activity_log').insert({
      action: 'analytics_export',
      actor_id: auth.id,
      details: {
        export_type: dataType,
        rows: data.length,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      },
      entity_type: 'analytics',
    }).catch(() => {}); // Ignore logging errors

    // Return CSV
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename="taskflow-${dataType}-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    logger.error('Export endpoint error', { error });
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    );
  }
}
