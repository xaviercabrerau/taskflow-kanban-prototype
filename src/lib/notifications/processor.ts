/**
 * TaskFlow Notification System - BullMQ Job Processor
 * Task 4: Core job processor for notification delivery
 *
 * Consumes notification jobs from the queue and:
 * 1. Validates job structure
 * 2. Checks user notification preferences
 * 3. Sends emails (via Task 5 implementation)
 * 4. Creates in-app notifications
 * 5. Records failed jobs for debugging
 *
 * Handles retries via BullMQ configuration (3 attempts, exponential backoff)
 */

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import type {
  NotificationJob,
  Notification,
  EmailThread,
  FailedJob,
  EmailPayload,
  EventType,
} from './types';

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_NAME = 'notifications:queue';
const WORKER_CONCURRENCY = 5; // Handle 5 jobs concurrently

// Type alias for typed Supabase client
type TypedSupabaseClient = ReturnType<typeof createClient<Database>>;

// ============================================================================
// Database Access Helpers
// ============================================================================

/**
 * Get Supabase client instance for database operations.
 * Uses environment variables for connection (set via Vercel integration).
 */
function getSupabaseClient(): TypedSupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Supabase configuration missing: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  return createClient<Database>(supabaseUrl, supabaseKey);
}

/**
 * Get Redis connection URL for BullMQ.
 * Supports both Vercel KV and standard Redis.
 */
function getRedisUrl(): string {
  const redisUrl = process.env.KV_URL || process.env.KV_REST_API_URL || process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error(
      'Redis configuration missing: KV_URL, KV_REST_API_URL, or REDIS_URL not set'
    );
  }

  return redisUrl;
}

// ============================================================================
// User Preference Checking
// ============================================================================

/**
 * Fetch user's notification preferences for a specific event type.
 * Returns enabled channels (email, in_app, or both).
 */
async function getUserPreferences(
  supabase: TypedSupabaseClient,
  userId: string,
  organizationId: string,
  eventType: string
): Promise<{ emailEnabled: boolean; inAppEnabled: boolean }> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('channel, enabled')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('event_type', eventType);

  if (error) {
    console.error('Failed to fetch user preferences', {
      userId,
      organizationId,
      eventType,
      error: error.message,
    });
    throw error;
  }

  // Default: both channels enabled if no preferences found
  let emailEnabled = true;
  let inAppEnabled = true;

  // Process preferences
  if (data && data.length > 0) {
    // Reset to disabled by default, then enable based on preferences
    emailEnabled = false;
    inAppEnabled = false;

    for (const pref of data) {
      if (pref.enabled) {
        if (pref.channel === 'email') {
          emailEnabled = true;
        } else if (pref.channel === 'in_app') {
          inAppEnabled = true;
        }
      }
    }
  }

  return { emailEnabled, inAppEnabled };
}

// ============================================================================
// Email Sending (Stub for Task 5)
// ============================================================================

/**
 * Stub email sending function.
 * Task 5 will implement proper email layout and template rendering.
 * Task 7 will implement Gmail API sending.
 *
 * For now, returns a success EmailPayload for testing.
 */
async function sendNotificationEmail(job: NotificationJob): Promise<EmailPayload> {
  // Stub implementation: return a basic email payload
  // In production (Task 5 + 7), this will:
  // 1. Render email template based on eventType
  // 2. Send via Gmail API
  // 3. Return message ID for thread tracking

  const messageId = `<${job.taskId || job.userId}.${Date.now()}@taskflow.local>`;

  const emailPayload: EmailPayload = {
    to: 'user@example.com', // Will be fetched from user profile in Task 5
    subject: `TaskFlow Notification: ${job.eventType}`,
    htmlBody: `<p>Event: ${job.eventType}</p>`,
    textBody: `Event: ${job.eventType}`,
    messageId,
  };

  // Log that email was sent (stub)
  console.info('Email sent (stub)', {
    jobId: job.userId,
    eventType: job.eventType,
    messageId,
  });

  return emailPayload;
}

// ============================================================================
// Notification Recording
// ============================================================================

/**
 * Create an in-app notification record in the database.
 * Stores the notification for viewing in the app's notification feed.
 */
async function createInAppNotification(
  supabase: TypedSupabaseClient,
  job: NotificationJob,
  message: string
): Promise<Notification> {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: job.userId,
      organization_id: job.organizationId,
      event_type: job.eventType,
      task_id: job.taskId || null,
      actor_id: job.actorId || null,
      message,
      read: false,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create in-app notification', {
      userId: job.userId,
      eventType: job.eventType,
      error: error.message,
    });
    throw error;
  }

  // Map database row to Notification interface
  const notification: Notification = {
    id: data.id,
    userId: data.user_id,
    organizationId: data.organization_id,
    eventType: data.event_type as EventType,
    taskId: data.task_id || undefined,
    actorId: data.actor_id || undefined,
    message: data.message,
    read: data.read,
    createdAt: new Date(data.created_at),
  };

  return notification;
}

