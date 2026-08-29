/**
 * TaskFlow Notification System — synchronous send path.
 *
 * Originally designed around a BullMQ worker (see git history for
 * emitter.ts/processor.ts), but Vercel serverless functions can't host a
 * persistent queue worker — nothing ever called it. This replaces that
 * design with a single function that sends the email and/or creates the
 * in-app notification directly, in the caller's own request. There's no
 * automatic retry queue; failures are recorded to `failed_jobs` for
 * visibility and the caller is expected to treat delivery as best-effort
 * (never let a notification failure fail the underlying action).
 *
 * Architectural convention — where callers belong: this module uses the
 * Supabase service-role key and must never run in the browser. The two
 * event types currently wired (task_mentioned, status_changed) are
 * triggered from Postgres triggers via net.http_post to
 * /api/internal/notify-event (see supabase/migrations/
 * 20260828190100_wire_email_notifications_via_triggers.sql), NOT from
 * client code — this keeps RLS as the single authorization boundary for
 * all board/task mutations (which stay client → Supabase direct, see
 * BoardContext.tsx) while side effects like email stay server-side. When
 * wiring the remaining event types (task_assigned, due_soon,
 * comment_added, project_created, member_invited, task_completed),
 * follow the same pattern: add/extend a Postgres trigger that calls
 * /api/internal/notify-event, don't call sendNotification() or the route
 * from a client component or a BoardContext action.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import type { EventType, Channel, NotificationEvent } from './types';
import { sendEmail } from '../emails/resend-client';
import { getEmailContent } from '../emails/template-map';
import { taskUrl as buildTaskUrl } from '../emails/utils';
import type { TemplateProps } from '../emails/templates';

type TypedSupabaseClient = ReturnType<typeof createClient<Database>>;

const VALID_EVENT_TYPES: EventType[] = [
  'task_assigned',
  'task_mentioned',
  'status_changed',
  'due_soon',
  'comment_added',
  'project_created',
  'member_invited',
  'task_completed',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Validates that an event conforms to the NotificationEvent schema.
 * Returns null (and logs) instead of throwing — callers treat notification
 * delivery as best-effort, never as something that should break the
 * underlying action (assigning a task, posting a comment, etc.).
 */
export function validateEvent(event: unknown): NotificationEvent | null {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    console.warn('Notification event validation failed: not an object');
    return null;
  }
  const evt = event as Record<string, unknown>;

  if (!evt.type || !VALID_EVENT_TYPES.includes(evt.type as EventType)) {
    console.warn(`Notification event validation failed: invalid type "${evt.type}"`);
    return null;
  }
  if (!isValidUuid(evt.userId)) {
    console.warn('Notification event validation failed: invalid userId');
    return null;
  }
  if (!isValidUuid(evt.organizationId)) {
    console.warn('Notification event validation failed: invalid organizationId');
    return null;
  }
  if (evt.taskId !== undefined && evt.taskId !== null && !isValidUuid(evt.taskId)) {
    console.warn('Notification event validation failed: invalid taskId');
    return null;
  }
  if (evt.actorId !== undefined && evt.actorId !== null && !isValidUuid(evt.actorId)) {
    console.warn('Notification event validation failed: invalid actorId');
    return null;
  }
  if (!evt.data || typeof evt.data !== 'object' || Array.isArray(evt.data)) {
    console.warn('Notification event validation failed: data is not an object');
    return null;
  }

  const validated: NotificationEvent = {
    type: evt.type as EventType,
    userId: evt.userId as string,
    organizationId: evt.organizationId as string,
    data: evt.data as Record<string, unknown>,
  };
  if (evt.taskId !== undefined && evt.taskId !== null) validated.taskId = evt.taskId as string;
  if (evt.actorId !== undefined && evt.actorId !== null) validated.actorId = evt.actorId as string;
  return validated;
}

function getServiceClient(): TypedSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase service-role configuration missing');
  }
  return createClient<Database>(url, key);
}

async function recordFailedJob(
  supabase: TypedSupabaseClient,
  eventType: EventType | undefined,
  userId: string | undefined,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase.from('failed_jobs').insert({
    event_type: eventType || null,
    user_id: userId || null,
    error_message: errorMessage,
    retry_count: 0,
  });
  if (error) {
    console.error('Failed to record failed_jobs entry', { error: error.message });
  }
}

async function getUserPreferences(
  supabase: TypedSupabaseClient,
  userId: string,
  organizationId: string,
  eventType: EventType
): Promise<{ emailEnabled: boolean; inAppEnabled: boolean }> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('channel, enabled')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('event_type', eventType);

  if (error) {
    console.error('Failed to fetch notification preferences', { userId, organizationId, eventType, error: error.message });
    // Fail open: default to both enabled rather than silently dropping the notification.
    return { emailEnabled: true, inAppEnabled: true };
  }

  if (!data || data.length === 0) {
    return { emailEnabled: true, inAppEnabled: true };
  }

  let emailEnabled = false;
  let inAppEnabled = false;
  for (const pref of data) {
    if (!pref.enabled) continue;
    if (pref.channel === 'email') emailEnabled = true;
    if (pref.channel === 'in_app') inAppEnabled = true;
  }
  return { emailEnabled, inAppEnabled };
}

