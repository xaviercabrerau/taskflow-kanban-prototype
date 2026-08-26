/**
 * Weekly Analytics Alert Job
 * Runs every Monday at 8 AM (configured in Vercel Cron)
 * Sends Slack message to #analytics channel with weekly summary
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface WeeklyMetrics {
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  revenueChange: number; // percentage change from previous week
  orderChange: number;
  criticalIssues: number;
  warnings: string[];
  topMetric: string;
}

async function fetchWeeklyMetrics(): Promise<WeeklyMetrics> {
  try {
    const { data: currentWeek } = await supabase
      .from('activity_log')
      .select('details')
      .eq('action', 'order_completed')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const { data: previousWeek } = await supabase
      .from('activity_log')
      .select('details')
      .eq('action', 'order_completed')
      .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const currentRevenue = (currentWeek || []).reduce(
      (sum, log) => sum + (parseFloat(log.details?.amount || '0')),
      0
    );

    const previousRevenue = (previousWeek || []).reduce(
      (sum, log) => sum + (parseFloat(log.details?.amount || '0')),
      0
    );

    const revenueChange = previousRevenue > 0
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
      : 0;

    const { data: issues } = await supabase
      .from('activity_log')
      .select('id')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .in('action', ['error', 'critical_alert', 'stock_out_event']);

    return {
      totalRevenue: currentRevenue,
      totalOrders: currentWeek?.length || 0,
      avgOrderValue: currentWeek && currentWeek.length > 0 ? currentRevenue / currentWeek.length : 0,
      revenueChange,
      orderChange: ((currentWeek?.length || 0) - (previousWeek?.length || 0)) / Math.max((previousWeek?.length || 1), 1) * 100,
      criticalIssues: issues?.length || 0,
      warnings: revenueChange < -10 ? ['Revenue down more than 10%'] : [],
      topMetric: revenueChange > 0 ? `Revenue up ${revenueChange.toFixed(1)}%` : `Revenue down ${Math.abs(revenueChange).toFixed(1)}%`,
    };
  } catch (error) {
    logger.error('Failed to fetch weekly metrics', { error });
    throw error;
  }
}

function buildSlackMessage(metrics: WeeklyMetrics): Record<string, unknown> {
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString();
  const weekEnd = new Date().toLocaleDateString();

  const revenueColor = metrics.revenueChange >= 0 ? '#28a745' : '#dc3545';
  const revenueEmoji = metrics.revenueChange >= 0 ? ':chart_with_upwards_trend:' : ':chart_with_downwards_trend:';

  return {
    text: `Weekly Analytics Summary - ${weekStart} to ${weekEnd}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: ':bar_chart: Weekly Analytics Summary',
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Week of ${weekStart} to ${weekEnd}`,
          },
        ],
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Revenue*\n$${metrics.totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          },
          {
            type: 'mrkdwn',
            text: `*Change*\n${revenueEmoji} ${metrics.revenueChange > 0 ? '+' : ''}${metrics.revenueChange.toFixed(1)}%`,
          },
          {
            type: 'mrkdwn',
            text: `*Total Orders*\n${metrics.totalOrders}`,
          },
          {
            type: 'mrkdwn',
            text: `*Avg Order Value*\n$${metrics.avgOrderValue.toFixed(2)}`,
          },
        ],
      },
      {
        type: 'divider',
      },
      ...metrics.warnings.map((warning) => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: ${warning}`,
        },
      })),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*System Health*\nCritical Issues: ${metrics.criticalIssues}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Dashboard',
              emoji: true,
            },
            value: 'view_dashboard',
            url: `${process.env.TASKFLOW_URL}/admin/analytics`,
            action_id: 'button-click-dashboard',
          },
        ],
      },
    ],
  };
}

export async function runWeeklyAlert(): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Starting weekly alert job');

    // Fetch metrics
    const metrics = await fetchWeeklyMetrics();

    // Build Slack message
    const slackMessage = buildSlackMessage(metrics);

    // Send to Slack
    if (!process.env.SLACK_WEBHOOK_URL) {
      logger.warn('Slack webhook URL not configured');
      return;
    }

    const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.statusText}`);
    }

    // Log activity
    await supabase.from('activity_log').insert({
      action: 'weekly_alert_sent',
      actor_id: 'system',
      details: {
        metrics,
        duration_ms: Date.now() - startTime,
      },
      entity_type: 'report',
    });

    logger.info('Weekly alert completed', {
      duration_ms: Date.now() - startTime,
      criticalIssues: metrics.criticalIssues,
    });
  } catch (error) {
    logger.error('Weekly alert job failed', { error });

    // Try to send failure notification to Slack
    if (process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ':warning: Weekly analytics alert failed to generate',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `:warning: *Weekly Alert Failed*\nError: ${error instanceof Error ? error.message : 'Unknown error'}`,
              },
            },
          ],
        }),
      }).catch(() => {}); // Ignore notification errors
    }

    throw error;
  }
}
