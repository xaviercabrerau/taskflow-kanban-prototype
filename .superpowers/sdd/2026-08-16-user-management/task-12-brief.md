# Task 12 Brief: Users CRUD UI Tab with Forms and Wizards

**Objective:** Implement the "Usuarios" tab content in `/admin` page with create, edit, delete functionality and user management forms.

**Part of:** User Management System - Semana 3 Punto 5  
**Previous Tasks:** Tasks 1-11 complete (API endpoints and dashboard foundation ready)  
**Estimated Time:** 1.5-2 hours

---

## Specification

### Files to Create
- Create: `app/admin/components/UsersTab.tsx` (Main users management tab)
- Create: `app/admin/components/UsersTable.tsx` (Users list table)
- Create: `app/admin/components/CreateUserDialog.tsx` (Create user wizard)
- Create: `app/admin/components/EditUserDialog.tsx` (Edit user form)
- Create: `app/admin/components/DeleteUserConfirm.tsx` (Delete confirmation)
- Create: `app/admin/hooks/useUsersData.ts` (Data fetching and state management)

### Tab Content Structure

**URL:** `/admin?tab=usuarios`  
**Tab Title:** "Usuarios" (already in AdminTabs from Task 11)

**Layout:**
```
┌────────────────────────────────────────┐
│ Usuarios                               │
├────────────────────────────────────────┤
│ [+ Create User]  [Search] [Filters]   │
├────────────────────────────────────────┤
│ ID    | Email     | Name   | Status   │
│ ──────┼────────────┼────────┼──────── │
│ uuid1 | user@...  | John   | Active   │
│ uuid2 | admin@... | Admin  | Active   │
├────────────────────────────────────────┤
│ [Edit] [Delete]  Pagination           │
└────────────────────────────────────────┘
```

---

## Implementation Requirements

### Users Table Component

**Props:**
```typescript
interface UsersTableProps {
  users: GetUserResponse[];
  isLoading: boolean;
  onEdit: (user: GetUserResponse) => void;
  onDelete: (user: GetUserResponse) => void;
  onRefresh: () => Promise<void>;
}
```

**Features:**
- Display users in a sortable, searchable table
- Columns: ID (truncated UUID), Email, Name, Role, Status, Last Login, Actions
- Action buttons: Edit, Delete (with icons or text)
- Show loading state while fetching
- Show empty state message when no users
- Support pagination (10 users per page)
- Responsive table on mobile (horizontal scroll or card view)

**Columns:**
1. **ID** — First 8 chars of UUID + "..." (e.g., "a1b2c3d4...")
2. **Email** — User email
3. **Name** — User display name
4. **Role** — 'admin' | 'user' | 'viewer' with badge styling
5. **Status** — 'active' | 'inactive' with status indicator (green/gray dot)
6. **Last Login** — ISO date or "Never"
7. **Actions** — Edit button, Delete button

**Interactivity:**
- Click Edit button → open EditUserDialog
- Click Delete button → open DeleteUserConfirm
- Search box filters by email or name (client-side, no API call needed)
- Pagination controls at bottom

---

### Create User Dialog (Wizard)

**Behavior:**
- Modal dialog triggered by "[+ Create User]" button
- 3-step wizard:
  1. **Step 1: Basic Info** — Email, Name, Role
  2. **Step 2: Review** — Confirm details before creating
  3. **Step 3: Success** — Show generated temp password, copy button

**Fields (Step 1):**
- `email` (text, required, unique validation via API)
- `name` (text, required)
- `role` (dropdown: admin | user | viewer, default: user)
- `clientIds` (multi-select, optional, assign clients)

**Validation:**
- Email required, valid format
- Name required, 2+ characters
- API call to POST /api/admin/users to create user
- Handle 409 if email exists (show error)
- Handle 400 for validation errors

**Step 2 (Review):**
- Display email, name, role, assigned clients (count)
- [← Back] [Create] buttons

