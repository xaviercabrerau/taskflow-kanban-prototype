/**
 * Gmail Reply Webhook Handler
 * Receives Pub/Sub messages from Google Cloud with email replies
 * Extracts commands and updates tasks accordingly (Task 10)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseGmailCommand } from '@/lib/notifications/gmail';
import type { Database } from '@/lib/supabase/database.types';

// ============================================================================
// Types
// ============================================================================

/**
 * Google Cloud Pub/Sub message wrapper
 */
interface PubSubMessage {
  message: {
    data: string; // base64-encoded JSON
    messageId: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

/**
 * Decoded email data from Pub/Sub message
 */
interface EmailData {
  messageId: string;
  from: string;
  textBody: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Decodes base64 Pub/Sub message data
 * @param data - base64-encoded string
 * @returns Decoded JSON object
 * @throws Error if decoding fails
 */
function decodePubSubMessage(data: string): EmailData {
  try {
    const decoded = Buffer.from(data, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return parsed as EmailData;
  } catch (error) {
    throw new Error(
      `Failed to decode Pub/Sub message: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

/**
 * Verifies the authenticity of a Pub/Sub message
 * For now, this is a placeholder for Google Cloud signature verification
 * In production, verify the Authorization header contains a valid JWT from Google
 * @param req - NextRequest object
 * @returns true if signature is valid, false otherwise
 */
function verifyPubSubSignature(_req: NextRequest): boolean {
  void _req;
  // TODO: Implement actual Google Cloud Pub/Sub signature verification
  // For now, we accept all requests (should be restricted to Google's IP ranges in production)
  // In production, verify:
  // 1. Authorization header contains a JWT
  // 2. JWT is signed by Google
  // 3. JWT's aud claim matches your endpoint URL
  return true;
}

/**
 * Retrieves Supabase client with service role for server-side operations
 * @returns Typed Supabase client
 */
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }

  return createClient<Database>(url, key);
}

/**
 * Logs a failed job to the failed_jobs table
 * @param supabase - Supabase client
 * @param errorMessage - Description of the failure
 * @param eventType - Optional event type being processed
 * @param userId - Optional user ID related to the failure
 */
async function logFailedJob(
  supabase: ReturnType<typeof getSupabaseClient>,
  errorMessage: string,
  eventType?: string,
  userId?: string
): Promise<void> {
  try {
    await supabase.from('failed_jobs').insert({
      event_type: eventType || null,
      user_id: userId || null,
      error_message: errorMessage,
      retry_count: 0,
    });
  } catch (error) {
    // Log but don't throw - we've already determined the request failed
    console.error('Failed to log failed job:', error);
  }
}

/**
 * Finds a task by email thread message ID
 * @param supabase - Supabase client
 * @param messageId - Gmail message ID
 * @returns Task object with related data, or null if not found
 */
async function findTaskByMessageId(
  supabase: ReturnType<typeof getSupabaseClient>,
  messageId: string
) {
  const { data: thread } = await supabase
    .from('email_threads')
    .select('task_id, user_id')
    .eq('message_id', messageId)
    .single();

  if (!thread) {
    return null;
  }

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', thread.task_id)
    .single();

  return {
    task,
    taskId: thread.task_id,
    userId: thread.user_id,
  };
}

/**
 * Finds a board column by status key or label
 * @param supabase - Supabase client
 * @param boardId - Board ID
 * @param statusValue - Status key or label to match
 * @returns Column ID if found, null otherwise
 */
async function findColumnByStatus(
  supabase: ReturnType<typeof getSupabaseClient>,
  boardId: string,
  statusValue: string
) {
  // Try to find by key first (exact match)
  const { data: byKey } = await supabase
    .from('board_columns')
    .select('id')
    .eq('board_id', boardId)
    .eq('key', statusValue.toLowerCase())
    .single();

  if (byKey) {
    return byKey.id;
  }

  // Try to find by label (case-insensitive)
  const { data: byLabel } = await supabase
    .from('board_columns')
    .select('id')
    .eq('board_id', boardId)
    .ilike('label', statusValue)
    .single();

  if (byLabel) {
    return byLabel.id;
  }

  return null;
}

/**
 * Finds the "done" status column (marked with is_done_state = true)
 * @param supabase - Supabase client
 * @param boardId - Board ID
 * @returns Column ID if found, null otherwise
 */
async function findDoneColumn(
  supabase: ReturnType<typeof getSupabaseClient>,
  boardId: string
) {
  const { data } = await supabase
    .from('board_columns')
    .select('id')
    .eq('board_id', boardId)
    .eq('is_done_state', true)
    .single();

  return data?.id || null;
}

/**
 * Creates a comment on a task
 * @param supabase - Supabase client
 * @param taskId - Task ID
 * @param userId - User ID of commenter
 * @param text - Comment text
 */
async function createTaskComment(
  supabase: ReturnType<typeof getSupabaseClient>,
  taskId: string,
  userId: string,
  text: string
): Promise<void> {
  await supabase.from('comments').insert({
    task_id: taskId,
    author_id: userId,
    body: text,
    source: 'email',
  });
}

/**
 * Updates a task's column (status)
 * @param supabase - Supabase client
 * @param taskId - Task ID
 * @param columnId - New column ID
 */
async function updateTaskColumn(
  supabase: ReturnType<typeof getSupabaseClient>,
  taskId: string,
  columnId: string
): Promise<void> {
  await supabase
    .from('tasks')
    .update({ column_id: columnId, updated_at: new Date().toISOString() })
    .eq('id', taskId);
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * POST /api/webhooks/gmail-reply
 * Receives Pub/Sub messages from Google Cloud with email reply data
 * Processes the email to extract commands and update tasks
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    // Verify signature
    if (!verifyPubSubSignature(req)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Parse request body
    let body: PubSubMessage;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON' },
        { status: 400 }
      );
    }

    // Validate Pub/Sub message structure
    if (!body.message || !body.message.data || !body.message.messageId) {
      return NextResponse.json(
        { error: 'Missing required fields in Pub/Sub message' },
        { status: 400 }
      );
    }

    // Decode message
    let emailData: EmailData;
    try {
      emailData = decodePubSubMessage(body.message.data);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const supabase = getSupabaseClient();
      await logFailedJob(supabase, `Decoding error: ${errorMsg}`);
      return NextResponse.json(
        { error: 'Failed to decode message' },
        { status: 400 }
      );
    }

    // Validate decoded data
    if (!emailData.messageId || !emailData.from || !emailData.textBody) {
      const supabase = getSupabaseClient();
      await logFailedJob(
        supabase,
        'Decoded message missing required fields: messageId, from, or textBody'
      );
      return NextResponse.json(
        { error: 'Missing required fields in email data' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Find task by message ID
    const result = await findTaskByMessageId(supabase, emailData.messageId);
    if (!result) {
      await logFailedJob(
        supabase,
        `No task found for message ID: ${emailData.messageId}`
      );
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    const { task, taskId, userId } = result;

    if (!task) {
      await logFailedJob(
        supabase,
        `Task data missing for task ID: ${taskId}`,
        undefined,
        userId
      );
      return NextResponse.json(
        { error: 'Task data invalid' },
        { status: 404 }
      );
    }

    // Parse email command
    const parsed = parseGmailCommand(emailData.textBody);

    // If no command found, log and return success (processed, no action)
    if (parsed.command === null) {
      // For consistency, log this but don't mark as failed
      // The email was processed; just no structured command was found
      console.log(
        `No command found in email reply for task ${taskId}. Email text: ${emailData.textBody.substring(0, 100)}`
      );
      return NextResponse.json(
        { processed: true, command: null },
        { status: 200 }
      );
    }

    // Process command
    try {
      switch (parsed.command) {
        case 'done': {
          // Find done column and update task
          const doneColumnId = await findDoneColumn(supabase, task.board_id);
          if (!doneColumnId) {
            await logFailedJob(
              supabase,
              `No "done" column found for board ${task.board_id}`,
              'task_completed',
              userId
            );
            return NextResponse.json(
              { error: 'Done column not found' },
              { status: 500 }
            );
          }
          await updateTaskColumn(supabase, taskId, doneColumnId);
          break;
        }

        case 'status': {
          // Find column by status value and update task
          if (!parsed.commandValue) {
            await logFailedJob(
              supabase,
              `Status command missing value for task ${taskId}`,
              'status_changed',
              userId
            );
            return NextResponse.json(
              { error: 'Status value required' },
              { status: 400 }
            );
          }
          const columnId = await findColumnByStatus(
            supabase,
            task.board_id,
            parsed.commandValue
          );
          if (!columnId) {
            await logFailedJob(
              supabase,
              `Status "${parsed.commandValue}" not found for board ${task.board_id}`,
              'status_changed',
              userId
            );
            return NextResponse.json(
              { error: 'Status not found' },
              { status: 400 }
            );
          }
          await updateTaskColumn(supabase, taskId, columnId);
          break;
        }

        case 'comment': {
          // Create comment on task
          if (!parsed.commandValue) {
            await logFailedJob(
              supabase,
              `Comment command missing text for task ${taskId}`,
              'comment_added',
              userId
            );
            return NextResponse.json(
              { error: 'Comment text required' },
              { status: 400 }
            );
          }
          await createTaskComment(supabase, taskId, userId, parsed.commandValue);
          break;
        }

        default:
          // Exhaustive check (should never reach here)
          const exhaustiveCheck: never = parsed.command;
          return exhaustiveCheck;
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown error';
      await logFailedJob(
        supabase,
        `Failed to process ${parsed.command} command: ${errorMsg}`,
        parsed.command === 'done'
          ? 'task_completed'
          : parsed.command === 'status'
            ? 'status_changed'
            : 'comment_added',
        userId
      );
      return NextResponse.json(
        { error: 'Failed to process command' },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;
    return NextResponse.json(
      {
        processed: true,
        command: parsed.command,
        duration,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Gmail webhook error:', errorMsg);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
