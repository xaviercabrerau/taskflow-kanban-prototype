/**
 * Gmail API Integration for Notification System
 * Handles sending emails via Gmail API and parsing email replies for commands
 * Task 7 Implementation
 */

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { EmailPayload, ParsedReply } from './types';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

/**
 * Properties for sending a notification email
 */
export interface SendEmailProps {
  /** Recipient email address */
  to: string;
  /** Email subject line */
  subject: string;
  /** HTML version of email body */
  htmlBody: string;
  /** Plain text version of email body */
  textBody: string;
  /** Optional task ID for email threading */
  taskId?: string;
  /** Optional user ID for logging */
  userId?: string;
  /** Optional organization ID for context */
  organizationId?: string;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates an email address using simple regex pattern
 * @param email - Email address to validate
 * @returns true if email format is valid, false otherwise
 */
export function validateEmailAddress(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ============================================================================
// Gmail API Client Functions
// ============================================================================

/**
 * Sends a notification email via Gmail API
 * Handles email threading using email_threads table
 * @param props - Email properties including recipient, subject, body
 * @returns Promise resolving to EmailPayload with message/thread IDs
 * @throws Error if Gmail service account not configured, email invalid, or API fails
 */
export async function sendNotificationEmail(
  props: SendEmailProps
): Promise<EmailPayload> {
  const { to, subject, htmlBody, textBody, taskId, userId } = props;

  // Validate recipient email
  if (!validateEmailAddress(to)) {
    throw new Error(`Invalid email address: ${to}`);
  }

  // Get Gmail service account credentials
  const serviceAccountJson = process.env.GMAIL_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('Gmail service account not configured');
  }

  const gmailSenderEmail = process.env.GMAIL_SENDER_EMAIL;
  if (!gmailSenderEmail) {
    throw new Error('Gmail sender email not configured');
  }

  let serviceAccount: Record<string, unknown>;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('Invalid Gmail service account JSON');
  }

  // Authenticate with Gmail API using service account
  const auth = new JWT({
    email: serviceAccount.client_email as string,
    key: serviceAccount.private_key as string,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
  });

  const gmail = google.gmail({ version: 'v1', auth });

  // Generate unique Message-ID
  const messageId = `<task-${taskId || 'gen'}.${Date.now()}@taskflow.local>`;

  // Look up existing thread for this task (if provided)
  let threadId: string | undefined;
  if (taskId && userId) {
    threadId = await getExistingThreadId(taskId, userId);
  }

  // Build RFC 5322 email message
  const headers = [
    `From: ${gmailSenderEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
  ];

  // Add threading headers if we have an existing thread
  if (threadId) {
    headers.push(`References: ${threadId}`);
    headers.push(`In-Reply-To: ${threadId}`);
  }

  headers.push('Content-Type: multipart/alternative; boundary="boundary"');
  headers.push('MIME-Version: 1.0');

  const emailBody = [
    headers.join('\r\n'),
    '',
    '--boundary',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    textBody,
    '--boundary',
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlBody,
    '--boundary--',
  ].join('\r\n');

  // Encode message for Gmail API
  const encodedMessage = Buffer.from(emailBody)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Send via Gmail API
  let response;
  try {
    response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: threadId,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to send email via Gmail API: ${errorMessage}`);
  }

  if (!response.data.id) {
    throw new Error('No message ID returned from Gmail API');
  }

  // Store thread information in database
  if (taskId && userId) {
    const returnedThreadId = response.data.threadId || response.data.id;
    await storeEmailThread(
      taskId,
      userId,
      response.data.id,
      returnedThreadId
    );
    threadId = returnedThreadId;
  }

  return {
    to,
    subject,
    htmlBody,
    textBody,
    messageId: response.data.id,
    threadId: threadId,
  };
}

/**
 * Parses an email reply to extract user commands
 * Supports: done, status change, comment commands
 * @param emailBody - Plain text email body
 * @returns ParsedReply with command type and value if found
 */
export function parseGmailCommand(emailBody: string): ParsedReply {
  // Normalize input
  let body = emailBody.trim();

  // Remove email signature (standard "-- " separator)
  const signatureSeparator = body.indexOf('-- ');
  if (signatureSeparator !== -1) {
    body = body.substring(0, signatureSeparator).trim();
  }

  // Remove quoted text (lines starting with >)
  const lines = body
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const fullText = emailBody;

  // Process each line looking for commands
  for (const line of lines) {
    // Pattern 1: "done" command
    if (/^(?:done|✓\s*done|mark\s+as\s+done)$/i.test(line)) {
      return {
        command: 'done',
        fullText,
      };
    }

    // Pattern 2: "status: value" command
    const statusMatch = line.match(/^status\s*:\s*(.+)$/i);
    if (statusMatch && statusMatch[1]) {
      const statusValue = statusMatch[1].trim();
      return {
        command: 'status',
        commandValue: statusValue,
        fullText,
      };
    }

    // Pattern 3: "comment: text" command
    const commentMatch = line.match(/^comment\s*:\s*(.+)$/i);
    if (commentMatch && commentMatch[1]) {
      const commentText = commentMatch[1].trim();
      return {
        command: 'comment',
        commandValue: commentText,
        fullText,
      };
    }

    // Pattern 4: "reply: text" command (maps to comment)
    const replyMatch = line.match(/^reply\s*:\s*(.+)$/i);
    if (replyMatch && replyMatch[1]) {
      const replyText = replyMatch[1].trim();
      return {
        command: 'comment',
        commandValue: replyText,
        fullText,
      };
    }
  }

  // No command found
  return {
    command: null,
    fullText,
  };
}

// ============================================================================
// Helper Functions (Internal)
// ============================================================================

/**
 * Retrieves existing Gmail thread ID for a task from database
 * @param taskId - Task UUID
 * @param userId - User UUID
 * @returns Thread ID if exists, undefined otherwise
 */
async function getExistingThreadId(
  taskId: string,
  userId: string
): Promise<string | undefined> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return undefined;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from('email_threads')
      .select('gmail_thread_id')
      .eq('task_id', taskId)
      .eq('user_id', userId)
      .single();

    if (error) {
      return undefined;
    }

    return data?.gmail_thread_id;
  } catch {
    // Silently fail - not critical if we can't retrieve thread ID
    return undefined;
  }
}

/**
 * Stores email thread information in database for future threading
 * @param taskId - Task UUID
 * @param userId - User UUID
 * @param messageId - Gmail message ID
 * @param threadId - Gmail thread ID
 */
async function storeEmailThread(
  taskId: string,
  userId: string,
  messageId: string,
  threadId: string
): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try to insert, ignore if already exists
    const { error } = await supabase.from('email_threads').insert({
      task_id: taskId,
      user_id: userId,
      message_id: messageId,
      gmail_thread_id: threadId,
    });

    if (error && !error.message.includes('duplicate')) {
      throw error;
    }
  } catch (error) {
    // Log error but don't fail - email is already sent
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Failed to store email thread:', errorMsg);
  }
}
