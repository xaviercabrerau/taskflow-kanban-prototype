import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/ai/client', () => ({ getAiCredential: jest.fn() }));
jest.mock('@/lib/ai/completions', () => ({ suggestTaskFields: jest.fn() }));
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn().mockResolvedValue({ success: true }),
  deriveRateLimitKey: jest.fn((k: string) => k),
}));

import { POST as suggest } from '../route';
import { createClient } from '@/lib/supabase/server';
import { getAiCredential } from '@/lib/ai/client';
import { suggestTaskFields } from '@/lib/ai/completions';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/tasks/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/tasks/suggest', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = {
      auth: { getUser: jest.fn() },
      from: jest.fn(),
    };
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  it('returns 401 without a session', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('no') });
    const response = await suggest(makeRequest({ title: 'x', boardId: 'board-1', tenantId: 'org-1' }));
    expect(response.status).toBe(401);
  });

  it('returns 501 when no AI credential is configured', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { organization_id: 'org-1' }, error: null }),
        };
      }
      return {};
    });
    (getAiCredential as jest.Mock).mockResolvedValue(null);

    const response = await suggest(makeRequest({ title: 'Arreglar bug', boardId: 'board-1', tenantId: 'org-1' }));
    expect(response.status).toBe(501);
  });

  it('returns a suggestion when a credential is configured', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { organization_id: 'org-1' }, error: null }),
        };
      }
      if (table === 'tasks') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ title: 'Otra tarea', priority: 'high', assignee: 'Ana' }],
            error: null,
          }),
        };
      }
      return {};
    });
    (getAiCredential as jest.Mock).mockResolvedValue({ provider: 'openai', apiKey: 'x' });
    (suggestTaskFields as jest.Mock).mockResolvedValue({ priority: 'high', assigneeName: 'Ana' });

    const response = await suggest(makeRequest({ title: 'Arreglar bug urgente', boardId: 'board-1', tenantId: 'org-1' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ priority: 'high', assigneeName: 'Ana' });
  });
});
