/**
 * Tests for Gmail API Integration (Task 7)
 * Comprehensive test suite with 30+ tests covering all functions
 * Uses mocked Gmail API and Supabase client (no real API calls)
 */

import {
  sendNotificationEmail,
  parseGmailCommand,
  validateEmailAddress,
  SendEmailProps,
} from '../gmail';
import { EmailPayload } from '../types';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// Mock google-auth-library and googleapis
jest.mock('googleapis', () => ({
  google: {
    gmail: jest.fn(() => ({
      users: {
        messages: {
          send: jest.fn(),
        },
      },
    })),
  },
}));

jest.mock('google-auth-library', () => ({
  JWT: jest.fn(),
}));

// Mock Supabase
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
      insert: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    })),
  })),
}));

// ============================================================================
// validateEmailAddress Tests (4 tests)
// ============================================================================

describe('validateEmailAddress', () => {
  test('✓ accepts valid email addresses', () => {
    expect(validateEmailAddress('test@example.com')).toBe(true);
    expect(validateEmailAddress('user.name+tag@example.co.uk')).toBe(true);
    expect(validateEmailAddress('contact@company.io')).toBe(true);
  });

  test('✓ rejects missing @ symbol', () => {
    expect(validateEmailAddress('testexample.com')).toBe(false);
  });

  test('✓ rejects missing domain', () => {
    expect(validateEmailAddress('test@')).toBe(false);
  });

  test('✓ rejects spaces in email', () => {
    expect(validateEmailAddress('test @example.com')).toBe(false);
    expect(validateEmailAddress('test@ example.com')).toBe(false);
  });
});

// ============================================================================
// sendNotificationEmail Tests (6 tests)
// ============================================================================

describe('sendNotificationEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GMAIL_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'service@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    });
    process.env.GMAIL_SENDER_EMAIL = 'notifications@taskflow.local';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  test('✓ sends email with valid props', async () => {
    const mockSend = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-123',
        threadId: 'thread-123',
      },
    });

    google.gmail.mockReturnValue({
      users: {
        messages: {
          send: mockSend,
        },
      },
    });

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test Email',
      htmlBody: '<p>Hello</p>',
      textBody: 'Hello',
    };

    const result: EmailPayload = await sendNotificationEmail(props);

    expect(result.messageId).toBe('msg-123');
    expect(result.to).toBe('user@example.com');
    expect(result.subject).toBe('Test Email');
    expect(mockSend).toHaveBeenCalled();
  });

  test('✓ includes all required headers', async () => {
    const mockSend = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-456',
      },
    });

    google.gmail.mockReturnValue({
      users: {
        messages: {
          send: mockSend,
        },
      },
    });

    const props: SendEmailProps = {
      to: 'test@example.com',
      subject: 'Header Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
    };

    await sendNotificationEmail(props);

    const sendCall = mockSend.mock.calls[0];
    const rawMessage = Buffer.from(
      sendCall[0].requestBody.raw,
      'base64'
    ).toString();

    expect(rawMessage).toContain('From: notifications@taskflow.local');
    expect(rawMessage).toContain('To: test@example.com');
    expect(rawMessage).toContain('Subject: Header Test');
    expect(rawMessage).toContain('Message-ID:');
  });

  test('✓ handles missing GMAIL_SERVICE_ACCOUNT_JSON gracefully', async () => {
    delete process.env.GMAIL_SERVICE_ACCOUNT_JSON;

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
    };

    await expect(sendNotificationEmail(props)).rejects.toThrow(
      'Gmail service account not configured'
    );
  });

  test('✓ validates email address before sending', async () => {
    const props: SendEmailProps = {
      to: 'invalid-email',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
    };

    await expect(sendNotificationEmail(props)).rejects.toThrow(
      'Invalid email address'
    );
  });

  test('✓ handles Gmail API errors gracefully', async () => {
    const mockSend = jest.fn().mockRejectedValue(
      new Error('Gmail API error: Invalid credentials')
    );

    google.gmail.mockReturnValue({
      users: {
        messages: {
          send: mockSend,
        },
      },
    });

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
    };

    await expect(sendNotificationEmail(props)).rejects.toThrow(
      'Failed to send email via Gmail API'
    );
  });

  test('✓ handles missing GMAIL_SENDER_EMAIL gracefully', async () => {
    delete process.env.GMAIL_SENDER_EMAIL;

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
    };

    await expect(sendNotificationEmail(props)).rejects.toThrow(
      'Gmail sender email not configured'
    );
  });
});

// ============================================================================
// Email Threading Tests (4 tests)
// ============================================================================

