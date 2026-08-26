import { describe, it, expect, beforeEach } from '@jest/globals';
import { UserService, CreateUserInput } from '../userService';
import { SupabaseClient } from '@supabase/supabase-js';

// Mock Supabase client
const createMockSupabase = (): SupabaseClient => {
  return {
    from: jest.fn(),
    auth: {},
  } as unknown as SupabaseClient;
};

describe('UserService', () => {
  let service: UserService;
  let mockSupabase: SupabaseClient;
  const testOrgId = 'org-123';
  const testUserId = 'user-123';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new UserService(mockSupabase);
  });

  describe('getUserById', () => {
    it('should return user profile for valid user', async () => {
      const mockUser = {
        user_id: testUserId,
        org_role: 'member',
        joined_at: '2024-01-01T00:00:00Z',
      };

      const mockProfile = {
        id: testUserId,
        email: 'test@example.com',
        full_name: 'Test User',
      };

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({ data: mockUser, error: null })
          .mockResolvedValueOnce({ data: mockProfile, error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      const result = await service.getUserById(testUserId, testOrgId);

      expect(result).toEqual({
        id: testUserId,
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        status: 'active',
        lastLogin: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        assignedClientIds: [],
      });
    });

    it('should return null if user not found', async () => {
      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      const result = await service.getUserById(testUserId, testOrgId);

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      const mockError = { message: 'Database error' };
      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: mockError }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      const result = await service.getUserById(testUserId, testOrgId);

      expect(result).toBeNull();
    });

    it('should map admin role correctly', async () => {
      const mockUser = {
        user_id: testUserId,
        org_role: 'owner',
        joined_at: '2024-01-01T00:00:00Z',
      };

      const mockProfile = {
        id: testUserId,
        email: 'admin@example.com',
        full_name: 'Admin User',
      };

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({ data: mockUser, error: null })
          .mockResolvedValueOnce({ data: mockProfile, error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      const result = await service.getUserById(testUserId, testOrgId);

      expect(result?.role).toBe('admin');
    });
  });

  describe('getOrganizationUsers', () => {
    it('should return all users in organization', async () => {
      const mockUsers = [
        {
          user_id: 'user-1',
          org_role: 'owner',
          joined_at: '2024-01-01T00:00:00Z',
          profiles: { email: 'owner@example.com', full_name: 'Owner' },
        },
        {
          user_id: 'user-2',
          org_role: 'member',
          joined_at: '2024-01-02T00:00:00Z',
          profiles: { email: 'user@example.com', full_name: 'User' },
        },
      ];

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);
      (mockFromChain.select as jest.Mock).mockReturnValue(mockFromChain);
      (mockFromChain.eq as jest.Mock).mockResolvedValue({ data: mockUsers, error: null });

      const result = await service.getOrganizationUsers(testOrgId);

      expect(result).toHaveLength(2);
      expect(result[0].email).toBe('owner@example.com');
      expect(result[0].role).toBe('admin');
      expect(result[1].email).toBe('user@example.com');
      expect(result[1].role).toBe('user');
    });

    it('should handle empty organization', async () => {
      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);
      (mockFromChain.select as jest.Mock).mockReturnValue(mockFromChain);
      (mockFromChain.eq as jest.Mock).mockResolvedValue({ data: [], error: null });

      const result = await service.getOrganizationUsers(testOrgId);

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);
      (mockFromChain.select as jest.Mock).mockReturnValue(mockFromChain);
      (mockFromChain.eq as jest.Mock).mockResolvedValue({ data: null, error: { message: 'DB Error' } });

      await expect(service.getOrganizationUsers(testOrgId)).rejects.toThrow('Failed to fetch users');
    });
  });

  describe('createUser', () => {
    it('should create user with valid input', async () => {
      const input: CreateUserInput = {
        email: 'newuser@example.com',
        name: 'New User',
        role: 'user',
      };

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      const result = await service.createUser(input, testOrgId);

      expect(result.email).toBe('newuser@example.com');
      expect(result.name).toBe('New User');
      expect(result.status).toBe('active');
    });

    it('should throw error if email is missing', async () => {
      const input: CreateUserInput = {
        email: '',
        name: 'New User',
      };

      await expect(service.createUser(input, testOrgId)).rejects.toThrow('Email is required');
    });

    it('should throw error for invalid email format', async () => {
      const input: CreateUserInput = {
        email: 'invalid-email',
        name: 'New User',
      };

      await expect(service.createUser(input, testOrgId)).rejects.toThrow('Invalid email format');
    });

    it('should throw error if email already exists', async () => {
      const input: CreateUserInput = {
        email: 'existing@example.com',
        name: 'New User',
      };

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'user-123' }, error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      await expect(service.createUser(input, testOrgId)).rejects.toThrow('Email already exists');
    });

    it('should default role to user if not provided', async () => {
      const input: CreateUserInput = {
        email: 'newuser@example.com',
        name: 'New User',
      };

      const mockFromChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      const result = await service.createUser(input, testOrgId);

      expect(result.role).toBe('user');
    });
  });

  describe('updateUserName', () => {
    it('should update user name successfully', async () => {
      const mockFromChain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      const result = await service.updateUserName(testUserId, 'Updated Name');

      expect(result).toBe(true);
    });

    it('should throw error for empty name', async () => {
      await expect(service.updateUserName(testUserId, '')).rejects.toThrow('Name cannot be empty');
    });

    it('should throw error on database failure', async () => {
      const mockFromChain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: { message: 'DB Error' } }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      await expect(service.updateUserName(testUserId, 'New Name')).rejects.toThrow('Failed to update user name');
    });
  });

  describe('updateUserRole', () => {
    it('should update user role to admin', async () => {
      const mockEqChain = {
        eq: jest.fn().mockResolvedValue({ error: null }),
      };

      const mockUpdateChain = {
        eq: jest.fn().mockReturnValue(mockEqChain),
      };

      const mockFromChain = {
        update: jest.fn().mockReturnValue(mockUpdateChain),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      const result = await service.updateUserRole(testUserId, testOrgId, 'admin');

      expect(result).toBe(true);
    });

    it('should update user role to user', async () => {
      const mockEqChain = {
        eq: jest.fn().mockResolvedValue({ error: null }),
      };

      const mockUpdateChain = {
        eq: jest.fn().mockReturnValue(mockEqChain),
      };

      const mockFromChain = {
        update: jest.fn().mockReturnValue(mockUpdateChain),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      const result = await service.updateUserRole(testUserId, testOrgId, 'user');

      expect(result).toBe(true);
    });

    it('should throw error on database failure', async () => {
      const mockEqChain = {
        eq: jest.fn().mockResolvedValue({ error: { message: 'DB Error' } }),
      };

      const mockUpdateChain = {
        eq: jest.fn().mockReturnValue(mockEqChain),
      };

      const mockFromChain = {
        update: jest.fn().mockReturnValue(mockUpdateChain),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockFromChain);

      await expect(service.updateUserRole(testUserId, testOrgId, 'admin')).rejects.toThrow('Failed to update user role');
    });
  });

  describe('deleteUserFromOrganization', () => {
    it('should delete user successfully', async () => {
      const mockCheckChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [{ user_id: 'other-user' }], error: null }),
      };

      const mockDeleteEqChain = {
        eq: jest.fn().mockResolvedValue({ error: null }),
      };

      const mockDeleteChain = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnValue(mockDeleteEqChain),
      };

      (mockSupabase.from as jest.Mock)
        .mockReturnValueOnce(mockCheckChain)
        .mockReturnValueOnce(mockDeleteChain);

      const result = await service.deleteUserFromOrganization(testUserId, testOrgId);

      expect(result).toBe(true);
    });

    it('should throw error if user is last admin', async () => {
      const mockCheckChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [{ user_id: testUserId }], error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockCheckChain);

      await expect(service.deleteUserFromOrganization(testUserId, testOrgId)).rejects.toThrow(
        'Cannot delete the last admin user'
      );
    });

    it('should throw error on database failure', async () => {
      const mockCheckChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [{ user_id: 'other-user' }], error: null }),
      };

      const mockDeleteEqChain = {
        eq: jest.fn().mockResolvedValue({ error: { message: 'DB Error' } }),
      };

      const mockDeleteChain = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnValue(mockDeleteEqChain),
      };

      (mockSupabase.from as jest.Mock)
        .mockReturnValueOnce(mockCheckChain)
        .mockReturnValueOnce(mockDeleteChain);

      await expect(service.deleteUserFromOrganization(testUserId, testOrgId)).rejects.toThrow('Failed to delete user');
    });
  });

  describe('getUserClients', () => {
    it('should return empty array as placeholder', async () => {
      const result = await service.getUserClients(testUserId, testOrgId);

      expect(result).toEqual([]);
    });
  });
});