/**
 * Create an email thread record for Gmail conversation tracking.
 * Used by Task 7 (Gmail) to maintain thread continuity for replies.
 */
async function createEmailThread(
  supabase: TypedSupabaseClient,
  taskId: string,
  userId: string,
  messageId: string
): Promise<EmailThread> {
  const { data, error } = await supabase
    .from('email_threads')
    .insert({
      task_id: taskId,
      user_id: userId,
      message_id: messageId,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create email thread record', {
      taskId,
      userId,
      messageId,
      error: error.message,
    });
    throw error;
  }

  const emailThread: EmailThread = {
    id: data.id,
    taskId: data.task_id,
    userId: data.user_id,
    messageId: data.message_id,
    gmailThreadId: data.gmail_thread_id || undefined,
    createdAt: new Date(data.created_at),
  };

  return emailThread;
}

/**
 * Record a failed notification job for auditing and debugging.
 * Used for monitoring failed jobs and implementing retry logic.
 */
async function recordFailedJob(
  supabase: TypedSupabaseClient,
  eventType: string | undefined,
  userId: string | undefined,
  errorMessage: string,
  retryCount: number
): Promise<FailedJob> {
  const { data, error } = await supabase
    .from('failed_jobs')
    .insert({
      event_type: eventType || null,
      user_id: userId || null,
      error_message: errorMessage,
      retry_count: retryCount,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to record failed job', {
      eventType,
      userId,
      error: error.message,
    });
    // Don't throw - just log since this is error recovery
    return {
      id: 'error',
      eventType: eventType as EventType | undefined,
      userId,
      errorMessage,
      retryCount,
      createdAt: new Date(),
    };
  }

  const failedJob: FailedJob = {
    id: data.id,
    eventType: (data.event_type as EventType | null) || undefined,
    userId: data.user_id || undefined,
    errorMessage: data.error_message,
    retryCount: data.retry_count,
    createdAt: new Date(data.created_at),
  };

  return failedJob;
}

// ============================================================================
// Job Validation
// ============================================================================

/**
 * Validate that a job matches NotificationJob schema.
 * Throws if invalid.
 */
function validateJob(job: unknown): asserts job is NotificationJob {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw new Error('Invalid job: not an object');
  }

  const j = job as Record<string, unknown>;

  // Validate required fields
  if (typeof j.eventType !== 'string' || !j.eventType) {
    throw new Error('Invalid job: missing or invalid eventType');
  }

  if (typeof j.userId !== 'string' || !j.userId) {
    throw new Error('Invalid job: missing or invalid userId');
  }

  if (typeof j.organizationId !== 'string' || !j.organizationId) {
    throw new Error('Invalid job: missing or invalid organizationId');
  }

  if (typeof j.eventData !== 'object' || j.eventData === null) {
    throw new Error('Invalid job: missing or invalid eventData');
  }

  if (typeof j.attempt !== 'number' || j.attempt < 0) {
    throw new Error('Invalid job: missing or invalid attempt counter');
  }

  if (typeof j.enqueuedAt !== 'number' || j.enqueuedAt < 0) {
    throw new Error('Invalid job: missing or invalid enqueuedAt');
  }
}

// ============================================================================
// Main Job Handler
// ============================================================================

/**
 * Process a single notification job from the queue.
 *
 * Flow:
 * 1. Validate job structure
 * 2. Check user preferences for email/in_app channels
 * 3. If preferences disabled, return early
 * 4. Send email if channel enabled
 * 5. Create in-app notification if channel enabled
 * 6. Handle errors gracefully:
 *    - Log errors
 *    - Record failed jobs
 *    - Throw to trigger BullMQ retry
 */
