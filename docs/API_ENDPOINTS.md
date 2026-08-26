# API Endpoints Reference

All endpoints require authentication (Supabase JWT). Base URL: `/api/admin`

## User Management

### 1. List All Users

```
GET /users
```

**Authentication:** Required (JWT token)  
**Authorization:** Any authenticated user in organization

**Response (200 OK):**
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "admin",
      "status": "active",
      "lastLogin": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "assignedClientIds": []
    }
  ]
}
```

**Error Responses:**
| Code | Scenario |
|------|----------|
| 401 | Not authenticated |
| 403 | User not member of organization |
| 500 | Database error |

---

### 2. Create User

```
POST /users
```

**Authentication:** Required (JWT token)  
**Authorization:** Organization owner only

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "name": "John Doe",
  "role": "admin",
  "clientIds": ["client-uuid-1", "client-uuid-2"]
}
```

**Validation:**
- Email required, must be unique within organization
- Name optional
- Role defaults to "user" if not specified (admin/user/viewer)
- clientIds optional, array of client UUIDs to assign to user

**Response (200 OK):**
```json
{
  "id": "temp-1692345678901",
  "email": "newuser@example.com",
  "name": "John Doe",
  "role": "admin",
  "status": "active",
  "lastLogin": null,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z",
  "assignedClientIds": ["client-uuid-1", "client-uuid-2"],
  "password": "aBc12DeF34gH"
}
```

**Notes:**
- Temporary password is generated and returned in response
- User should be directed to change password on first login
- Currently simulates user creation (does not create Supabase auth account)

**Error Responses:**
| Code | Scenario |
|------|----------|
| 400 | Invalid request body, email required |
| 401 | Not authenticated |
| 403 | Not organization owner |
| 500 | Database error |

---

### 3. Get User by ID

```
GET /users/:id
```

**Parameters:**
- `id` (path): User UUID

**Response (200 OK):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "admin",
  "status": "active",
  "lastLogin": null,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z",
  "assignedClientIds": []
}
```

**Error Responses:**
| Code | Scenario |
|------|----------|
| 401 | Not authenticated |
| 403 | User not in same organization |
| 404 | User not found |
| 500 | Database error |

---

### 3. Create User (New Account)

```
POST /create-user
```

**Authentication:** Required (JWT token)  
**Authorization:** Organization owner only

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "password": "SecurePass123",
  "fullName": "Jane Doe",
  "orgRole": "admin",
  "roleId": "optional-role-uuid",
  "requirePasswordChange": true
}
```

**Validation:**
- Email required, must be valid format
- Password required, minimum 8 characters
- orgRole defaults to "member" if not specified
- fullName and roleId are optional

**Response (200 OK):**
```json
{
  "ok": true,
  "userId": "new-user-uuid",
  "warning": "Optional warning message if non-critical issue occurred"
}
```

**Error Responses:**
| Code | Scenario |
|------|----------|
| 400 | Invalid request body, email already exists |
| 401 | Not authenticated |
| 403 | Not organization owner |
| 500 | Server error, missing SUPABASE_SERVICE_ROLE_KEY |

---

### 4. Link Existing User

```
POST /link-existing-user
```

**Authentication:** Required (JWT token)  
**Authorization:** Organization owner only

**Request Body:**
```json
{
  "email": "existing@example.com",
  "password": "NewPassword123",
  "fullName": "Jane Doe",
  "orgRole": "member",
  "roleId": "optional-role-uuid",
  "requirePasswordChange": false
}
```

**Use Case:** User already has Supabase account but hasn't joined any organization.

**Response (200 OK):**
```json
{
  "ok": true,
  "userId": "existing-user-uuid",
  "warning": "Optional warning if non-critical issue"
}
```

**Error Responses:**
| Code | Scenario |
|------|----------|
| 400 | Invalid body, password too short |
| 401 | Not authenticated |
| 403 | Not organization owner |
| 404 | Email account does not exist in Supabase |
| 409 | User already member of org or another org |
| 500 | Database error or missing service role key |

---

### 5. Update User

```
PUT /users/:id
```

**Authentication:** Required (JWT token)  
**Authorization:** Organization owner only

**Parameters:**
- `id` (path): Target user UUID

**Request Body:**
```json
{
  "name": "Updated Name",
  "role": "admin",
  "status": "active"
}
```

**Response (200 OK):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "Updated Name",
  "role": "admin",
  "status": "active",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-02T00:00:00Z",
  "assignedClientIds": []
}
```

**Error Responses:**
| Code | Scenario |
|------|----------|
| 400 | Invalid request body |
| 401 | Not authenticated |
| 403 | Not organization owner |
| 404 | User not found |
| 500 | Database error |

---

### 6. Delete User

```
DELETE /users/:id
```

**Authentication:** Required (JWT token)  
**Authorization:** Organization owner only

**Parameters:**
- `id` (path): Target user UUID

**Response (200 OK):**
```json
{
  "id": "uuid"
}
```

**Error Responses:**
| Code | Scenario |
|------|----------|
| 401 | Not authenticated |
| 403 | Not organization owner |
| 404 | User not found |
| 409 | Cannot delete last admin in organization |
| 500 | Database error |

---

### 7. Reset Password

```
POST /reset-password
```

**Authentication:** Required (JWT token)  
**Authorization:** Organization owner only

**Request Body:**
```json
{
  "userId": "target-user-uuid",
  "password": "NewPassword123",
  "requirePasswordChange": true
}
```

**Validation:**
- userId and password required
- Password minimum 8 characters
- Target user must belong to requester's organization

**Response (200 OK):**
```json
{
  "ok": true
}
```

**Error Responses:**
| Code | Scenario |
|------|----------|
| 400 | Invalid body, password too short |
| 401 | Not authenticated |
| 403 | Not organization owner, user not in org |
| 404 | User not found |
| 500 | Database error or missing service role key |

---

## Authentication

All endpoints validate:

1. **JWT Token**: Must be valid Supabase Auth token
2. **User Membership**: Requesting user must be member of organization
3. **Authorization**: Specific operations require `org_role = 'owner'`

**Example Request with Auth:**
```bash
curl -H "Authorization: Bearer {JWT_TOKEN}" \
  https://taskflow.app/api/admin/users
```

---

## Status Codes Reference

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request (validation error, missing fields) |
| 401 | Unauthorized (missing or invalid JWT) |
| 403 | Forbidden (auth OK, but insufficient permissions) |
| 404 | Not Found (resource doesn't exist) |
| 409 | Conflict (business rule violation, e.g., last admin) |
| 500 | Internal Server Error (unexpected error) |

---

## Rate Limiting

Rate limiting is applied via Upstash Redis (if configured). Check response headers for:
- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when limit resets

If Upstash is not configured, rate limiting fails open (no limit applied).

---

## Examples

### Create User and List

```bash
# 1. Create user
curl -X POST https://taskflow.app/api/admin/create-user \
  -H "Authorization: Bearer {JWT}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "SecurePass123",
    "fullName": "Jane Doe",
    "orgRole": "member"
  }'

# 2. List all users
curl https://taskflow.app/api/admin/users \
  -H "Authorization: Bearer {JWT}"
```

### Update and Reset Password

```bash
# 1. Update user name and role
curl -X PUT https://taskflow.app/api/admin/users/{userId} \
  -H "Authorization: Bearer {JWT}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "role": "admin"
  }'

# 2. Reset password
curl -X POST https://taskflow.app/api/admin/reset-password \
  -H "Authorization: Bearer {JWT}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "{userId}",
    "password": "NewPassword456",
    "requirePasswordChange": true
  }'
```

