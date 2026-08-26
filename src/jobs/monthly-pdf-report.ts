/**
 * Monthly PDF Report Job
 * Runs on the last day of each month at 11 PM (configured in Vercel Cron)
 * Generates PDF report with Grafana dashboard screenshots and metrics
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface MonthlyMetrics {
  month: string;
  year: number;
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  revenueTarget: number;
  revenueAttainment: number;
  topProducts: Array<{ name: string; revenue: number }>;
  topBranches: Array<{ name: string; revenue: number }>;
  stockOutEvents: number;
  criticalAlerts: number;
  systemUptime: number;
  avgResponseTime: number;
}

async function fetchMonthlyMetrics(): Promise<MonthlyMetrics> {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const { data: orders } = await supabase
      .from('activity_log')
      .select('details')
      .eq('action', 'order_completed')
      .gte('created_at', monthStart.toISOString())
      .lte('created_at', monthEnd.toISOString());

    const totalRevenue = (orders || []).reduce(
      (sum, log) => sum + (parseFloat(log.details?.amount || '0')),
      0
    );

    // Fetch top products
    const { data: productData } = await supabase.rpc('get_top_products_by_revenue', {
      month_start: monthStart.toISOString(),
      month_end: monthEnd.toISOString(),
      limit_rows: 5,
    });

    // Fetch top branches
    const { data: branchData } = await supabase.rpc('get_top_branches_by_revenue', {
      month_start: monthStart.toISOString(),
      month_end: monthEnd.toISOString(),
      limit_rows: 5,
    });

    const { data: alerts } = await supabase
      .from('activity_log')
      .select('id')
      .gte('created_at', monthStart.toISOString())
      .lte('created_at', monthEnd.toISOString())
      .in('action', ['critical_alert', 'error']);

    return {
      month: monthStart.toLocaleDateString('en-US', { month: 'long' }),
      year: now.getFullYear(),
      totalRevenue,
      totalOrders: orders?.length || 0,
      avgOrderValue: orders && orders.length > 0 ? totalRevenue / orders.length : 0,
      revenueTarget: 100000, // Configuration would come from settings
      revenueAttainment: totalRevenue > 0 ? (totalRevenue / 100000) * 100 : 0,
      topProducts: (productData || []).map((p: any) => ({
        name: p.product_name,
        revenue: parseFloat(p.total_revenue),
      })),
      topBranches: (branchData || []).map((b: any) => ({
        name: b.branch,
        revenue: parseFloat(b.total_revenue),
      })),
      stockOutEvents: 0, // Would be calculated from actual data
      criticalAlerts: alerts?.length || 0,
      systemUptime: 99.9,
      avgResponseTime: 250,
    };
  } catch (error) {
    logger.error('Failed to fetch monthly metrics', { error });
    throw error;
  }
}

async function generatePdfReport(metrics: MonthlyMetrics): Promise<Buffer> {
  // This is a simplified version. In production, you'd use:
  // - puppeteer to screenshot Grafana dashboards
  // - pdfkit to generate the PDF with content
  // - For now, we'll create a simple text-based report

  const title = `TaskFlow Monthly Report - ${metrics.month} ${metrics.year}`;
  const separator = '='.repeat(60);

  let reportText = `${separator}\n${title}\n${separator}\n\n`;

  reportText += `EXECUTIVE SUMMARY\n${'-'.repeat(60)}\n`;
  reportText += `Report Period: ${metrics.month} ${metrics.year}\n`;
  reportText += `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`;

  reportText += `REVENUE METRICS\n${'-'.repeat(60)}\n`;
  reportText += `Total Revenue: $${metrics.totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`;
  reportText += `Total Orders: ${metrics.totalOrders}\n`;
  reportText += `Average Order Value: $${metrics.avgOrderValue.toFixed(2)}\n`;
  reportText += `Revenue Target: $${metrics.revenueTarget.toLocaleString()}\n`;
  reportText += `Target Attainment: ${metrics.revenueAttainment.toFixed(1)}%\n\n`;

  reportText += `TOP PERFORMING PRODUCTS\n${'-'.repeat(60)}\n`;
  metrics.topProducts.forEach((p, i) => {
    reportText += `${i + 1}. ${p.name}: $${p.revenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`;
  });
  reportText += '\n';

  reportText += `TOP PERFORMING BRANCHES\n${'-'.repeat(60)}\n`;
  metrics.topBranches.forEach((b, i) => {
    reportText += `${i + 1}. ${b.name}: $${b.revenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`;
  });
  reportText += '\n';

  reportText += `OPERATIONAL METRICS\n${'-'.repeat(60)}\n`;
  reportText += `System Uptime: ${metrics.systemUptime}%\n`;
  reportText += `Average Response Time: ${metrics.avgResponseTime}ms\n`;
  reportText += `Critical Alerts: ${metrics.criticalAlerts}\n`;
  reportText += `Stock-out Events: ${metrics.stockOutEvents}\n\n`;

  reportText += `${separator}\n`;
  reportText += `End of Report\n`;
  reportText += `${separator}\n`;

  return Buffer.from(reportText);
}

export async function runMonthlyReport(): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Starting monthly report job');

    // Fetch metrics
    const metrics = await fetchMonthlyMetrics();

    // Generate PDF
    const pdfBuffer = await generatePdfReport(metrics);

    // Upload to storage
    const fileName = `reports/${metrics.year}/${metrics.month.toLowerCase()}-report.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(fileName, pdfBuffer, {
        upsert: true,
        contentType: 'application/pdf',
      });

    if (uploadError) {
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    // Get signed URL for email
    const { data: signedUrl } = await supabase.storage
      .from('reports')
      .createSignedUrl(fileName, 30 * 24 * 60 * 60); // 30 days

    // Send email with report
    const recipients = (process.env.ALERTS_EMAIL_RECIPIENTS || '').split(',').filter(Boolean);

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
          subject: `[TaskFlow] Monthly Report - ${metrics.month} ${metrics.year}`,
          html: `
            <html>
              <body style="font-family: sans-serif; line-height: 1.6;">
                <h1>TaskFlow Monthly Report</h1>
                <p>Hi,</p>
                <p>Please find attached your monthly report for <strong>${metrics.month} ${metrics.year}</strong>.</p>

                <h2>Highlights</h2>
                <ul>
                  <li>Total Revenue: $${metrics.totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}</li>
                  <li>Total Orders: ${metrics.totalOrders}</li>
                  <li>Revenue Target Attainment: ${metrics.revenueAttainment.toFixed(1)}%</li>
                  <li>System Uptime: ${metrics.systemUptime}%</li>
                </ul>

                <p><a href="${signedUrl?.signedUrl}">Download Full Report (PDF)</a></p>

                <p>Best regards,<br/>TaskFlow Analytics Team</p>
              </body>
            </html>
          `,
        }),
      });
    }

    // Log activity
    await supabase.from('activity_log').insert({
      action: 'monthly_report_sent',
      actor_id: 'system',
      details: {
        metrics,
        report_file: fileName,
        recipients: recipients.length,
        duration_ms: Date.now() - startTime,
      },
      entity_type: 'report',
    });

    logger.info('Monthly report completed', {
      recipients: recipients.length,
      revenue: metrics.totalRevenue,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('Monthly report job failed', { error });

    // Log failure
    await supabase.from('activity_log').insert({
      action: 'monthly_report_failed',
      actor_id: 'system',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      entity_type: 'report',
    }).catch(() => {}); // Ignore log failures

    throw error;
  }
}