async function jobHandler(job: Job<NotificationJob>): Promise<void> {
  // Validate job structure
  try {
    validateJob(job.data);
  } catch (validationError) {
    const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
    console.error('Job validation failed', {
      jobId: job.id,
      error: errorMessage,
    });

    // Record failure and throw for retry
    const supabase = getSupabaseClient();
    await recordFailedJob(supabase, undefined, undefined, `Validation: ${errorMessage}`, job.attemptsMade || 0);
    throw validationError;
  }

  const jobData = job.data;
  const supabase = getSupabaseClient();

  try {
    // Check user notification preferences
    console.debug('Checking user preferences', {
      userId: jobData.userId,
      organizationId: jobData.organizationId,
      eventType: jobData.eventType,
    });

    const preferences = await getUserPreferences(
      supabase,
      jobData.userId,
      jobData.organizationId,
      jobData.eventType
    );

    // If all channels disabled, skip and return success
    if (!preferences.emailEnabled && !preferences.inAppEnabled) {
      console.info('Notification skipped: all channels disabled', {
        jobId: job.id,
        userId: jobData.userId,
        eventType: jobData.eventType,
      });
      return;
    }

    // Send email if enabled
    if (preferences.emailEnabled) {
      try {
        console.info('Sending email notification', {
          jobId: job.id,
          userId: jobData.userId,
          eventType: jobData.eventType,
        });

        const emailPayload = await sendNotificationEmail(jobData);

        // Create email thread record for reply tracking (if taskId exists)
        if (jobData.taskId) {
          await createEmailThread(supabase, jobData.taskId, jobData.userId, emailPayload.messageId);

          console.info('Email thread recorded', {
            jobId: job.id,
            taskId: jobData.taskId,
            messageId: emailPayload.messageId,
          });
        }
      } catch (emailError) {
        const errorMessage = emailError instanceof Error ? emailError.message : String(emailError);
        console.error('Email delivery failed', {
          jobId: job.id,
          userId: jobData.userId,
          error: errorMessage,
        });

        // Record failure
        await recordFailedJob(
          supabase,
          jobData.eventType,
          jobData.userId,
          `Email: ${errorMessage}`,
          job.attemptsMade || 0
        );

        // Throw to trigger retry
        throw emailError;
      }
    }

    // Create in-app notification if enabled
    if (preferences.inAppEnabled) {
      try {
        const message = `Notification: ${jobData.eventType} for user ${jobData.userId}`;

        console.info('Creating in-app notification', {
          jobId: job.id,
          userId: jobData.userId,
          eventType: jobData.eventType,
        });

        await createInAppNotification(supabase, jobData, message);

        console.info('In-app notification created', {
          jobId: job.id,
          userId: jobData.userId,
          eventType: jobData.eventType,
        });
      } catch (inAppError) {
        const errorMessage = inAppError instanceof Error ? inAppError.message : String(inAppError);
        console.error('In-app notification creation failed', {
          jobId: job.id,
          userId: jobData.userId,
          error: errorMessage,
        });

        // Record failure
        await recordFailedJob(
          supabase,
          jobData.eventType,
          jobData.userId,
          `InApp: ${errorMessage}`,
          job.attemptsMade || 0
        );

        // Throw to trigger retry
        throw inAppError;
      }
    }

    // Success!
    console.info('Notification job completed successfully', {
      jobId: job.id,
      userId: jobData.userId,
      eventType: jobData.eventType,
      emailSent: preferences.emailEnabled,
      inAppCreated: preferences.inAppEnabled,
    });
  } catch (error) {
    // Catch-all for unexpected errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Unexpected error in job handler', {
      jobId: job.id,
      userId: jobData.userId,
      error: errorMessage,
    });

    // Record failure
    await recordFailedJob(
      supabase,
      jobData.eventType,
      jobData.userId,
      `Unexpected: ${errorMessage}`,
      job.attemptsMade || 0
    );

    // Rethrow for retry
    throw error;
  }
}

// ============================================================================
// Worker Creation and Management
// ============================================================================

/**
 * Create and start the BullMQ worker for processing notification jobs.
 *
 * The worker:
 * - Consumes jobs from notifications:queue
 * - Processes up to 5 jobs concurrently
 * - Logs completion/failure events
 * - Handles retries via job options (3 attempts, exponential backoff)
 *
 * Must be called once on application startup.
 * Returns the worker instance for graceful shutdown.
 */
export async function createNotificationWorker(): Promise<Worker<NotificationJob>> {
  const redisUrl = getRedisUrl();

  const worker = new Worker<NotificationJob>(QUEUE_NAME, jobHandler, {
    connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }),
    concurrency: WORKER_CONCURRENCY,
  });

  // Event listeners for monitoring
  worker.on('completed', (job) => {
    console.info('Notification job completed', {
      jobId: job.id,
      eventType: (job.data as NotificationJob).eventType,
    });
  });

  worker.on('failed', (job, error) => {
    console.warn('Notification job failed (will retry)', {
      jobId: job?.id,
      eventType: job?.data?.eventType,
      error: error.message,
      attempts: job?.attemptsMade || 0,
    });
  });

  worker.on('error', (error) => {
    console.error('Worker error', {
      error: error.message,
    });
  });

  console.info('Notification worker created and started', {
    queueName: QUEUE_NAME,
    concurrency: WORKER_CONCURRENCY,
  });

  return worker;
}

// ============================================================================
// Exports for Testing and Usage
// ============================================================================

// Export for testing purposes
export {
  jobHandler,
  getUserPreferences,
  sendNotificationEmail,
  createInAppNotification,
  createEmailThread,
  recordFailedJob,
  validateJob,
};
