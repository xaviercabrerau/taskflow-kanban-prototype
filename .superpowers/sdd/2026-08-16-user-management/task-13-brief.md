# Task 13 Brief: Extend JWT Token with Role Field

**Objective:** Verify and ensure JWT authentication tokens include the user's role field in the token payload.

**Part of:** User Management System - Semana 3 Punto 5  
**Previous Tasks:** Tasks 1-12 complete (API and UI fully implemented)  
**Estimated Time:** 30 minutes

---

## Specification

### Requirement

**JWT Token Payload Structure**

Current token structure (from Task 4 - JWT authentication):
```typescript
interface AuthToken {
  sub: string;        // User ID (UUID)
  role: UserRole;     // Role: 'admin' | 'user' | 'viewer'
  iat: number;        // Issued at (timestamp)
  exp: number;        // Expiration (timestamp)
}
```

**Task:** Verify the role field is **currently present** in the JWT payload. If not, add it.

### Why This Matters

The role field in the token is used for:
1. **Admin page protection** (Task 11: checks `decoded.role === 'admin'`)
2. **API authorization** (Tasks 5-10: all routes check `token.role === 'admin'`)
3. **UI-level role display** (Task 12: shows role badges)

If the token is missing the role field, authorization checks will fail.

---

## Current Implementation Check

### Files to Review

1. **`lib/jwt.ts`** — JWT creation and verification
   - `verifyToken()` function — extracts and returns AuthToken
   - Check: Does it return the `role` field from the token payload?

2. **`app/api/auth/login/route.ts`** (from Task 4)
   - Check: Does `sign()` include `role` in the payload?
   - Current code should pass `{ sub, role, iat, exp }` to JWT.sign()

3. **`app/admin/layout.tsx`** (from Task 11)
   - Line where it checks: `decoded.role !== 'admin'`
   - This assumes role is in the token

4. **API routes** (from Tasks 5-10)
   - All routes use pattern: `token.role === 'admin'` in verifyAdminAuth()
   - This assumes role is in the token

---

## Implementation Checklist

- [ ] Read `lib/jwt.ts` and verify `verifyToken()` returns `AuthToken` with `role` field
- [ ] Read `app/api/auth/login/route.ts` and verify JWT payload includes `role`
- [ ] Verify the role comes from the database (from `profiles` or `organization_members` table)
- [ ] Check if any fixes are needed to include role in token creation
- [ ] Verify `npm run build` succeeds without errors
- [ ] Create or update the token to include role if missing

### If Role is Missing from Token

**Add role to JWT payload in `app/api/auth/login/route.ts`:**

```typescript
// After verifying user credentials, before signing token:
const user = await getUser(email); // Your existing user fetch
const role = getUserRole(user);    // Extract role from user/org data

const token = jwt.sign(
  {
    sub: user.id,
    role: role,  // ADD THIS LINE if missing
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
  },
  process.env.JWT_SECRET!
);
```

### If Role is Already in Token

- No changes needed
- Verify that `verifyToken()` properly extracts and types it as `AuthToken`
- Move to Task 14

---

## Testing

After implementation, verify:

1. **Login endpoint returns valid token**
   - POST `/api/auth/login` with valid credentials
   - Response includes `token` field
   - Decode token (using jwt.io or test script)
   - Token payload contains `role` field ✅

2. **Decoded token has correct structure**
   ```
   {
     "sub": "uuid...",
     "role": "admin",
     "iat": 1692345678,
     "exp": 1692432078
   }
   ```

3. **Admin page uses role for auth check**
   - Admin page layout checks: `decoded.role === 'admin'` ✅
   - Non-admin users redirected to home ✅

4. **API routes use role for authorization**
   - GET /api/admin/users requires admin role ✅
   - Non-admin requests return 403 Forbidden ✅

5. **Build succeeds**
   - `npm run build` completes without errors ✅
   - No TypeScript errors ✅

---

## Commit Message (If Changes Needed)

Format: `fix: Ensure JWT token includes role field in payload`

Include:
- JWT payload now includes role field
- Role extracted from user/organization data
- All auth checks verify role correctly
- Admin page and API authorization working

---

## Notes

- This task is **verification + minimal fix** if needed
- Role field should already be in the token from Task 4 implementation
- If it's missing, adding it is a small change (~2-3 lines)
- This task ensures the entire auth system works correctly for Tasks 11 & 12

---

## Success Criteria

✅ JWT token contains `role` field in payload  
✅ `verifyToken()` extracts and returns role in AuthToken interface  
✅ Admin page auth check works (redirects non-admins)  
✅ API authorization checks work (returns 403 for non-admin)  
✅ Build succeeds  
✅ No TypeScript errors
