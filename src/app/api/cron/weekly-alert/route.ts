/**
 * Cron Trigger: Weekly Alert
 * Vercel Cron: 0 8 * * 1 (Every Monday at 8 AM UTC)
 * Production: Configure in vercel.json
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { runWeeklyAlert } from '@/jobs/weekly-alert';

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
    if (cronSecret !== process.env.CRON_SECRET) {
      logger.warn('Unauthorized cron request', { endpoint: 'weekly-alert' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('Executing weekly alert cron job');
    await runWeeklyAlert();

    return NextResponse.json({
      success: true,
      message: 'Weekly alert completed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Weekly alert cron error', { error });
    return NextResponse.json(
      { error: 'Weekly alert failed' },
      { status: 500 }
    );
  }
}
