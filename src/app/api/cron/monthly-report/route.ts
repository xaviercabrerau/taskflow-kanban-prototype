/**
 * Cron Trigger: Monthly Report
 * Vercel Cron: 0 23 L * * (Last day of month at 11 PM UTC)
 * For Vercel: Use 0 23 28-31 * * (last 4 days of month)
 * Production: Configure in vercel.json
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { runMonthlyReport } from '@/jobs/monthly-pdf-report';

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
    if (cronSecret !== process.env.CRON_SECRET) {
      logger.warn('Unauthorized cron request', { endpoint: 'monthly-report' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if it's actually the last day of the month (safety check)
    const now = new Date();
    const isLastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() === now.getDate();

    if (!isLastDay) {
      logger.info('Skipping monthly report - not last day of month', { day: now.getDate() });
      return NextResponse.json({
        success: true,
        message: 'Skipped - not last day of month',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info('Executing monthly report cron job');
    await runMonthlyReport();

    return NextResponse.json({
      success: true,
      message: 'Monthly report completed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Monthly report cron error', { error });
    return NextResponse.json(
      { error: 'Monthly report failed' },
      { status: 500 }
    );
  }
}