describe('sendNotificationEmail - Email Threading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GMAIL_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'service@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    });
    process.env.GMAIL_SENDER_EMAIL = 'notifications@taskflow.local';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  test('✓ reuses existing thread for same task', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest
      .fn()
      .mockResolvedValue({
        data: { gmail_thread_id: 'existing-thread-123' },
        error: null,
      });

    const mockFrom = jest.fn().mockReturnValue({
      select: mockSelect.mockReturnValue({
        eq: mockEq.mockReturnValue({
          eq: mockEq.mockReturnValue({
            single: mockSingle,
          }),
        }),
      }),
    });

    createClient.mockReturnValue({
      from: mockFrom,
    });

    const mockSend = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-789',
        threadId: 'existing-thread-123',
      },
    });

    google.gmail.mockReturnValue({
      users: {
        messages: {
          send: mockSend,
        },
      },
    });

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
      taskId: 'task-123',
      userId: 'user-456',
    };

    const result = await sendNotificationEmail(props);

    expect(result.threadId).toBe('existing-thread-123');
  });

  test('✓ thread ID from database used in References header', async () => {
    const mockSingle = jest
      .fn()
      .mockResolvedValue({
        data: { gmail_thread_id: 'thread-ref-123' },
        error: null,
      });

    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: mockSingle,
    });

    createClient.mockReturnValue({
      from: mockFrom,
    });

    const mockSend = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-999',
        threadId: 'thread-ref-123',
      },
    });

    google.gmail.mockReturnValue({
      users: {
        messages: {
          send: mockSend,
        },
      },
    });

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
      taskId: 'task-123',
      userId: 'user-456',
    };

    await sendNotificationEmail(props);

    const sendCall = mockSend.mock.calls[0];
    const rawMessage = Buffer.from(
      sendCall[0].requestBody.raw,
      'base64'
    ).toString();

    expect(rawMessage).toContain('References: thread-ref-123');
  });

  test('✓ multiple emails on same task use same thread ID', async () => {
    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValue({
          data: { gmail_thread_id: 'shared-thread-123' },
          error: null,
        }),
      insert: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    createClient.mockReturnValue({
      from: mockFrom,
    });

    const mockSend = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-111',
        threadId: 'shared-thread-123',
      },
    });

    google.gmail.mockReturnValue({
      users: {
        messages: {
          send: mockSend,
        },
      },
    });

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test 1',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
      taskId: 'task-123',
      userId: 'user-456',
    };

    const result1 = await sendNotificationEmail(props);
    const result2 = await sendNotificationEmail(props);

    expect(result1.threadId).toBe('shared-thread-123');
    expect(result2.threadId).toBe('shared-thread-123');
  });

  test('✓ new task gets new thread', async () => {
    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValue({
          data: null,
          error: { message: 'No rows found' },
        }),
      insert: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    createClient.mockReturnValue({
      from: mockFrom,
    });

    const mockSend = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-new-123',
        threadId: 'new-thread-456',
      },
    });

    google.gmail.mockReturnValue({
      users: {
        messages: {
          send: mockSend,
        },
      },
    });

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
      taskId: 'new-task-789',
      userId: 'user-999',
    };

    const result = await sendNotificationEmail(props);

    expect(result.threadId).toBe('new-thread-456');
  });
});

// ============================================================================
// parseGmailCommand Tests (12 tests)
// ============================================================================

describe('parseGmailCommand', () => {
  test('✓ parses "done" command', () => {
    const result = parseGmailCommand('done');
    expect(result.command).toBe('done');
    expect(result.fullText).toBe('done');
  });

  test('✓ parses "DONE" command (case-insensitive)', () => {
    const result = parseGmailCommand('DONE');
    expect(result.command).toBe('done');
  });

  test('✓ parses "✓ done" command', () => {
    const result = parseGmailCommand('✓ done');
    expect(result.command).toBe('done');
  });

  test('✓ parses "mark as done" command', () => {
    const result = parseGmailCommand('mark as done');
    expect(result.command).toBe('done');
  });

  test('✓ parses "status: in_progress" command', () => {
    const result = parseGmailCommand('status: in_progress');
    expect(result.command).toBe('status');
    expect(result.commandValue).toBe('in_progress');
  });

  test('✓ parses "status:review" command (no space)', () => {
    const result = parseGmailCommand('status:review');
    expect(result.command).toBe('status');
    expect(result.commandValue).toBe('review');
  });

  test('✓ parses "comment: this is my comment" command', () => {
    const result = parseGmailCommand('comment: this is my comment');
    expect(result.command).toBe('comment');
    expect(result.commandValue).toBe('this is my comment');
  });

  test('✓ parses "reply: feedback here" command', () => {
    const result = parseGmailCommand('reply: feedback here');
    expect(result.command).toBe('comment');
    expect(result.commandValue).toBe('feedback here');
  });

  test('✓ case-insensitive command matching', () => {
    const result1 = parseGmailCommand('COMMENT: test');
    const result2 = parseGmailCommand('CoMmEnT: test');
    const result3 = parseGmailCommand('STATUS: review');

    expect(result1.command).toBe('comment');
    expect(result2.command).toBe('comment');
    expect(result3.command).toBe('status');
  });

  test('✓ handles missing command (returns null)', () => {
    const result = parseGmailCommand('Just some random text');
    expect(result.command).toBe(null);
    expect(result.fullText).toBe('Just some random text');
  });

  test('✓ strips Gmail signature', () => {
    const emailWithSig =
      'done\n\n-- \nJohn Doe\nExample Company\njohn@example.com';
    const result = parseGmailCommand(emailWithSig);
    expect(result.command).toBe('done');
  });

  test('✓ handles empty body', () => {
    const result = parseGmailCommand('');
    expect(result.command).toBe(null);
    expect(result.fullText).toBe('');
  });
});

