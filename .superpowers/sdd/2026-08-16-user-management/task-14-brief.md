# Task 14 Brief: Test Suites for API and Services

**Objective:** Implement test suites for the user management API endpoints and service layer.

**Part of:** User Management System - Semana 3 Punto 5  
**Previous Tasks:** Tasks 1-13 complete (all implementation done)  
**Estimated Time:** 2 hours
**Budget Constraint:** Keep tests focused and essential only

---

## Scope

Write tests for critical paths only:

### API Endpoint Tests

Tests for: `POST /api/admin/users`, `GET /api/admin/users`, `PUT /api/admin/users/[id]`, `DELETE /api/admin/users/[id]`

**Critical test cases:**
- ✅ Authorized requests return 200
- ✅ Missing token returns 401
- ✅ Non-admin token returns 403
- ✅ Invalid data returns 400
- ✅ Duplicate email returns 409
- ✅ Last admin protection returns 409
- ✅ User not found returns 404
- ✅ Database errors return 500

### Service Layer Tests

Tests for: `getUserById()`, `createUser()`, `updateUserStatus()`, `deleteUserInDatabase()`, `getUserClients()`

**Test each function for:**
- ✅ Valid input → correct output
- ✅ Invalid input → throws error
- ✅ Database failures → throws DatabaseError

### JWT Tests

Tests for: `verifyToken()`, `signToken()`

**Test cases:**
- ✅ Valid token verified correctly
- ✅ Invalid token returns null
- ✅ Expired token returns null
- ✅ Signed token has correct payload

---

## Test Files to Create

1. `src/app/api/admin/users/__tests__/route.test.ts` - API tests
2. `src/lib/services/__tests__/userService.test.ts` - Service tests
3. `src/lib/__tests__/jwt.test.ts` - JWT tests
4. `jest.config.ts` - Jest config (if missing)

---

## Jest Setup

**package.json scripts:**
```json
{
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage"
}
```

**jest.config.ts:**
```typescript
export default {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};
```

---

## Success Criteria

✅ API endpoint tests pass (GET, POST, PUT, DELETE)  
✅ Service layer tests pass  
✅ JWT utility tests pass  
✅ `npm test` runs without errors  
✅ All critical paths covered  
✅ Build still succeeds  

---

## Commit Message

Format: `test: Add test suites for user management API and services`

Include:
- Jest configuration
- API endpoint tests
- Service layer tests
- JWT utility tests
- Test scripts in package.json

---

## Notes

- Focus on critical flows only (not exhaustive edge cases)
- Mock Supabase and external dependencies
- Use synthetic test data (no production data)
- Tests should run in CI/CD without setup
