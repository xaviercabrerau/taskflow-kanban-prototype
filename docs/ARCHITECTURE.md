# User Management Architecture

## System Layers

### 1. Frontend Layer (React/Next.js)
- **Location**: `/src/app/admin/`, `/src/components/admin/`
- **Components**: AdminShell, CreateUserDialog, UsersTable, UsersTab
- **Responsibilities**:
  - Admin dashboard UI
  - User CRUD forms
  - Role selection
  - Real-time updates via React state

### 2. API Layer (Next.js Route Handlers)
- **Location**: `/src/app/api/admin/`
- **Route Handlers**:
  - `/users` — GET (list), POST (create)
  - `/users/[id]` — GET (read), PUT (update), DELETE (remove)
  - `/create-user` — POST (direct creation)
  - `/link-existing-user` — POST (link existing account)
  - `/reset-password` — POST (password management)
- **Responsibilities**:
  - Authentication & authorization
  - Business logic validation
  - Database operations
  - Error handling

### 3. Database Layer (Supabase PostgreSQL)
- **Location**: Remote Supabase project
- **Tables**:
  - `auth.users` — Supabase Auth (managed by Supabase)
  - `profiles` — User profile data
  - `organization_members` — User-org membership + roles
  - `role_assignments` — RBAC scoped to boards

---

## Authentication Flow

```
User Login
    ↓
Supabase Auth (email + password)
    ↓
JWT Token stored in browser (httpOnly cookie)
    ↓
API request with Authorization header
    ↓
Verify JWT + Extract user_id
    ↓
Check organization_members for org_id
    ↓
Enforce org_role = 'owner' if write operation
    ↓
Execute operation
```

### JWT Claims

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "exp": 1234567890,
  "iat": 1234567800
}
```

**Note**: Roles are NOT stored in JWT. Role is fetched from `organization_members` table per request.

---

## Data Model

### Organization Members

```
organization_members
├── organization_id (FK → organizations)
├── user_id (FK → auth.users)
├── org_role ("owner" | "admin" | "member")
├── joined_at (timestamp)
└── metadata (JSONB, optional)
```

**Unique Constraint**: (organization_id, user_id)

### Role Assignments (RBAC)

```
role_assignments
├── id (uuid)
├── tenant_id (FK → organizations)
├── user_id (FK → auth.users)
├── role_id (FK → roles)
├── scope_type ("board" | "workspace")
├── scope_id (uuid)
├── granted_by (user_id who granted)
└── created_at (timestamp)
```

**Purpose**: Fine-grained board-level access control.

### Profiles

```
profiles
├── id (FK → auth.users)
├── email (from auth.users)
├── full_name (text)
└── metadata (JSONB, optional)
```

---

## Authorization Model

### Organization Level

| Role | Permissions |
|------|-------------|
| Owner | Can create/update/delete any member, reset passwords, assign roles |
| Admin | Can view members, read-only |
| Member | Can view only their own profile |

**Enforcement**: `org_role !== 'owner'` → 403 Forbidden

### Board Level (RBAC)

Permissions are scoped to individual boards via `role_assignments`:
- Each user gets a `role_id` per board
- Roles define specific permissions (view, edit, delete, etc.)
- Queried when user accesses a board

**Enforcement**: Check `role_assignments` where scope_type='board' and scope_id=board_id

---

## Key Implementation Details

### Last Admin Protection

```javascript
// Prevent deletion of last admin
const admins = await db
  .from("organization_members")
  .select("user_id")
  .where({ organization_id, org_role: ["admin", "owner"] });

if (admins.length === 1 && admins[0].user_id === targetUserId) {
  return 409; // Conflict
}
```

### Service Role Key Usage

The `SUPABASE_SERVICE_ROLE_KEY` is required for:

1. **Create User**: `auth.admin.createUser()` — only available to service role
2. **Link User**: `auth.admin.listUsers()` + `auth.admin.updateUserById()` — admin-only operations
3. **Reset Password**: `auth.admin.updateUserById()` — direct password update

**Note**: Never expose service role key to frontend. These operations must happen on the backend.

### Password Requirements

- **Minimum length**: 8 characters
- **Validation**: Enforced on both frontend and backend
- **Hashing**: Handled by Supabase Auth (bcrypt)
- **Force change**: Set via `user_metadata.must_change_password`

---

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | Missing/invalid JWT | Log in again |
| 403 Forbidden | Not org owner | Request owner to perform action |
| 404 Not Found | User/org doesn't exist | Check ID is correct |
| 409 Conflict | Business rule violated (last admin, email exists) | Handle gracefully in UI |
| 500 Internal Server Error | Missing env vars, DB error | Check logs, verify config |

### Missing Environment Variables

If `SUPABASE_SERVICE_ROLE_KEY` is not configured:
- GET/LIST endpoints work (no service role needed)
- POST /create-user, /link-existing-user, /reset-password return 500
- Error message: "El servidor no tiene configurado SUPABASE_SERVICE_ROLE_KEY..."

---

## Scalability Considerations

### Current Limitations
- User search in `/link-existing-user` is paginated (200 per page, max 20 pages = 4000 users)
- Organization size: tested with 50+ members
- No caching of membership data

### Future Optimizations
- Add Redis caching for organization_members (short TTL)
- Implement user search endpoint with full-text search
- Batch operations for bulk user management
- Activity audit logging

---

## Security Considerations

1. **Organization Isolation**: All queries include organization_id filter
2. **Role-Based Access**: Owner checks on all mutation endpoints
3. **No Privilege Escalation**: Cannot change own role via API
4. **Password Security**: Never logged, never returned in responses
5. **Service Role Usage**: Isolated to backend-only endpoints

---

## Development Checklist

When adding new user management features:

- [ ] Add org_id filter to all database queries
- [ ] Check org_role = 'owner' for write operations
- [ ] Validate input on backend (frontend validation is UX only)
- [ ] Test with multiple organizations
- [ ] Test with last admin edge case
- [ ] Add error handling for missing env vars
- [ ] Update this documentation
- [ ] Add tests covering auth scenarios

