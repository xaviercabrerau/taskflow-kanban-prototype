import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the Supabase client before importing the route
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

import { GET as getUsers, POST as createUser } from '../route';
import { createClient } from '@/lib/supabase/server';

describe('API: /api/admin/users (GET & POST)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable Supabase query builder mock; typing the full chain is impractical for a test fixture
  let mockSupabase: any;
  let mockRequest: Request;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSupabase = {
      auth: {
        getUser: jest.fn(),
      },
      from: jest.fn(),
    };

    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('GET /api/admin/users', () => {
    it('should return 401 if user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Unauthorized'),
      });

      mockRequest = new Request('http://localhost:3000/api/admin/users');

      const response = await getUsers(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('should return 403 if user is not a member of organization', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      mockRequest = new Request('http://localhost:3000/api/admin/users');

      const response = await getUsers(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error).toBe('Forbidden');
    });

    it('should return 500 on database error', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database connection failed' },
        }),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      mockRequest = new Request('http://localhost:3000/api/admin/users');

      const response = await getUsers(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error).toBe('Database connection failed');
    });

    it('should return list of users for authorized user', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      // The route makes two sequential `.from('organization_members')` calls
      // with different shapes: the first ends in `.maybeSingle()` (membership
      // check), the second is awaited directly off `.eq()` (the users list).
      const membershipChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-123', org_role: 'owner' },
          error: null,
        }),
      };
      const usersListChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({
          data: [
            {
              user_id: 'user-123',
              org_role: 'owner',
              joined_at: '2026-01-01T00:00:00.000Z',
              profiles: { id: 'user-123', email: 'ana@example.com', full_name: 'Ana QA' },
            },
          ],
          error: null,
        }),
      };

      mockSupabase.from
        .mockReturnValueOnce(membershipChain)
        .mockReturnValueOnce(usersListChain);

      mockRequest = new Request('http://localhost:3000/api/admin/users');

      const response = await getUsers(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.users).toEqual([
        {
          id: 'user-123',
          email: 'ana@example.com',
          name: 'Ana QA',
          role: 'admin',
          status: 'active',
          lastLogin: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          assignedClientIds: [],
        },
      ]);
      expect(usersListChain.eq).toHaveBeenCalledWith('organization_id', 'org-123');
    });

    it('should handle empty user list', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const membershipChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-123', org_role: 'owner' },
          error: null,
        }),
      };
      const usersListChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: [], error: null }),
      };

      mockSupabase.from
        .mockReturnValueOnce(membershipChain)
        .mockReturnValueOnce(usersListChain);

      mockRequest = new Request('http://localhost:3000/api/admin/users');

      const response = await getUsers(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.users).toEqual([]);
    });
  });

  describe('POST /api/admin/users', () => {
    it('should return 400 if email is missing', async () => {
      const body = {
        name: 'New User',
        role: 'user',
      };

      mockRequest = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const response = await createUser(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toContain('Email is required');
    });

    it('should return 400 if request body is invalid JSON', async () => {
      mockRequest = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        body: 'invalid json',
      });

      const response = await createUser(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toContain('Invalid request body');
    });

    it('should return 401 if user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Unauthorized'),
      });

      const body = {
        email: 'newuser@example.com',
        name: 'New User',
      };

      mockRequest = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const response = await createUser(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('should return 403 if user is not organization owner', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-123', org_role: 'member' },
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      const body = {
        email: 'newuser@example.com',
        name: 'New User',
      };

      mockRequest = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const response = await createUser(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error).toContain('Only organization owners can create users');
    });

    it('should return 500 if membership query fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      const body = {
        email: 'newuser@example.com',
      };

      mockRequest = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const response = await createUser(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error).toBe('Database error');
    });

    it('should create user with valid input', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-123', org_role: 'owner' },
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      const body = {
        email: 'newuser@example.com',
        name: 'New User',
        role: 'user',
      };

      mockRequest = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const response = await createUser(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.email).toBe('newuser@example.com');
      expect(json.name).toBe('New User');
      expect(json.role).toBe('user');
      expect(json.status).toBe('active');
      expect(json.password).toBeDefined();
    });

    it('should trim whitespace from email and name', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-123', org_role: 'owner' },
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      const body = {
        email: '  newuser@example.com  ',
        name: '  New User  ',
      };

      mockRequest = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const response = await createUser(mockRequest);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.email).toBe('newuser@example.com');
      expect(json.name).toBe('New User');
    });

    it('should default role to user if not provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: 'org-123', org_role: 'owner' },
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      const body = {
        email: 'newuser@example.com',
      };

      mockRequest = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const response = await createUser(mockRequest);
      const json = await response.json();

      expect(json.role).toBe('user');
    });
  });
});
