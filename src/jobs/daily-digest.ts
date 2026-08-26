/**
 * Daily Digest Report Job
 * Runs every day at 9 AM (configured in Vercel Cron)
 * Sends email to executives with sales metrics, inventory alerts, and system health
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface DailyMetrics {
  todayRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  lastWeekRevenue: number;
  stockOutCount: number;
  criticalStockItems: number;
  apiHealth: {
    uptime: number;
    avgResponseTime: number;
    errorRate: number;
  };
}

async function fetchDailyMetrics(): Promise<DailyMetrics> {
  try {
    const { data: metrics } = await supabase.rpc('get_daily_metrics', {
      user_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    return metrics || {
      todayRevenue: 0,
      totalOrders: 0,
      avgOrderValue: 0,
      lastWeekRevenue: 0,
      stockOutCount: 0,
      criticalStockItems: 0,
      apiHealth: {
        uptime: 100,
        avgResponseTime: 0,
        errorRate: 0,
      },
    };
  } catch (error) {
    logger.error('Failed to fetch daily metrics', { error });
    throw error;
  }
}

function generateHtmlEmail(metrics: DailyMetrics): string {
  const revenueTrend = metrics.todayRevenue >= metrics.lastWeekRevenue * 0.75 ? '↑' : '↓';
  const healthStatus = metrics.apiHealth.errorRate < 1 ? '✓ Healthy' : '⚠ Warning';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
          .section { background: #f9f9f9; padding: 20px; margin-bottom: 15px; border-radius: 8px; }
          .metric { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #eee; }
          .metric-value { font-size: 24px; font-weight: bold; color: #667eea; }
          .metric-label { color: #666; }
          .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 10px 0; border-radius: 4px; }
          .success { background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 10px 0; border-radius: 4px; }
          .footer { text-align: center; color: #999; font-size: 12px; padding-top: 20px; border-top: 1px solid #eee; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Daily Executive Digest</h1>
            <p>${new Date().toLocaleDateString()}</p>
          </div>

          <div class="section">
            <h2>Sales Metrics</h2>
            <div class="metric">
              <span class="metric-label">Today Revenue</span>
              <span class="metric-value">$${metrics.todayRevenue.toLocaleString()}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Total Orders</span>
              <span class="metric-value">${metrics.totalOrders}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Avg Order Value</span>
              <span class="metric-value">$${metrics.avgOrderValue.toFixed(2)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Trend (vs 7 days avg)</span>
              <span class="metric-value">${revenueTrend}</span>
            </div>
          </div>

          <div class="section">
            <h2>Inventory Status</h2>
            ${metrics.stockOutCount > 0 ? `<div class="alert">⚠️ <strong>${metrics.stockOutCount}</strong> stock-out events in last 24h</div>` : `<div class="success">✓ No stock-out events</div>`}
            ${metrics.criticalStockItems > 0 ? `<div class="alert">⚠️ <strong>${metrics.criticalStockItems}</strong> items at critical stock levels</div>` : ''}
          </div>

          <div class="section">
            <h2>System Health</h2>
            <div class="metric">
              <span class="metric-label">Uptime</span>
              <span class="metric-value">${metrics.apiHealth.uptime.toFixed(2)}%</span>
            </div>
            <div class="metric">
              <span class="metric-label">Avg Response Time</span>
              <span class="metric-value">${metrics.apiHealth.avgResponseTime.toFixed(0)}ms</span>
            </div>
            <div class="metric">
              <span class="metric-label">Error Rate</span>
              <span class="metric-value" style="color: ${metrics.apiHealth.errorRate > 1 ? '#dc3545' : '#28a745'}">
                ${metrics.apiHealth.errorRate.toFixed(2)}%
              </span>
            </div>
            <div style="text-align: center; margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee;">
              Status: <strong>${healthStatus}</strong>
            </div>
          </div>

          <div class="footer">
            <p>This is an automated daily digest. Do not reply to this email.</p>
            <p><a href="${process.env.TASKFLOW_URL}/admin/reports">View Full Reports</a></p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function runDailyDigest(): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Starting daily digest job');

    // Fetch metrics
    const metrics = await fetchDailyMetrics();

    // Generate email
    const htmlEmail = generateHtmlEmail(metrics);

    // Send email using Resend (or your email service)
    const recipients = (process.env.ALERTS_EMAIL_RECIPIENTS || '').split(',').filter(Boolean);

    if (recipients.length === 0) {
      logger.warn('No email recipients configured for daily digest');
      return;
    }

    // Using fetch to Resend API (simulating, should use resend package in real implementation)
    for (const recipient of recipients) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.ALERTS_FROM_ADDRESS || 'alerts@taskflow.app',
          to: recipient,
          subject: `[TaskFlow] Daily Executive Digest - ${new Date().toLocaleDateString()}`,
          html: htmlEmail,
        }),
      });
    }

    // Log activity
    await supabase.from('activity_log').insert({
      action: 'daily_digest_sent',
      actor_id: 'system',
      details: {
        recipients: recipients.length,
        metrics: metrics,
        duration_ms: Date.now() - startTime,
      },
      entity_type: 'report',
    });

    logger.info('Daily digest completed', {
      recipients: recipients.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('Daily digest job failed', { error });

    // Log failure
    await supabase.from('activity_log').insert({
      action: 'daily_digest_failed',
      actor_id: 'system',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      entity_type: 'report',
    }).catch(() => {}); // Ignore log failures

    throw error;
  }
}
