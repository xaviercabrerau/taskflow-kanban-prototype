/**
 * Unit tests for notification job processor (Task 4)
 * Tests job handling, preference checking, and error recovery
 * All external dependencies mocked
 */

import { createNotificationWorker, jobHandler, validateJob } from '../processor';
import type { NotificationJob } from '../types';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

// ============================================================================
// Setup: Environment and Mocks
// ============================================================================

const originalEnv = process.env;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    KV_URL: 'redis://localhost:6379',
  };
});

afterAll(() => {
  process.env = originalEnv;
});

// Mock BullMQ Worker
const mockWorkerOn = jest.fn().mockReturnThis();
const mockWorker = {
  on: mockWorkerOn,
};

jest.mock('bullmq', () => ({
  Worker: jest.fn(() => mockWorker),
}));

// Mock Supabase client
const mockSupabaseSelect = jest.fn();
const mockSupabaseInsert = jest.fn();
const mockSupabaseFrom = jest.fn((table: string) => {
  if (table === 'notification_preferences') {
    return {
      select: mockSupabaseSelect,
    };
  }
  return {
    insert: mockSupabaseInsert,
  };
});

const mockSupabaseClient = {
  from: mockSupabaseFrom,
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

// ============================================================================
// Helper: Create Test Job
// ============================================================================

function createTestJob(overrides?: Partial<NotificationJob>): Job<NotificationJob> {
  const baseJob: NotificationJob = {
    eventType: 'task_assigned',
    userId: '550e8400-e29b-41d4-a716-446655440000',
    organizationId: '550e8400-e29b-41d4-a716-446655440001',
    taskId: '550e8400-e29b-41d4-a716-446655440002',
    actorId: '550e8400-e29b-41d4-a716-446655440003',
    eventData: { taskTitle: 'Test Task' },
    enqueuedAt: Date.now(),
    attempt: 0,
    ...overrides,
  };

  return {
    id: 'test-job-123',
    data: baseJob,
    attemptsMade: 0,
    progress: jest.fn(),
    updateProgress: jest.fn(),
  } as unknown as Job<NotificationJob>;
}

// ============================================================================
// Tests: Job Validation
// ============================================================================

describe('Processor: validateJob', () => {
  it('should accept valid job with all fields', () => {
    const job = createTestJob();
    expect(() => validateJob(job.data)).not.toThrow();
  });

  it('should accept valid job without optional taskId and actorId', () => {
    const job = createTestJob({
      taskId: undefined,
      actorId: undefined,
    });
    expect(() => validateJob(job.data)).not.toThrow();
  });

  it('should reject job with missing eventType', () => {
    const invalidData = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: '550e8400-e29b-41d4-a716-446655440001',
      eventData: {},
      enqueuedAt: Date.now(),
      attempt: 0,
    };

    expect(() => validateJob(invalidData as NotificationJob)).toThrow(/eventType/);
  });

  it('should reject job with missing userId', () => {
    const invalidData = {
      eventType: 'task_assigned',
      organizationId: '550e8400-e29b-41d4-a716-446655440001',
      eventData: {},
      enqueuedAt: Date.now(),
      attempt: 0,
    };

    expect(() => validateJob(invalidData as NotificationJob)).toThrow(/userId/);
  });

  it('should reject job with missing organizationId', () => {
    const invalidData = {
      eventType: 'task_assigned',
      userId: '550e8400-e29b-41d4-a716-446655440000',
      eventData: {},
      enqueuedAt: Date.now(),
      attempt: 0,
    };

    expect(() => validateJob(invalidData as NotificationJob)).toThrow(/organizationId/);
  });

  it('should reject job with missing eventData', () => {
    const invalidData = {
      eventType: 'task_assigned',
      userId: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: '550e8400-e29b-41d4-a716-446655440001',
      enqueuedAt: Date.now(),
      attempt: 0,
    };

    expect(() => validateJob(invalidData as NotificationJob)).toThrow(/eventData/);
  });

  it('should reject non-object job', () => {
    expect(() => validateJob('not an object' as unknown as NotificationJob)).toThrow(/not an object/);
  });
});

