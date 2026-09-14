import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/github/client', () => ({
  getGithubToken: jest.fn(),
  fetchGithubIssueOrPr: jest.fn(),
}));

import { GET as githubSyncMerged } from '../route';
import { createClient } from '@supabase/supabase-js';
import { getGithubToken, fetchGithubIssueOrPr } from '@/lib/github/client';

function makeRequest(secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['Authorization'] = `Bearer ${secret}`;
  return new Request('http://localhost:3000/api/cron/github-sync-merged', { headers });
}

describe('GET /api/cron/github-sync-merged', () => {
  const OLD_ENV = process.env;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, CRON_SECRET: 'test-secret', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x' };
    mockSupabase = { from: jest.fn() };
    (createClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns 401 without the correct CRON_SECRET', async () => {
    const response = await githubSyncMerged(makeRequest('wrong-secret'));
    expect(response.status).toBe(401);
  });

  it('moves a task to the done column when its linked PR is merged', async () => {
    const linkRow = {
      id: 'link-1',
      task_id: 'task-1',
      url: 'https://github.com/acme/repo/pull/42',
      repo: 'acme/repo',
      number: 42,
      kind: 'pull_request',
      state: 'open',
      tasks: { id: 'task-1', board_id: 'board-1', column_id: 'col-todo', tenant_id: 'org-1' },
    };
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'task_github_links') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          neq: jest.fn().mockResolvedValue({ data: [linkRow], error: null }),
          update: jest.fn().mockReturnThis(),
        };
      }
      if (table === 'board_columns') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [{ id: 'col-done', position: 99 }], error: null }),
        };
      }
      if (table === 'tasks') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [{ position: 3 }], error: null }),
          update: jest.fn().mockReturnThis(),
        };
      }
      if (table === 'audit_log') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    });
    (getGithubToken as jest.Mock).mockResolvedValue('gh-token');
    (fetchGithubIssueOrPr as jest.Mock).mockResolvedValue({
      repo: 'acme/repo', number: 42, kind: 'pull_request', title: 'Fix bug', state: 'merged',
    });

    const response = await githubSyncMerged(makeRequest('test-secret'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.moved).toBe(1);
  });

  it('does not move the task when the PR closed without merging', async () => {
    const linkRow = {
      id: 'link-2', task_id: 'task-2', url: 'https://github.com/acme/repo/pull/7',
      repo: 'acme/repo', number: 7, kind: 'pull_request', state: 'open',
      tasks: { id: 'task-2', board_id: 'board-1', column_id: 'col-todo', tenant_id: 'org-1' },
    };
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'task_github_links') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          neq: jest.fn().mockResolvedValue({ data: [linkRow], error: null }),
          update: jest.fn().mockReturnThis(),
        };
      }
      return {};
    });
    (getGithubToken as jest.Mock).mockResolvedValue('gh-token');
    (fetchGithubIssueOrPr as jest.Mock).mockResolvedValue({
      repo: 'acme/repo', number: 7, kind: 'pull_request', title: 'Fix bug', state: 'closed',
    });

    const response = await githubSyncMerged(makeRequest('test-secret'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.moved).toBe(0);
  });
});
