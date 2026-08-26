import { SupabaseClient } from '@supabase/supabase-js';

interface OrganizationMemberWithProfile {
  user_id: string;
  org_role: string;
  joined_at: string;
  profiles: {
    id: string;
    email: string | null;
    full_name: string | null;
  } | null;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  status: 'active' | 'inactive';
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
  assignedClientIds: string[];
}

export interface CreateUserInput {
  email: string;
  name?: string;
  role?: 'admin' | 'user';
  clientIds?: string[];
}

export class UserService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get user by ID with organization context
   */
  async getUserById(userId: string, organizationId: string): Promise<UserProfile | null> {
    const { data: userMembership, error: userError } = await this.supabase
      .from('organization_members')
      .select('org_role, joined_at')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (userError || !userMembership) {
      return null;
    }

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id, email, full_name')
      .eq('id', userId)
      .maybeSingle();

    return {
      id: userId,
      email: profile?.email || '',
      name: profile?.full_name || 'Unknown',
      role: userMembership.org_role === 'owner' ? 'admin' : 'user',
      status: 'active',
      lastLogin: null,
      createdAt: userMembership.joined_at,
      updatedAt: userMembership.joined_at,
      assignedClientIds: [],
    };
  }

  /**
   * Get all users in an organization
   */
  async getOrganizationUsers(organizationId: string): Promise<UserProfile[]> {
    const { data: users, error: usersError } = await this.supabase
      .from('organization_members')
      .select(
        `
        user_id,
        org_role,
        joined_at,
        profiles:user_id(id, email, full_name)
      `
      )
      .eq('organization_id', organizationId);

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    const typedUsers = users as unknown as OrganizationMemberWithProfile[] | null;
    return (typedUsers || []).map((u) => ({
      id: u.user_id,
      email: u.profiles?.email || '',
      name: u.profiles?.full_name || 'Unknown',
      role: u.org_role === 'owner' ? 'admin' : 'user',
      status: 'active',
      lastLogin: null,
      createdAt: u.joined_at,
      updatedAt: u.joined_at,
      assignedClientIds: [],
    }));
  }

  /**
   * Create a new user in organization
   */
  async createUser(input: CreateUserInput, organizationId: string): Promise<UserProfile> {
    void organizationId;
    if (!input.email) {
      throw new Error('Email is required');
    }

    // Validate email format
    if (!this.isValidEmail(input.email)) {
      throw new Error('Invalid email format');
    }

    // Check for duplicate email
    const { data: existing } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('email', input.email)
      .maybeSingle();

    if (existing) {
      throw new Error('Email already exists');
    }

    // For now, return simulated user creation
    // In production, this would call auth endpoint
    return {
      id: 'temp-' + Date.now(),
      email: input.email,
      name: input.name || '',
      role: (input.role || 'user') as 'admin' | 'user',
      status: 'active',
      lastLogin: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assignedClientIds: input.clientIds || [],
    };
  }

  /**
   * Update user status
   */
  async updateUserStatus(userId: string, organizationId: string, status: 'active' | 'inactive'): Promise<UserProfile | null> {
    // Currently no status field in DB, but keep for API compatibility
    void status;
    return this.getUserById(userId, organizationId);
  }

  /**
   * Update user name
   */
  async updateUserName(userId: string, name: string): Promise<boolean> {
    if (!name || name.trim() === '') {
      throw new Error('Name cannot be empty');
    }

    const { error } = await this.supabase
      .from('profiles')
      .update({ full_name: name.trim() })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to update user name: ${error.message}`);
    }

    return true;
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: string, organizationId: string, role: 'admin' | 'user'): Promise<boolean> {
    const newOrgRole = role === 'admin' ? 'admin' : 'member';

    const { error } = await this.supabase
      .from('organization_members')
      .update({ org_role: newOrgRole })
      .eq('user_id', userId)
      .eq('organization_id', organizationId);

    if (error) {
      throw new Error(`Failed to update user role: ${error.message}`);
    }

    return true;
  }

  /**
   * Delete user from organization
   */
  async deleteUserFromOrganization(userId: string, organizationId: string): Promise<boolean> {
    // Check if user is the last admin
    const { data: admins, error: adminsError } = await this.supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .in('org_role', ['admin', 'owner']);

    if (adminsError) {
      throw new Error(`Failed to check admin count: ${adminsError.message}`);
    }

    if (admins && admins.length === 1 && admins[0].user_id === userId) {
      throw new Error('Cannot delete the last admin user');
    }

    const { error } = await this.supabase
      .from('organization_members')
      .delete()
      .eq('user_id', userId)
      .eq('organization_id', organizationId);

    if (error) {
      throw new Error(`Failed to delete user: ${error.message}`);
    }

    return true;
  }

  /**
   * Get client assignments for user
   */
  async getUserClients(userId: string, organizationId: string): Promise<string[]> {
    // Placeholder for future implementation
    // Would query client assignments table
    void userId;
    void organizationId;
    return [];
  }

  /**
   * Helper: Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