// ============================================================================
// Tests: Worker Creation
// ============================================================================

describe('Processor: createNotificationWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create worker with correct queue name and concurrency', async () => {
    await createNotificationWorker();

    expect(Worker).toHaveBeenCalledWith(
      'notifications:queue',
      expect.any(Function),
      expect.objectContaining({
        concurrency: 5,
      })
    );
  });

  it('should set up event listeners on worker', async () => {
    await createNotificationWorker();

    expect(mockWorkerOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockWorkerOn).toHaveBeenCalledWith('failed', expect.any(Function));
    expect(mockWorkerOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should return worker instance', async () => {
    const worker = await createNotificationWorker();

    expect(worker).toBeDefined();
    expect(worker).toHaveProperty('on');
  });

  it('should throw if Redis URL not configured', async () => {
    const savedKvUrl = process.env.KV_URL;
    const savedRedisUrl = process.env.REDIS_URL;
    const savedKvRestUrl = process.env.KV_REST_API_URL;

    try {
      process.env.KV_URL = undefined;
      process.env.REDIS_URL = undefined;
      process.env.KV_REST_API_URL = undefined;

      await expect(createNotificationWorker()).rejects.toThrow(/Redis configuration missing/);
    } finally {
      process.env.KV_URL = savedKvUrl;
      process.env.REDIS_URL = savedRedisUrl;
      process.env.KV_REST_API_URL = savedKvRestUrl;
    }
  });
});

// ============================================================================
// Tests: Job Handler - Preference-Based Processing
// ============================================================================

describe('Processor: jobHandler - Preferences', () => {
  let consoleInfoSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should skip notification when all channels disabled', async () => {
    const job = createTestJob();

    // Mock preference query: both channels disabled
    mockSupabaseSelect.mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: jest.fn().mockResolvedValue({
        data: [
          { channel: 'email', enabled: false },
          { channel: 'in_app', enabled: false },
        ],
        error: null,
      }),
    });

    mockSupabaseSelect.mockReturnValue({
      eq: jest.fn()
        .mockReturnValueOnce({
          eq: jest.fn()
            .mockReturnValueOnce({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { channel: 'email', enabled: false },
                  { channel: 'in_app', enabled: false },
                ],
                error: null,
              }),
            }),
        }),
    });

    // Re-mock properly
    (mockSupabaseClient.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'notification_preferences') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn()
              .mockReturnValueOnce({
                eq: jest.fn()
                  .mockReturnValueOnce({
                    eq: jest.fn().mockResolvedValue({
                      data: [
                        { channel: 'email', enabled: false },
                        { channel: 'in_app', enabled: false },
                      ],
                      error: null,
                    }),
                  }),
              }),
          }),
        };
      }
      return { insert: jest.fn() };
    });

    // Should complete without throwing
    await expect(jobHandler(job)).resolves.toBeUndefined();

    // Should log skip message
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipped'),
      expect.any(Object)
    );
  });

  it('should process email when email channel enabled', async () => {
    const job = createTestJob();

    // Mock preferences: email enabled, in_app disabled
    (mockSupabaseClient.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'notification_preferences') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn()
              .mockReturnValueOnce({
                eq: jest.fn()
                  .mockReturnValueOnce({
                    eq: jest.fn().mockResolvedValue({
                      data: [{ channel: 'email', enabled: true }],
                      error: null,
                    }),
                  }),
              }),
          }),
        };
      }

      // For email_threads insert
      if (table === 'email_threads') {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'thread-123',
                  task_id: job.data.taskId,
                  user_id: job.data.userId,
                  message_id: '<task.123@taskflow.local>',
                  gmail_thread_id: null,
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        };
      }

      return { insert: jest.fn() };
    });

    await expect(jobHandler(job)).resolves.toBeUndefined();
  });

  it('should process in-app when in_app channel enabled', async () => {
    const job = createTestJob();

    // Mock preferences: in_app enabled, email disabled
    (mockSupabaseClient.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'notification_preferences') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn()
              .mockReturnValueOnce({
                eq: jest.fn()
                  .mockReturnValueOnce({
                    eq: jest.fn().mockResolvedValue({
                      data: [{ channel: 'in_app', enabled: true }],
                      error: null,
                    }),
                  }),
              }),
          }),
        };
      }

      // For notifications insert
      if (table === 'notifications') {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'notif-123',
                  user_id: job.data.userId,
                  organization_id: job.data.organizationId,
                  event_type: job.data.eventType,
                  task_id: job.data.taskId,
                  actor_id: job.data.actorId,
                  message: 'Test notification',
                  read: false,
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        };
      }

      return { insert: jest.fn() };
    });

    await expect(jobHandler(job)).resolves.toBeUndefined();
  });

  it('should process both email and in-app when both enabled', async () => {
    const job = createTestJob();

    let callCount = 0;

    // Mock preferences: both enabled
    (mockSupabaseClient.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'notification_preferences') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn()
              .mockReturnValueOnce({
                eq: jest.fn()
                  .mockReturnValueOnce({
                    eq: jest.fn().mockResolvedValue({
                      data: [
                        { channel: 'email', enabled: true },
                        { channel: 'in_app', enabled: true },
                      ],
                      error: null,
                    }),
                  }),
              }),
          }),
        };
      }

      // For email_threads and notifications
      return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: `item-${++callCount}`,
                task_id: job.data.taskId,
                user_id: job.data.userId,
                message_id: '<task.123@taskflow.local>',
                message: 'Test',
                read: false,
                created_at: new Date().toISOString(),
                organization_id: job.data.organizationId,
                event_type: job.data.eventType,
                actor_id: job.data.actorId,
              },
              error: null,
            }),
          }),
        }),
      };
    });

    await expect(jobHandler(job)).resolves.toBeUndefined();
  });
});