**Step 3 (Success):**
- "User created successfully!"
- Display temporary password in monospace font
- Copy to clipboard button
- Message: "Share this password with the user. They will be prompted to change it on first login."
- [Done] button to close dialog and refresh table

**Styling:**
- Modal overlay
- Responsive width (90% on mobile, max 600px on desktop)
- Clear step indicators (1/2/3 or dots)

---

### Edit User Dialog

**Behavior:**
- Modal triggered by clicking Edit on a user row
- Allow editing: Name, Role, Status (active/inactive)
- Cannot edit email (primary identifier)
- Show current assigned clients

**Fields:**
- `name` (text, editable)
- `role` (dropdown: admin | user | viewer)
- `status` (radio or toggle: Active / Inactive)
- `clientIds` (multi-select, show current assignments)

**Validation:**
- Name required, 2+ characters
- API call to PUT /api/admin/users/[id] to update
- Show loading state during save
- Handle 404 if user not found (show error)
- Handle 409 if trying to deactivate last admin (show error with message)

**Success:**
- Close dialog
- Refresh table
- Optional: Toast notification "User updated"

**Styling:**
- Modal overlay
- Same responsive sizing as Create dialog
- [Cancel] [Save] buttons

---

### Delete User Confirmation

**Behavior:**
- Modal/dialog triggered by Delete button
- Show user email and name
- Warn: "This action cannot be undone"
- If user is the only admin, show error: "Cannot delete the last admin user"
- If admin trying to deactivate themself, suggest deactivate instead

**Content:**
```
Are you sure you want to delete {user.email}?

This will:
- Remove the user account
- Clear all assigned clients
- Delete all audit logs for this user
- This action cannot be undone.

[Cancel] [Delete]
```

**Validation:**
- API call to DELETE /api/admin/users/[id]
- Handle 404 if user not found
- Handle 409 if last admin (show error, disable delete button)
- Show loading state during delete

**Success:**
- Close dialog
- Refresh table
- Optional: Toast notification "User deleted"

**Styling:**
- Danger styling (red button for Delete)
- Clear warning typography

---

### Data Hook: `useUsersData`

**Purpose:** Centralize API calls and state management for users list

```typescript
interface UseUsersDataReturn {
  users: GetUserResponse[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchUsers: () => Promise<void>;
  createUser: (data: CreateUserRequest) => Promise<{ password: string }>;
  updateUser: (id: string, data: UpdateUserRequest) => Promise<GetUserResponse>;
  deleteUser: (id: string) => Promise<void>;
  assignClients: (id: string, clientIds: string[]) => Promise<GetUserResponse>;
}

function useUsersData(): UseUsersDataReturn {
  // Implementation
}
```

**Features:**
- Fetch users from GET /api/admin/users on mount
- Auto-refresh after create/update/delete
- Error handling with user-friendly messages
- Loading states for each operation
- Auth header with JWT token from localStorage
- Retry logic for failed requests (max 3 retries)

---

### UsersTab Component

**Purpose:** Main container for the Usuarios tab

**Behavior:**
- Render UsersTable
- Render Create button
- Manage create/edit/delete dialog state
- Use useUsersData hook for data
- Show loading spinner while fetching
- Show error message if fetch fails
- Refresh data after CRUD operations

**State:**
```typescript
const [users, setUsers] = useState<GetUserResponse[]>([]);
const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
const [selectedUser, setSelectedUser] = useState<GetUserResponse | null>(null);
```

---

## Design Requirements

**Styling:**
- Use existing design system/Tailwind (same as Task 11)
- Consistent button styling: Primary (blue), Danger (red), Secondary (gray)
- Status badges: Active = green, Inactive = gray
- Role badges: Admin = red, User = blue, Viewer = purple
- Loading spinner from existing library or simple CSS
- Toast notifications for success/error (optional, nice-to-have)

**Colors:**
- Primary action buttons: blue-600
- Danger buttons: red-600
- Active status: green-600
- Inactive status: gray-400
- Admin badge: red-100/red-700
- User badge: blue-100/blue-700
- Viewer badge: purple-100/purple-700

