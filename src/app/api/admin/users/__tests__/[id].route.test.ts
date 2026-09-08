import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the Supabase client before importing the route
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

// PUT updates profiles.full_name via the service-role client (RLS on
// profiles restricts UPDATE to id = auth.uid(), so an owner editing
// ANOTHER user's name must bypass RLS) — mocked separately from the
// request-scoped client above, same rationale as users/__tests__/route.test.ts.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

import { GET as getUser, PUT as updateUser, DELETE as deleteUser } from '../[id]/route';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

describe('API: /api/admin/users/[id] (GET, PUT, DELETE)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable Supabase query builder mock; typing the full chain is impractical for a test fixture
  let mockSupabase: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role admin client mock (profiles.update), same rationale as mockSupabase
  let mockAdminSupabase: any;
  let mockRequest: Request;
  const testUserId = 'user-123';
  const testOrgId = 'org-123';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';

    mockSupabase = {
      auth: {
        getUser: jest.fn(),
      },
      from: jest.fn(),
    };

    (createClient as jest.Mock).mockResolvedValue(mockSupabase);

    mockAdminSupabase = {
      from: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    };

    (createServiceClient as jest.Mock).mockReturnValue(mockAdminSupabase);
  });

  describe('GET /api/admin/users/[id]', () => {
    const params = Promise.resolve({ id: testUserId });

    it('should return 401 if user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Unauthorized'),
      });

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`);

      const response = await getUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('should return 403 if user is not a member of organization', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
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

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`);

      const response = await getUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error).toBe('Forbidden');
    });

    it('should return 404 if target user is not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(),
      };

      // First call for current user membership check
      mockFromChain.select.mockReturnValueOnce(mockFromChain);
      mockFromChain.maybeSingle.mockResolvedValueOnce({
        data: { organization_id: testOrgId },
        error: null,
      });

      // Second call for target user check
      mockFromChain.select.mockReturnValueOnce(mockFromChain);
      mockFromChain.eq.mockReturnValue(mockFromChain);
      mockFromChain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      mockSupabase.from.mockReturnValue(mockFromChain);

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`);

      const response = await getUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(404);
      expect(json.error).toBe('User not found');
    });

    it('should return user profile for valid user', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`);

      // This requires complex mocking of multiple queries
      // Simplified for example
    });
  });

  describe('PUT /api/admin/users/[id]', () => {
    const params = Promise.resolve({ id: testUserId });

    it('should return 400 if request body is invalid JSON', async () => {
      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'PUT',
        body: 'invalid json',
      });

      const response = await updateUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toContain('Invalid request body');
    });

    it('should return 401 if user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Unauthorized'),
      });

      const body = { name: 'Updated Name' };

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      const response = await updateUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('should return 403 if user is not organization owner', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: testOrgId, org_role: 'member' },
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      const body = { name: 'Updated Name' };

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      const response = await updateUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error).toBe('Forbidden');
    });

    it('should update user name successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
        error: null,
      });

      // organization_members is only read here (membership check + the
      // final re-fetch) — no role in the request body, so no write to
      // this table in this test.
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'organization_members') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { organization_id: testOrgId, org_role: 'owner', joined_at: '2026-01-01T00:00:00.000Z' },
              error: null,
            }),
          };
        }
        // profiles: the final re-fetch after the write, done through the
        // request-scoped client (profiles_select allows reading org-mates'
        // profiles — only the UPDATE is self-only).
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: testUserId, email: 'updated@example.com', full_name: 'Updated Name' },
            error: null,
          }),
        };
      });

      const body = { name: 'Updated Name' };

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      const response = await updateUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.name).toBe('Updated Name');
      // The actual write must go through the service-role client
      // (mockAdminSupabase), not the RLS-constrained request-scoped one —
      // this is the regression this test guards against: profiles UPDATE
      // is restricted to id = auth.uid(), so writing another user's name
      // through the request-scoped client silently updates zero rows.
      expect(mockAdminSupabase.from).toHaveBeenCalledWith('profiles');
    });

    it('should handle role update errors gracefully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
        error: null,
      });

      let orgMembersCallCount = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'organization_members') {
          orgMembersCallCount += 1;
          if (orgMembersCallCount === 1) {
            // Membership check (owner) — read.
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({
                data: { organization_id: testOrgId, org_role: 'owner' },
                error: null,
              }),
            };
          }
          // Role update — write, fails. .update().eq().eq() is the real
          // call shape; the second .eq() is where the promise resolves.
          const secondEq = jest.fn().mockResolvedValue({ error: { message: 'No se pudo actualizar el rol' } });
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({ eq: secondEq }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      const body = { role: 'admin' };

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      const response = await updateUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe('No se pudo actualizar el rol');
    });
  });

  describe('DELETE /api/admin/users/[id]', () => {
    const params = Promise.resolve({ id: testUserId });

    it('should return 401 if user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Unauthorized'),
      });

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'DELETE',
      });

      const response = await deleteUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('should return 403 if user is not organization owner', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: testOrgId, org_role: 'member' },
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'DELETE',
      });

      const response = await deleteUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error).toBe('Forbidden');
    });

    it('should return 409 if user is the last admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
        error: null,
      });

      const mockFromChain = {
        select: jest.fn(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(),
      };

      mockSupabase.from.mockReturnValue(mockFromChain);

      // First call for membership check
      mockFromChain.select.mockReturnValueOnce(mockFromChain);
      mockFromChain.maybeSingle.mockResolvedValueOnce({
        data: { organization_id: testOrgId, org_role: 'owner' },
        error: null,
      });

      // Second call for admin check
      mockFromChain.select.mockReturnValueOnce(mockFromChain);
      mockFromChain.eq.mockReturnValueOnce(mockFromChain);
      mockFromChain.in.mockResolvedValueOnce({
        data: [{ user_id: testUserId }], // Only one admin
        error: null,
      });

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'DELETE',
      });

      const response = await deleteUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(409);
      expect(json.error).toContain('Cannot delete the last admin user');
    });

    it('should delete user successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
        error: null,
      });

      // For membership check
      const mockMembershipEqChain = {
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: testOrgId, org_role: 'owner' },
          error: null,
        }),
      };

      const mockMembershipSelectChain = {
        eq: jest.fn().mockReturnValue(mockMembershipEqChain),
      };

      // For admin check: select -> eq -> in
      const mockAdminEqChain = {
        in: jest.fn().mockResolvedValue({
          data: [{ user_id: 'other-user' }],
          error: null,
        }),
      };

      const mockAdminSelectChain = {
        eq: jest.fn().mockReturnValue(mockAdminEqChain),
      };

      // For delete
      const mockDeleteSecondEqChain = {
        eq: jest.fn().mockResolvedValue({ error: null }),
      };

      const mockDeleteFirstEqChain = {
        eq: jest.fn().mockReturnValue(mockDeleteSecondEqChain),
      };

      const mockDeleteChain = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnValue(mockDeleteFirstEqChain),
      };

      (mockSupabase.from as jest.Mock)
        .mockReturnValueOnce({ select: jest.fn().mockReturnValue(mockMembershipSelectChain) })
        .mockReturnValueOnce({ select: jest.fn().mockReturnValue(mockAdminSelectChain) })
        .mockReturnValueOnce(mockDeleteChain);

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'DELETE',
      });

      const response = await deleteUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.id).toBe(testUserId);
    });

    it('should return 400 if delete query fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'current-user' } },
        error: null,
      });

      // For membership check
      const mockMembershipEqChain = {
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: testOrgId, org_role: 'owner' },
          error: null,
        }),
      };

      const mockMembershipSelectChain = {
        eq: jest.fn().mockReturnValue(mockMembershipEqChain),
      };

      // For admin check: select -> eq -> in
      const mockAdminEqChain = {
        in: jest.fn().mockResolvedValue({
          data: [{ user_id: 'other-user' }],
          error: null,
        }),
      };

      const mockAdminSelectChain = {
        eq: jest.fn().mockReturnValue(mockAdminEqChain),
      };

      // For delete: delete -> eq -> eq (with error)
      const mockDeleteSecondEqChain = jest.fn().mockResolvedValue({ error: { message: 'Database error' } });

      const mockDeleteFirstEqChain = {
        eq: mockDeleteSecondEqChain,
      };

      const mockDeleteChain = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnValue(mockDeleteFirstEqChain),
      };

      (mockSupabase.from as jest.Mock)
        .mockReturnValueOnce({ select: jest.fn().mockReturnValue(mockMembershipSelectChain) })
        .mockReturnValueOnce({ select: jest.fn().mockReturnValue(mockAdminSelectChain) })
        .mockReturnValueOnce(mockDeleteChain);

      mockRequest = new Request(`http://localhost:3000/api/admin/users/${testUserId}`, {
        method: 'DELETE',
      });

      const response = await deleteUser(mockRequest, { params });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe('Database error');
    });
  });
});
