import { NextRequest } from 'next/server';
import { POST } from '../route';
import { sendNotification } from '@/lib/notifications/notify';

jest.mock('@/lib/notifications/notify', () => ({
  sendNotification: jest.fn().mockResolvedValue({ processed: true }),
}));

function makeRequest(body: unknown, secret?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/internal/notify-event', {
    method: 'POST',
    headers: secret ? { 'x-internal-secret': secret, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SECRET = 'test-secret-value';

beforeEach(() => {
  process.env.INTERNAL_NOTIFY_SECRET = SECRET;
  (sendNotification as jest.Mock).mockClear();
});

describe('POST /api/internal/notify-event', () => {
  it('returns 401 without the secret header', async () => {
    const res = await POST(makeRequest({ type: 'task_assigned' }));
    expect(res.status).toBe(401);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('returns 401 with a wrong secret', async () => {
    const res = await POST(makeRequest({ type: 'task_assigned' }, 'wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when INTERNAL_NOTIFY_SECRET is not configured', async () => {
    delete process.env.INTERNAL_NOTIFY_SECRET;
    const res = await POST(makeRequest({ type: 'task_assigned' }, SECRET));
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/internal/notify-event', {
      method: 'POST',
      headers: { 'x-internal-secret': SECRET },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('forwards the event and channels to sendNotification and returns 200', async () => {
    const res = await POST(
      makeRequest({ type: 'status_changed', userId: 'u1', channels: ['email'] }, SECRET)
    );
    expect(res.status).toBe(200);
    expect(sendNotification).toHaveBeenCalledWith(
      { type: 'status_changed', userId: 'u1' },
      { channels: ['email'] }
    );
  });

  it('passes undefined channels through when not an array', async () => {
    await POST(makeRequest({ type: 'status_changed' }, SECRET));
    expect(sendNotification).toHaveBeenCalledWith(
      { type: 'status_changed' },
      { channels: undefined }
    );
  });
});
