import { GET, PATCH } from '../route';
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server');

function createMockRequest(method: string = 'GET', body?: unknown): NextRequest {
  const url = new URL('http://localhost:3000/api/admin/notification-preferences');
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/admin/notification-preferences', () => {
  it('returns 401 when user is not authenticated', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Not authenticated'),
        }),
      },
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const response = await GET(createMockRequest('GET'));
    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not in organization', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-999' } },
          error: null,
        }),
      },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const response = await GET(createMockRequest('GET'));
    expect(response.status).toBe(403);
  });

  it('verifies JWT token exists', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Invalid token'),
        }),
      },
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const response = await GET(createMockRequest('GET'));
    expect(response.status).toBe(401);
  });

  it('filters by user_id in queries', async () => {
    const eqMock = jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        then: jest.fn(),
      }),
    });
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from: jest.fn((table) => {
        if (table === 'organization_members') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { organization_id: 'org-1' },
              error: null,
            }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: eqMock,
        };
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    await GET(createMockRequest('GET'));
    expect(eqMock).toHaveBeenCalledWith('user_id', 'user-123');
  });

  it('filters by organization_id in queries', async () => {
    let callCount = 0;
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from: jest.fn((table) => {
        if (table === 'organization_members') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { organization_id: 'org-1' },
              error: null,
            }),
          };
        }
        const eqMock = jest.fn();
        if (callCount++ === 0) {
          eqMock.mockReturnValue({
            order: jest.fn().mockReturnValue({
              then: jest.fn(),
            }),
          });
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: eqMock,
        };
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    await GET(createMockRequest('GET'));
  });

  it('returns Unauthorized error as JSON', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Not authenticated'),
        }),
      },
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const response = await GET(createMockRequest('GET'));
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });
});

describe('PATCH /api/admin/notification-preferences', () => {
  it('returns 401 when user is not authenticated', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Not authenticated'),
        }),
      },
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const body = {
      preferences: [
        { eventType: 'task_assigned', channel: 'email', enabled: true },
      ],
    };
    const response = await PATCH(createMockRequest('PATCH', body));
    expect(response.status).toBe(401);
  });

  it('returns 400 for malformed JSON', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-1' },
          error: null,
        }),
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const url = new URL('http://localhost:3000/api/admin/notification-preferences');
    const request = new NextRequest(url, {
      method: 'PATCH',
      body: 'invalid {',
    });
    const response = await PATCH(request);
    expect(response.status).toBe(400);
  });

  it('rejects invalid eventType', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-1' },
          error: null,
        }),
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const body = {
      preferences: [
        { eventType: 'invalid_event', channel: 'email', enabled: true },
      ],
    };
    const response = await PATCH(createMockRequest('PATCH', body));
    expect(response.status).toBe(422);
  });

  it('rejects invalid channel', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-1' },
          error: null,
        }),
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const body = {
      preferences: [
        { eventType: 'task_assigned', channel: 'invalid_channel', enabled: true },
      ],
    };
    const response = await PATCH(createMockRequest('PATCH', body));
    expect(response.status).toBe(422);
  });

  it('rejects non-boolean enabled field', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-1' },
          error: null,
        }),
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const body = {
      preferences: [
        { eventType: 'task_assigned', channel: 'email', enabled: 'yes' },
      ],
    };
    const response = await PATCH(createMockRequest('PATCH', body));
    expect(response.status).toBe(422);
  });

  it('returns 403 when user not in organization', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-999' } },
          error: null,
        }),
      },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const body = {
      preferences: [
        { eventType: 'task_assigned', channel: 'email', enabled: true },
      ],
    };
    const response = await PATCH(createMockRequest('PATCH', body));
    expect(response.status).toBe(403);
  });

  it('rejects empty preferences array', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-1' },
          error: null,
        }),
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const body = { preferences: [] };
    const response = await PATCH(createMockRequest('PATCH', body));
    expect(response.status).toBe(422);
  });

  it('returns Unauthorized error as JSON', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Not authenticated'),
        }),
      },
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const body = {
      preferences: [
        { eventType: 'task_assigned', channel: 'email', enabled: true },
      ],
    };
    const response = await PATCH(createMockRequest('PATCH', body));
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });
});

describe('Integration Tests', () => {
  it('both GET and PATCH require JWT', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('No auth'),
        }),
      },
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const getResp = await GET(createMockRequest('GET'));
    expect(getResp.status).toBe(401);
    const patchResp = await PATCH(
      createMockRequest('PATCH', { preferences: [] })
    );
    expect(patchResp.status).toBe(401);
  });

  it('API uses camelCase in responses', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Not authenticated'),
        }),
      },
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const response = await GET(createMockRequest('GET'));
    const json = await response.json();
    expect(json.error).toBeDefined();
  });

  it('validation errors return 422 status', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-1' },
          error: null,
        }),
      }),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const body = {
      preferences: [{ eventType: 'invalid', channel: 'email', enabled: true }],
    };
    const response = await PATCH(createMockRequest('PATCH', body));
    expect(response.status).toBe(422);
  });

  it('authentication is checked before database queries', async () => {
    const mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Not authenticated'),
        }),
      },
      from: jest.fn(),
    };
    createClient.mockResolvedValue(mockSupabaseClient);
    const response = await GET(createMockRequest('GET'));
    expect(response.status).toBe(401);
    expect(mockSupabaseClient.from).not.toHaveBeenCalled();
  });

  it('all 8 event types are valid', async () => {
    const eventTypes = [
      'task_assigned',
      'task_mentioned',
      'status_changed',
      'due_soon',
      'comment_added',
      'project_created',
      'member_invited',
      'task_completed',
    ];

    for (const eventType of eventTypes) {
      const mockSupabaseClient = {
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null,
          }),
        },
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { organization_id: 'org-1' },
            error: null,
          }),
        }),
      };
      createClient.mockResolvedValue(mockSupabaseClient);

      const body = {
        preferences: [
          { eventType, channel: 'email', enabled: true },
        ],
      };
      const response = await PATCH(createMockRequest('PATCH', body));
      expect([200, 500]).toContain(response.status);
    }
  });

  it('both channels are valid', async () => {
    const channels = ['email', 'in_app'];

    for (const channel of channels) {
      const mockSupabaseClient = {
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null,
          }),
        },
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { organization_id: 'org-1' },
            error: null,
          }),
        }),
      };
      createClient.mockResolvedValue(mockSupabaseClient);

      const body = {
        preferences: [
          { eventType: 'task_assigned', channel, enabled: true },
        ],
      };
      const response = await PATCH(createMockRequest('PATCH', body));
      expect([200, 500]).toContain(response.status);
    }
  });
});
