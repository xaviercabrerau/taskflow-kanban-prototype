import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { sendNotification } from '@/lib/notifications/notify';
import type { Channel } from '@/lib/notifications/types';

// Internal-only endpoint. Called by Postgres triggers (via net.http_post,
// see supabase/migrations/20260828190100_wire_email_notifications_via_triggers.sql)
// and, going forward, by any other server-side code that wants to fire a
// notification without pulling in notify.ts's Supabase-service-role
// dependency directly. Never call this from the browser.
//
// Auth: a shared secret (`x-internal-secret` header) matching
// INTERNAL_NOTIFY_SECRET, stored in Supabase Vault for the trigger side —
// mirrors the CRON_SECRET pattern in /api/cron/alert-check.

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_NOTIFY_SECRET;
  if (!secret) return false;
  const provided = request.headers.get('x-internal-secret');
  if (!provided) return false;
  return timingSafeStringEqual(provided, secret);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { channels, ...event } = (body as Record<string, unknown>) || {};

  // Best-effort by design (see notify.ts) — always 200 once authorized and
  // parseable; validation failures are logged internally, not surfaced as
  // an HTTP error, since the caller (a DB trigger) can't act on a retry.
  await sendNotification(event, {
    channels: Array.isArray(channels) ? (channels as Channel[]) : undefined,
  });

  return NextResponse.json({ processed: true });
}