**Accessibility:**
- Modal dialogs have `role="dialog"` and `aria-labelledby` 
- Buttons have `aria-label` if icon-only
- Focus management: focus trap in modals
- Keyboard support: ESC closes dialogs
- Semantic HTML (`<table>`, `<tr>`, `<td>`)
- ARIA labels for form inputs
- Error messages linked to inputs with `aria-describedby`

**Responsive:**
- Table scrolls horizontally on mobile (< 768px)
- Dialogs use 90% width on mobile, max-width 600px on desktop
- Buttons full-width on mobile forms
- Search box responsive width

---

## API Integration

### Authentication
- Extract JWT token from localStorage (already done in Task 11 layout)
- Pass in `Authorization: Bearer {token}` header
- Handle 401 responses (redirect to login if needed)

### Endpoints Used

1. **GET /api/admin/users** — Fetch all users
   - Response: `{ users: GetUserResponse[] }`
   - Status: 200 OK, 401 Unauthorized, 403 Forbidden, 500 Server Error

2. **POST /api/admin/users** — Create user
   - Request: `{ email, name, role, clientIds? }`
   - Response: `{ id, password, ... }`
   - Status: 200 OK, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 409 Conflict (email exists)

3. **PUT /api/admin/users/[id]** — Update user
   - Request: `{ name?, role?, status? }`
   - Response: `GetUserResponse`
   - Status: 200 OK, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict

4. **DELETE /api/admin/users/[id]** — Delete user
   - Response: `{ id }`
   - Status: 200 OK, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict (last admin)

5. **POST /api/admin/users/[id]/assign-clients** — Assign clients to user
   - Request: `{ clientIds: string[] }`
   - Response: `GetUserResponse`

---

## Testing

After implementation, verify:

1. **Users Table**
   - ✅ Displays all users with correct fields
   - ✅ Table is sortable by clicking column headers (optional, nice-to-have)
   - ✅ Search filters users by email/name
   - ✅ Pagination works (10 per page)
   - ✅ Empty state shown when no users
   - ✅ Loading spinner shown while fetching

2. **Create User Dialog**
   - ✅ Dialog opens on [+ Create User] click
   - ✅ Step 1: Can enter email, name, role
   - ✅ Email validation: rejects invalid format
   - ✅ Email uniqueness: API rejects duplicate, shows error
   - ✅ Step 2: Shows review of entered data
   - ✅ Step 3: Shows temporary password after creation
   - ✅ Copy button copies password to clipboard
   - ✅ Dialog closes on [Done], table refreshes

3. **Edit User Dialog**
   - ✅ Dialog opens on Edit button click
   - ✅ Current values pre-filled
   - ✅ Email field is read-only (not editable)
   - ✅ Can change name, role, status
   - ✅ Can modify client assignments
   - ✅ Save button updates user via API
   - ✅ Cannot deactivate last admin (shows error)
   - ✅ Dialog closes on success, table refreshes

4. **Delete Confirmation**
   - ✅ Dialog shows user email/name
   - ✅ Shows warning about irreversible action
   - ✅ Delete button disabled for last admin
   - ✅ Delete button calls API
   - ✅ Dialog closes on success, table refreshes
   - ✅ Error message shown if deletion fails

5. **Mobile Responsive**
   - ✅ Table scrolls horizontally on small screens
   - ✅ Dialogs responsive width
   - ✅ Buttons full-width in forms
   - ✅ Text readable on mobile

6. **Authentication**
   - ✅ All API calls include JWT token
   - ✅ 401 errors handled (redirect to login if needed)
   - ✅ 403 errors show "Not authorized" message

---

## Commit Message

Format: `feat: Add users CRUD UI tab with create/edit/delete dialogs`

Include:
- Users list table with search and pagination
- Create user wizard (3 steps: info, review, success)
- Edit user dialog for updating name, role, status, clients
- Delete user confirmation with last-admin protection
- Data hook for API integration and state management
- Responsive design and accessibility compliance
- All error handling and validation
- Toast notifications for feedback (optional)
