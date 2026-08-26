# User Management System

## Overview

TaskFlow's user management system allows organization owners to manage team members, assign roles, and control access. The system is built on Supabase Auth with role-based access control (RBAC) scoped to boards and organizations.

## Features

- **Create Users**: Direct creation with email/password or invite existing Supabase accounts
- **User Roles**: Admin (organization-level) and Member roles
- **Last-Admin Protection**: Prevents deletion of the last admin in an organization
- **Password Management**: Reset passwords and force password changes
- **Organization Scoping**: All operations scoped to the requesting user's organization

## Quick Start

### Access Admin Panel

1. Log in to TaskFlow
2. Navigate to `/admin` (organization owners only)
3. Select the "Usuarios" (Users) tab

### Create a New User

**Option A: Create from Scratch**

1. Click "Crear Usuario" (Create User)
2. Enter email, full name, and password
3. Select role (Admin or Member)
4. Click Create
5. Share credentials with the new user securely

**Option B: Invite Existing Account**

If the email already has a Supabase account (e.g., abandoned signup):

1. Try creating with the email
2. If error occurs, use "Link Existing User" flow
3. Email will be added to your organization

### Manage Users

| Action | How |
|--------|-----|
| View all users | "Usuarios" tab lists all members |
| Update user name | Click user → edit → save |
| Change role | Click user → select new role → save |
| Remove user | Click delete icon (not allowed if last admin) |
| Reset password | Use `/api/admin/reset-password` endpoint |

## Role Model

| Role | Can create users | Can manage users | Can delete users | Can reset passwords |
|------|------------------|------------------|------------------|---------------------|
| Owner | ✓ | ✓ | ✓ | ✓ |
| Admin | × | ✗ | ✗ | ✗ |
| Member | × | ✗ | ✗ | ✗ |

**Note:** Currently, UI only allows owners to perform admin actions. API enforces this with `org_role !== 'owner'` checks.

## Database Schema

### Key Tables

- **auth.users**: Supabase Auth users (email, password hashes)
- **profiles**: User profile data (id, email, full_name)
- **organization_members**: User-to-organization mapping with roles
- **role_assignments**: RBAC per board (tenant_id, user_id, role_id, scope_type, scope_id)

### Relationships

```
auth.users (1) ------ (M) organization_members
                      |
                      +---- (1) profiles (same user_id)

organization_members (1) ------ (M) role_assignments
```

## Error Handling

| Scenario | Response |
|----------|----------|
| Not authenticated | 401 Unauthorized |
| Not an owner | 403 Forbidden |
| Email already exists in org | 409 Conflict |
| Last admin deletion attempt | 409 Conflict |
| Missing required fields | 400 Bad Request |
| Server error | 500 Internal Server Error |

## Configuration

Required environment variables (backend only):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Only for create/link/reset operations
```

## Security Notes

- All endpoints require authentication
- Organization membership is enforced — owners can only manage their organization's members
- Service role key (SUPABASE_SERVICE_ROLE_KEY) is required for account creation and password resets
- Never expose service role key to the client
- Passwords are never returned in responses after creation

## Support

For issues or questions, refer to:
- [API Endpoints Documentation](./API_ENDPOINTS.md)
- [Architecture Guide](./ARCHITECTURE.md)
- [Testing Guide](./TESTING.md)