// ============================================================================
// parseGmailCommand Edge Cases (8 tests)
// ============================================================================

describe('parseGmailCommand - Edge Cases', () => {
  test('✓ handles very long comment text', () => {
    const longComment = 'a'.repeat(1000);
    const result = parseGmailCommand(`comment: ${longComment}`);
    expect(result.command).toBe('comment');
    expect(result.commandValue?.length).toBe(1000);
  });

  test('✓ extracts command value correctly', () => {
    const result = parseGmailCommand('status: backlog');
    expect(result.commandValue).toBe('backlog');
  });

  test('✓ handles multiple commands (first wins)', () => {
    const result = parseGmailCommand('done\ncomment: extra text');
    expect(result.command).toBe('done');
  });

  test('✓ handles special characters in comment text', () => {
    const result = parseGmailCommand('comment: Test with <tags> & special!');
    expect(result.command).toBe('comment');
    expect(result.commandValue).toContain('<tags>');
    expect(result.commandValue).toContain('&');
  });

  test('✓ preserves whitespace in comments', () => {
    const result = parseGmailCommand('comment:   lots   of   spaces');
    expect(result.commandValue).toBe('lots   of   spaces');
  });

  test('✓ removes quoted text (lines starting with >)', () => {
    const quotedEmail = `done\n> Previous message text\n> More quoted text`;
    const result = parseGmailCommand(quotedEmail);
    expect(result.command).toBe('done');
  });

  test('✓ handles only whitespace', () => {
    const result = parseGmailCommand('   \n\n   ');
    expect(result.command).toBe(null);
  });

  test('✓ handles complex multiline email with signature', () => {
    const complexEmail = `This is some context

status: done

--
John Doe
john@example.com`;
    const result = parseGmailCommand(complexEmail);
    expect(result.command).toBe('status');
    expect(result.commandValue).toBe('done');
  });
});

// ============================================================================
// Error Handling Tests (3 tests)
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('✓ throws on invalid email address', async () => {
    const props: SendEmailProps = {
      to: 'not-an-email',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
    };

    await expect(sendNotificationEmail(props)).rejects.toThrow(
      'Invalid email address'
    );
  });

  test('✓ throws on missing service account credentials', async () => {
    delete process.env.GMAIL_SERVICE_ACCOUNT_JSON;

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
    };

    await expect(sendNotificationEmail(props)).rejects.toThrow(
      'Gmail service account not configured'
    );
  });

  test('✓ handles Gmail API errors gracefully', async () => {
    process.env.GMAIL_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'service@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    });
    process.env.GMAIL_SENDER_EMAIL = 'notifications@taskflow.local';

    const mockSend = jest.fn().mockRejectedValue(
      new Error('Authentication failed')
    );

    google.gmail.mockReturnValue({
      users: {
        messages: {
          send: mockSend,
        },
      },
    });

    const props: SendEmailProps = {
      to: 'user@example.com',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
    };

    await expect(sendNotificationEmail(props)).rejects.toThrow();
  });
});

// ============================================================================
// Integration Tests (2 tests)
// ============================================================================

describe('Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GMAIL_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'service@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    });
    process.env.GMAIL_SENDER_EMAIL = 'notifications@taskflow.local';
  });

  test('✓ parseGmailCommand works with real email replies', () => {
    const realReply = `Thanks for the update!

status: in_progress

--
Sent from my iPhone`;
    const result = parseGmailCommand(realReply);
    expect(result.command).toBe('status');
    expect(result.commandValue).toBe('in_progress');
  });

  test('✓ validateEmailAddress and sendNotificationEmail work together', async () => {
    // Valid email passes validation
    expect(validateEmailAddress('test@example.com')).toBe(true);

    // Invalid email fails validation
    expect(validateEmailAddress('invalid')).toBe(false);

    // Invalid email causes sendNotificationEmail to fail
    const props: SendEmailProps = {
      to: 'invalid',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
    };

    await expect(sendNotificationEmail(props)).rejects.toThrow(
      'Invalid email address'
    );
  });
});
