/**
 * Cron Trigger: Daily Digest
 * Vercel Cron: 0 9 * * * (Every day at 9 AM UTC)
 * Production: Configure in vercel.json
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { runDailyDigest } from '@/jobs/daily-digest';

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
    if (cronSecret !== process.env.CRON_SECRET) {
      logger.warn('Unauthorized cron request', { endpoint: 'daily-digest' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('Executing daily digest cron job');
    await runDailyDigest();

    return NextResponse.json({
      success: true,
      message: 'Daily digest completed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Daily digest cron error', { error });
    return NextResponse.json(
      { error: 'Daily digest failed' },
      { status: 500 }
    );
  }
}