// ============================================================================
// Tests: Error Handling and Retry
// ============================================================================

describe('Processor: jobHandler - Error Handling', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should throw on invalid job and record failure', async () => {
    const invalidJob = {
      id: 'test-job',
      data: { /* missing required fields */ },
      attemptsMade: 1,
    } as unknown as Job<NotificationJob>;

    (mockSupabaseClient.from as jest.Mock).mockImplementation(() => ({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'failed-123',
              event_type: null,
              user_id: null,
              error_message: 'Validation: Invalid job',
              retry_count: 1,
              created_at: new Date().toISOString(),
            },
            error: null,
          }),
        }),
      }),
    }));

    await expect(jobHandler(invalidJob)).rejects.toThrow();
  });

  it('should handle email sending failure and retry', async () => {
    const job = createTestJob();

    // Mock preferences: email enabled
    (mockSupabaseClient.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'notification_preferences') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn()
              .mockReturnValueOnce({
                eq: jest.fn()
                  .mockReturnValueOnce({
                    eq: jest.fn().mockResolvedValue({
                      data: [{ channel: 'email', enabled: true }],
                      error: null,
                    }),
                  }),
              }),
          }),
        };
      }

      // Fail on email_threads insert
      if (table === 'email_threads') {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: new Error('Email thread creation failed'),
              }),
            }),
          }),
        };
      }

      // For failed_jobs
      if (table === 'failed_jobs') {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'failed-123',
                  event_type: job.data.eventType,
                  user_id: job.data.userId,
                  error_message: 'Email: Email thread creation failed',
                  retry_count: 0,
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        };
      }

      return { insert: jest.fn() };
    });

    await expect(jobHandler(job)).rejects.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Email delivery failed'),
      expect.any(Object)
    );
  });
});

// ============================================================================
// Tests: Concurrent Job Processing
// ============================================================================

describe('Processor: Concurrent Processing', () => {
  it('should create worker with concurrency 5', async () => {
    jest.clearAllMocks();

    await createNotificationWorker();

    const callArgs = Worker.mock.calls[0][2];
    expect(callArgs.concurrency).toBe(5);
  });
});
