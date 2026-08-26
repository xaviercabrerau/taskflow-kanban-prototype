/**
 * TaskFlow Notification System - Event Emitter
 * Task 3: Core event emission and job queueing
 *
 * Validates notification events and enqueues them to BullMQ for processing.
 * Entry point for application routes to trigger the notification pipeline.
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { EventType, NotificationEvent, NotificationJob } from './types';

// ============================================================================
// Queue Configuration
// ============================================================================

const QUEUE_NAME = 'notifications:queue';
let notificationQueue: Queue<NotificationJob> | null = null;

/**
 * Get or create the notification queue.
 * Uses Vercel KV (Redis) as the backend for BullMQ via environment variables.
 * Requires: KV_URL environment variable (Vercel KV connection string).
 */
function getNotificationQueue(): Queue<NotificationJob> {
  if (!notificationQueue) {
    const redisUrl = process.env.KV_URL || process.env.KV_REST_API_URL;

    if (!redisUrl) {
      throw new Error(
        'Notification queue not configured: KV_URL or KV_REST_API_URL is not set. ' +
        'Configure Vercel KV integration or Redis connection URL.'
      );
    }

    // BullMQ accepts a Redis connection URL string or ConnectionOptions
    // Using URL string with lazyConnect to defer connection until needed
    notificationQueue = new Queue<NotificationJob>(QUEUE_NAME, {
      connection: new IORedis(redisUrl),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  return notificationQueue;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Valid event types that can be emitted.
 */
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

/**
 * Validates a UUID v4 string.
 * Simple check: 36 chars, 8-4-4-4-12 format with hyphens.
 */
function isValidUuid(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Validates that an event conforms to NotificationEvent schema.
 *
 * @param event - Unknown value to validate
 * @returns Valid NotificationEvent or null if invalid
 *
 * Validation rules:
 * - type must be one of 8 EventType values
 * - userId and organizationId must be valid UUIDs
 * - taskId (if present) must be valid UUID
 * - actorId (if present) must be valid UUID
 * - data must be an object
 */
export function validateEvent(event: unknown): NotificationEvent | null {
  // Check if event is an object
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    console.warn('Event validation failed: event is not an object');
    return null;
  }

  const evt = event as Record<string, unknown>;

  // Validate type
  if (!evt.type || !VALID_EVENT_TYPES.includes(evt.type as EventType)) {
    console.warn(`Event validation failed: invalid event type "${evt.type}"`);
    return null;
  }

  // Validate required UUID fields
  if (!isValidUuid(evt.userId)) {
    console.warn(`Event validation failed: invalid userId "${evt.userId}"`);
    return null;
  }

  if (!isValidUuid(evt.organizationId)) {
    console.warn(`Event validation failed: invalid organizationId "${evt.organizationId}"`);
    return null;
  }

  // Validate optional UUID fields
  if (evt.taskId !== undefined && !isValidUuid(evt.taskId)) {
    console.warn(`Event validation failed: invalid taskId "${evt.taskId}"`);
    return null;
  }

  if (evt.actorId !== undefined && !isValidUuid(evt.actorId)) {
    console.warn(`Event validation failed: invalid actorId "${evt.actorId}"`);
    return null;
  }

  // Validate data is an object
  if (!evt.data || typeof evt.data !== 'object' || Array.isArray(evt.data)) {
    console.warn('Event validation failed: data is not an object');
    return null;
  }

  // Build and return validated event
  const validatedEvent: NotificationEvent = {
    type: evt.type as EventType,
    userId: evt.userId as string,
    organizationId: evt.organizationId as string,
    data: evt.data as Record<string, unknown>,
  };

  // Add optional fields if present
  if (evt.taskId !== undefined) {
    validatedEvent.taskId = evt.taskId as string;
  }

  if (evt.actorId !== undefined) {
    validatedEvent.actorId = evt.actorId as string;
  }

  return validatedEvent;
}

// ============================================================================
// Job Enqueueing
// ============================================================================

/**
 * Enqueues a notification event to the BullMQ queue for processing.
 *
 * @param event - NotificationEvent to enqueue
 * @returns Job ID for tracking, or null if enqueueing failed
 *
 * Behavior:
 * 1. Validates event against NotificationEvent schema
 * 2. Converts to NotificationJob (adds timestamp, attempt counter)
 * 3. Enqueues to BullMQ
 * 4. Returns job ID for tracking
 * 5. Handles errors gracefully (logs, doesn't throw)
 *
 * Main API for routes to emit notification events.
 * Non-blocking; returns immediately.
 */
export async function enqueueNotificationJob(event: NotificationEvent): Promise<string | null> {
  // Validate event
  const validatedEvent = validateEvent(event);
  if (!validatedEvent) {
    console.error('Failed to enqueue notification: event validation failed', { event });
    return null;
  }

  // Convert NotificationEvent to NotificationJob
  const job: NotificationJob = {
    eventType: validatedEvent.type,
    userId: validatedEvent.userId,
    organizationId: validatedEvent.organizationId,
    taskId: validatedEvent.taskId,
    actorId: validatedEvent.actorId,
    eventData: validatedEvent.data,
    enqueuedAt: Date.now(),
    attempt: 0,
  };

  try {
    // Get or create queue
    const queue = getNotificationQueue();

    // Enqueue job
    const enqueuedJob = await queue.add(`notification-${validatedEvent.type}`, job, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    console.info('Notification job enqueued', {
      jobId: enqueuedJob.id,
      eventType: validatedEvent.type,
      userId: validatedEvent.userId,
    });

    return enqueuedJob.id || null;
  } catch (error) {
    // Log error but don't throw - graceful degradation
    console.error('Failed to enqueue notification job', {
      event: validatedEvent,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
