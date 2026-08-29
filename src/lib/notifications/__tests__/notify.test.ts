import { validateEvent, sendNotification } from '../notify';

const insertMock = jest.fn().mockResolvedValue({ error: null });
let preferencesResult: { data: unknown; error: unknown } = { data: [], error: null };
let profileResult: { data: unknown } = { data: { full_name: 'Ana QA', email: 'ana@example.com' } };
let orgResult: { data: unknown } = { data: { name: 'Acme Inc' } };

function buildFrom(table: string) {
  if (table === 'notification_preferences') {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: async () => preferencesResult,
          }),
        }),
      }),
    };
  }
  if (table === 'profiles') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => profileResult,
        }),
      }),
    };
  }
  if (table === 'organizations') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => orgResult,
        }),
      }),
    };
  }
  if (table === 'notifications' || table === 'failed_jobs') {
    return { insert: insertMock };
  }
  throw new Error(`Unexpected table in test mock: ${table}`);
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => buildFrom(table),
  }),
}));

jest.mock('../../emails/resend-client', () => ({
  sendEmail: jest.fn().mockResolvedValue({ id: 'email-1' }),
}));

jest.mock('../../emails/template-map', () => ({
  getEmailContent: jest.fn().mockResolvedValue({ subject: 'Subject', html: '<p>hi</p>', text: 'hi' }),
}));

import { sendEmail } from '../../emails/resend-client';

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222';

const baseEvent = {
  type: 'task_assigned',
  userId: VALID_UUID_A,
  organizationId: VALID_UUID_B,
  data: { taskTitle: 'Fix bug', actorName: 'Luis QA' },
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  preferencesResult = { data: [], error: null };
  profileResult = { data: { full_name: 'Ana QA', email: 'ana@example.com' } };
  orgResult = { data: { name: 'Acme Inc' } };
  insertMock.mockClear();
  (sendEmail as jest.Mock).mockClear();
});

describe('validateEvent', () => {
  it('accepts a well-formed event', () => {
    expect(validateEvent(baseEvent)).toEqual(baseEvent);
  });

  it('rejects an invalid event type', () => {
    expect(validateEvent({ ...baseEvent, type: 'not_a_real_event' })).toBeNull();
  });

  it('rejects a non-UUID userId', () => {
    expect(validateEvent({ ...baseEvent, userId: 'not-a-uuid' })).toBeNull();
  });

  it('rejects missing data object', () => {
    const { data: _data, ...rest } = baseEvent;
    void _data;
    expect(validateEvent(rest)).toBeNull();
  });

  it('accepts null taskId/actorId (system/automation-triggered events with no human actor)', () => {
    // Regression test: a Postgres trigger firing with auth.uid() = null (e.g.
    // no authenticated session, as with a service-role insert or an
    // automation-authored comment) sends JSON `null`, not an omitted key.
    // validateEvent previously only special-cased `undefined`, so a `null`
    // actorId/taskId was rejected as an invalid UUID — silently dropping
    // every such notification.
    const event = { ...baseEvent, taskId: null, actorId: null };
    const result = validateEvent(event);
    expect(result).not.toBeNull();
    expect(result?.taskId).toBeUndefined();
    expect(result?.actorId).toBeUndefined();
  });
});

describe('sendNotification', () => {
  it('sends email and creates an in-app notification when both channels are enabled (default preferences)', async () => {
    await sendNotification(baseEvent);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ana@example.com', subject: 'Subject' })
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: VALID_UUID_B,
        user_id: VALID_UUID_A,
        type: 'task_assigned',
        related_task_id: null,
      })
    );
  });

  it('skips both channels when the user disabled them', async () => {
    preferencesResult = {
      data: [
        { channel: 'email', enabled: false },
        { channel: 'in_app', enabled: false },
      ],
      error: null,
    };

    await sendNotification(baseEvent);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('restricts delivery to the requested channels only', async () => {
    await sendNotification(baseEvent, { channels: ['email'] });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task_assigned' })
    );
  });

  it('records a failed_jobs entry when the recipient has no email on file, without throwing', async () => {
    profileResult = { data: { full_name: 'Ana QA', email: null } };

    await expect(sendNotification(baseEvent, { channels: ['email'] })).resolves.toBeUndefined();

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ error_message: expect.stringContaining('No email on file') })
    );
  });

  it('silently no-ops on an invalid event instead of throwing', async () => {
    await expect(sendNotification({ type: 'bogus' })).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
