/**
 * Unit tests for notification event emitter (Task 3)
 * Tests validation logic and job queueing with mocked dependencies
 */

import { validateEvent, enqueueNotificationJob } from '../emitter';
import type { NotificationEvent, NotificationJob } from '../types';

// Set up environment variables before importing the module
const originalEnv = process.env;
beforeAll(() => {
  process.env = {
    ...originalEnv,
    KV_URL: 'redis://localhost:6379',
  };
});

afterAll(() => {
  process.env = originalEnv;
});

// Mock BullMQ - must be done before importing emitter
const mockQueueAdd = jest.fn();
const mockQueue = {
  add: mockQueueAdd,
};

jest.mock('bullmq', () => ({
  Queue: jest.fn(() => mockQueue),
}));

describe('NotificationEventEmitter', () => {
  // ========================================================================
  // validateEvent Tests
  // ========================================================================

  describe('validateEvent', () => {
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should validate a complete valid event', () => {
      const event: NotificationEvent = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        taskId: '550e8400-e29b-41d4-a716-446655440002',
        actorId: '550e8400-e29b-41d4-a716-446655440003',
        data: { taskTitle: 'Test Task', priority: 'high' },
      };

      const result = validateEvent(event);

      expect(result).toEqual(event);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should validate a minimal valid event (without optional fields)', () => {
      const event = {
        type: 'project_created',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: { projectName: 'New Project' },
      };

      const result = validateEvent(event);

      expect(result).toEqual(event);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should reject event with missing type', () => {
      const event = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid event type')
      );
    });

    it('should reject event with invalid event type', () => {
      const event = {
        type: 'invalid_type',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid event type')
      );
    });

    it('should reject all 8 valid event types but verify they work individually', () => {
      const validTypes = [
        'task_assigned',
        'task_mentioned',
        'status_changed',
        'due_soon',
        'comment_added',
        'project_created',
        'member_invited',
        'task_completed',
      ] as const;

      const baseEvent = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      validTypes.forEach((type) => {
        const result = validateEvent({ ...baseEvent, type });
        expect(result).not.toBeNull();
        expect(result?.type).toBe(type);
      });
    });

    it('should reject event with missing userId', () => {
      const event = {
        type: 'task_assigned',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid userId')
      );
    });

    it('should reject event with invalid userId format', () => {
      const event = {
        type: 'task_assigned',
        userId: 'not-a-uuid',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid userId')
      );
    });

    it('should reject event with missing organizationId', () => {
      const event = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        data: {},
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid organizationId')
      );
    });

    it('should reject event with invalid organizationId format', () => {
      const event = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: 'invalid-org-id',
        data: {},
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid organizationId')
      );
    });

    it('should reject event with invalid taskId format', () => {
      const event = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        taskId: 'invalid-task-id',
        data: {},
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid taskId')
      );
    });

    it('should reject event with invalid actorId format', () => {
      const event = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        actorId: 'not-a-uuid',
        data: {},
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid actorId')
      );
    });

    it('should reject event with missing data', () => {
      const event = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('data is not an object')
      );
    });

    it('should reject event where data is not an object', () => {
      const event = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: 'not-an-object',
      };

      const result = validateEvent(event);

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('data is not an object')
      );
    });

    it('should reject non-object events', () => {
      expect(validateEvent(null)).toBeNull();
      expect(validateEvent(undefined)).toBeNull();
      expect(validateEvent('string')).toBeNull();
      expect(validateEvent(123)).toBeNull();
      expect(validateEvent([])).toBeNull();
    });

    it('should preserve optional fields in validated event', () => {
      const event = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        taskId: '550e8400-e29b-41d4-a716-446655440002',
        actorId: '550e8400-e29b-41d4-a716-446655440003',
        data: { taskTitle: 'Test' },
      };

      const result = validateEvent(event);

      expect(result?.taskId).toBe(event.taskId);
      expect(result?.actorId).toBe(event.actorId);
    });

    it('should not include undefined optional fields in validated event', () => {
      const event = {
        type: 'project_created',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      const result = validateEvent(event);

      expect('taskId' in result!).toBe(false);
      expect('actorId' in result!).toBe(false);
    });
  });

  // ========================================================================
  // enqueueNotificationJob Tests
  // ========================================================================

  describe('enqueueNotificationJob', () => {
    let consoleInfoSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      mockQueueAdd.mockResolvedValue({ id: 'job-123' });
      consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      consoleInfoSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should enqueue a valid notification event and return job ID', async () => {
      const event: NotificationEvent = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        taskId: '550e8400-e29b-41d4-a716-446655440002',
        actorId: '550e8400-e29b-41d4-a716-446655440003',
        data: { taskTitle: 'Urgent Bug Fix' },
      };

      const jobId = await enqueueNotificationJob(event);

      expect(jobId).toBe('job-123');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should return null if event validation fails', async () => {
      const event = {
        type: 'invalid_type',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      const jobId = await enqueueNotificationJob(event as unknown as NotificationEvent);

      expect(jobId).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
      // Check that error message contains the expected text
      const callArgs = consoleErrorSpy.mock.calls[0];
      expect(callArgs[0]).toContain('Failed to enqueue notification: event validation failed');
    });

    it('should convert NotificationEvent to NotificationJob with correct structure', async () => {
      const event: NotificationEvent = {
        type: 'task_mentioned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        taskId: '550e8400-e29b-41d4-a716-446655440002',
        data: { mentionedBy: 'Alice', comment: 'Check this out' },
      };

      let capturedJob: NotificationJob | undefined;
      mockQueueAdd.mockImplementation((name, job) => {
        capturedJob = job;
        return Promise.resolve({ id: 'job-456' });
      });

      await enqueueNotificationJob(event);

      expect(capturedJob).toMatchObject({
        eventType: 'task_mentioned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        taskId: '550e8400-e29b-41d4-a716-446655440002',
        eventData: { mentionedBy: 'Alice', comment: 'Check this out' },
        attempt: 0,
      });
      expect(capturedJob.enqueuedAt).toBeGreaterThan(0);
    });

    it('should set attempt counter to 0 for new jobs', async () => {
      const event: NotificationEvent = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      let capturedJob: NotificationJob | undefined;
      mockQueueAdd.mockImplementation((name, job) => {
        capturedJob = job;
        return Promise.resolve({ id: 'job-789' });
      });

      await enqueueNotificationJob(event);

      expect(capturedJob.attempt).toBe(0);
    });

    it('should set enqueuedAt timestamp', async () => {
      const event: NotificationEvent = {
        type: 'task_completed',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      const beforeTime = Date.now();
      let capturedJob: NotificationJob | undefined;
      mockQueueAdd.mockImplementation((name, job) => {
        capturedJob = job;
        return Promise.resolve({ id: 'job-time' });
      });

      await enqueueNotificationJob(event);
      const afterTime = Date.now();

      expect(capturedJob.enqueuedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(capturedJob.enqueuedAt).toBeLessThanOrEqual(afterTime);
    });

    it('should handle queue errors gracefully and return null', async () => {
      const event: NotificationEvent = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      mockQueueAdd.mockRejectedValue(new Error('Redis connection failed'));

      const jobId = await enqueueNotificationJob(event);

      expect(jobId).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to enqueue notification job'),
        expect.objectContaining({
          error: expect.stringContaining('Redis connection failed'),
        })
      );
    });

    it('should handle missing KV_URL configuration gracefully', async () => {
      const event: NotificationEvent = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      // Temporarily remove KV_URL
      const originalKvUrl = process.env.KV_URL;
      delete process.env.KV_URL;
      delete process.env.KV_REST_API_URL;

      // Force re-evaluation by clearing require cache for emitter
      jest.resetModules();
      const { enqueueNotificationJob: testEnqueue } = await import('../emitter');

      const jobId = await testEnqueue(event);

      expect(jobId).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      // Restore environment
      process.env.KV_URL = originalKvUrl;
    });

    it('should log job ID when successfully enqueued', async () => {
      const event: NotificationEvent = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      mockQueueAdd.mockResolvedValue({ id: 'job-logged' });

      await enqueueNotificationJob(event);

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        'Notification job enqueued',
        expect.objectContaining({
          jobId: 'job-logged',
          eventType: 'task_assigned',
          userId: '550e8400-e29b-41d4-a716-446655440000',
        })
      );
    });

    it('should handle null job ID from queue', async () => {
      const event: NotificationEvent = {
        type: 'task_assigned',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
      };

      mockQueueAdd.mockResolvedValue({ id: null });

      const jobId = await enqueueNotificationJob(event);

      expect(jobId).toBeNull();
    });

    it('should work with minimal event (no optional fields)', async () => {
      const event: NotificationEvent = {
        type: 'project_created',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        data: { projectName: 'New Project' },
      };

      mockQueueAdd.mockResolvedValue({ id: 'job-minimal' });

      const jobId = await enqueueNotificationJob(event);

      expect(jobId).toBe('job-minimal');
    });
  });
});
