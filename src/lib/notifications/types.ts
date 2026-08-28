/**
 * TaskFlow Notification System - Type Definitions
 * Central type definitions for notification system components (Tasks 3-7)
 * Database schemas mirror these types (snake_case conversion handled in DB layer)
 */

// ============================================================================
// Core Event Types
// ============================================================================

/**
 * Event types that trigger notifications across the system.
 * Used by emitter, processor, and API routes.
 */
export type EventType =
  | 'task_assigned'
  | 'task_mentioned'
  | 'status_changed'
  | 'due_soon'
  | 'comment_added'
  | 'project_created'
  | 'member_invited'
  | 'task_completed';

/**
 * Delivery channels for notifications.
 * 'email': sends via Gmail API
 * 'in_app': stored in notifications table
 */
export type Channel = 'email' | 'in_app';

// ============================================================================
// Event Emission and Job Queuing
// ============================================================================

/**
 * NotificationEvent
 * Emitted by application routes/handlers to trigger notification pipeline.
 * Task 3 (emitter) consumes these events and enqueues jobs.
 */
export interface NotificationEvent {
  /** Type of event that triggered the notification */
  type: EventType;

  /** UUID of user who should receive notification */
  userId: string;

  /** UUID of organization context */
  organizationId: string;

  /** UUID of task (optional for non-task events like project_created) */
  taskId?: string;

  /** UUID of user who triggered the event */
  actorId?: string;

  /**
   * Event-specific data (task title, comment text, status, etc.)
   * Structure depends on eventType
   */
  data: Record<string, unknown>;
}

// ============================================================================
// Database Models
// ============================================================================

/**
 * NotificationPreference
 * User notification settings per event type and channel.
 * Stored in notification_preferences table.
 * Task 3 (emitter) reads these to determine which jobs to queue.
 */
export interface NotificationPreference {
  /** UUID primary key */
  id: string;

  /** UUID of user (references auth.users) */
  userId: string;

  /** UUID of organization (references organizations) */
  organizationId: string;

  /** Type of event this preference applies to */
  eventType: EventType;

  /** Delivery channel */
  channel: Channel;

  /** Whether notifications are enabled for this combination */
  enabled: boolean;

  /** Timestamp when preference was created */
  createdAt: Date;

  /** Timestamp when preference was last updated */
  updatedAt: Date;
}

/**
 * Notification
 * In-app notification record stored in notifications table.
 * Task 4 (processor) creates these for 'in_app' channel events.
 * Task 8+ (API) reads these for notification feeds.
 */
export interface Notification {
  /** UUID primary key */
  id: string;

  /** UUID of user who receives notification */
  userId: string;

  /** UUID of organization */
  organizationId: string;

  /** Type of event that generated this notification */
  eventType: EventType;

  /** UUID of task (optional, null for non-task events) */
  taskId?: string;

  /** UUID of user who triggered the event */
  actorId?: string;

  /** Rendered notification message displayed to user */
  message: string;

  /** Whether user has marked this notification as read */
  read: boolean;

  /** Timestamp when notification was created */
  createdAt: Date;
}

/**
 * EmailThread
 * Tracks Gmail message threads for reply threading and conversation grouping.
 * Stored in email_threads table.
 * Task 7 (Gmail) reads/writes these to maintain thread continuity.
 */
export interface EmailThread {
  /** UUID primary key */
  id: string;

  /** UUID of task this email relates to */
  taskId: string;

  /** UUID of user who received the email */
  userId: string;

  /** Gmail Message-ID header value (unique identifier per email) */
  messageId: string;

  /** Gmail thread ID for conversation grouping (optional, populated by Gmail API) */
  gmailThreadId?: string;

  /** Timestamp when thread record was created */
  createdAt: Date;
}

/**
 * FailedJob
 * Audit trail of failed notification jobs for debugging and retry.
 * Stored in failed_jobs table.
 * Task 4 (processor) writes these when job processing fails.
 * Task 8+ (observability) reads these for monitoring/alerting.
 */
export interface FailedJob {
  /** UUID primary key */
  id: string;

  /** Type of event that failed (optional if error during job parsing) */
  eventType?: EventType;

  /** UUID of affected user (optional if error during job parsing) */
  userId?: string;

  /** Error message describing why job failed */
  errorMessage: string;

  /** Number of retry attempts made (0 = no retries yet) */
  retryCount: number;

  /** Timestamp when failure was recorded */
  createdAt: Date;
}

// ============================================================================
// Gmail API Integration
// ============================================================================

/**
 * EmailPayload
 * Email message data for sending via Gmail API.
 * Task 5 (email layouts) creates these payload objects.
 * Task 7 (Gmail) sends these via Gmail API.
 */
export interface EmailPayload {
  /** Recipient email address */
  to: string;

  /** Email subject line */
  subject: string;

  /** HTML version of email body */
  htmlBody: string;

  /** Plain text version of email body (fallback) */
  textBody: string;

  /**
   * Custom Message-ID header for reply threading.
   * Format: <taskId.uuid@taskflow.local> for uniqueness.
   */
  messageId: string;

  /** Gmail thread ID for reply grouping (optional, used for replies) */
  threadId?: string;
}

/**
 * ParsedReply
 * Parsed structure of a received email reply, used for command processing.
 * Task 7 (Gmail) creates these when parsing incoming emails.
 * Task 8+ (API) uses these to execute commands (mark done, comment, status).
 */
export interface ParsedReply {
  /**
   * Parsed command from email body, or null if plain text.
   * - 'done': user marked task as complete
   * - 'comment': user added a comment
   * - 'status': user changed task status
   * - null: no structured command, treat as plain comment
   */
  command: 'done' | 'comment' | 'status' | null;

  /** Command value/parameter (e.g., comment text or new status) */
  commandValue?: string;

  /** Full text of email body (raw reply content) */
  fullText: string;
}