/** Short title + body for the in-app notifications table, per event type. */
function buildInAppText(event: NotificationEvent): { type: string; title: string; body: string } {
  const d = event.data;
  const taskTitle = (d.taskTitle as string | undefined) || 'una tarea';
  const actorName = (d.actorName as string | undefined) || 'Alguien';

  switch (event.type) {
    case 'task_assigned':
      return { type: 'task_assigned', title: 'Te asignaron una tarea', body: `${actorName} te asignó "${taskTitle}"` };
    case 'task_mentioned':
      return { type: 'mentioned', title: 'Te mencionaron en un comentario', body: `En "${taskTitle}": ${(d.commentText as string) || ''}`.slice(0, 200) };
    case 'status_changed':
      return { type: 'status_changed', title: 'Una tarea cambió de estado', body: `"${taskTitle}" ahora está en "${(d.statusAfter as string) || '—'}"` };
    case 'due_soon':
      return { type: 'due_soon', title: 'Tarea por vencer', body: `"${taskTitle}" vence pronto` };
    case 'comment_added':
      return { type: 'comment_added', title: 'Nuevo comentario', body: `${actorName} comentó en "${taskTitle}"` };
    case 'project_created':
      return { type: 'project_created', title: 'Nuevo proyecto', body: `Se creó el proyecto "${(d.projectName as string) || taskTitle}"` };
    case 'member_invited':
      return { type: 'member_invited', title: 'Te invitaron a una organización', body: `${actorName} te invitó a unirte` };
    case 'task_completed':
      return { type: 'task_completed', title: 'Tarea completada', body: `"${taskTitle}" se marcó como completada` };
  }
}

async function createInAppNotification(supabase: TypedSupabaseClient, event: NotificationEvent): Promise<void> {
  const { type, title, body } = buildInAppText(event);
  const { error } = await supabase.from('notifications').insert({
    tenant_id: event.organizationId,
    user_id: event.userId,
    type,
    title,
    body,
    related_task_id: event.taskId || null,
    actor_id: event.actorId || null,
  });
  if (error) throw new Error(`Failed to create in-app notification: ${error.message}`);
}

async function sendEmailNotification(supabase: TypedSupabaseClient, event: NotificationEvent): Promise<void> {
  const [{ data: recipient }, { data: org }] = await Promise.all([
    supabase.from('profiles').select('full_name, email').eq('id', event.userId).maybeSingle(),
    supabase.from('organizations').select('name').eq('id', event.organizationId).maybeSingle(),
  ]);

  if (!recipient?.email) {
    throw new Error(`No email on file for user ${event.userId}`);
  }

  const d = event.data;
  const props: TemplateProps = {
    recipientName: recipient.full_name || recipient.email,
    organizationName: org?.name || (d.organizationName as string) || 'tu organización',
    taskTitle: (d.taskTitle as string) || '',
    taskUrl: event.taskId ? buildTaskUrl(event.taskId, event.organizationId) : (d.taskUrl as string) || '#',
    actorName: d.actorName as string | undefined,
    actorAvatarUrl: d.actorAvatarUrl as string | undefined,
    dueDate: d.dueDate as string | undefined,
    statusBefore: d.statusBefore as string | undefined,
    statusAfter: d.statusAfter as string | undefined,
    commentText: d.commentText as string | undefined,
    projectName: d.projectName as string | undefined,
    invitationAcceptUrl: d.invitationAcceptUrl as string | undefined,
    customData: d,
  };

  const { subject, html, text } = await getEmailContent(event.type, props);
  await sendEmail({ to: recipient.email, subject, html, text });
}

export interface SendNotificationOptions {
  /** Restrict delivery to these channels only (still gated by user preferences). */
  channels?: Channel[];
}

/**
 * Send a notification for an event: email and/or in-app, per the user's
 * preferences. Best-effort — logs and records failed_jobs on error rather
 * than throwing, so a notification failure never breaks the caller's
 * underlying action.
 */
export async function sendNotification(
  eventInput: unknown,
  options: SendNotificationOptions = {}
): Promise<void> {
  const event = validateEvent(eventInput);
  if (!event) return;

  const supabase = getServiceClient();
  const wanted = new Set(options.channels ?? ['email', 'in_app']);

  const preferences = await getUserPreferences(supabase, event.userId, event.organizationId, event.type);

  if (wanted.has('email') && preferences.emailEnabled) {
    try {
      await sendEmailNotification(supabase, event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Email notification failed', { event, error: message });
      await recordFailedJob(supabase, event.type, event.userId, `Email: ${message}`);
    }
  }

  if (wanted.has('in_app') && preferences.inAppEnabled) {
    try {
      await createInAppNotification(supabase, event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('In-app notification failed', { event, error: message });
      await recordFailedJob(supabase, event.type, event.userId, `InApp: ${message}`);
    }
  }
}
