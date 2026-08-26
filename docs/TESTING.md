# Testing Guide

## Overview

User management tests cover JWT authentication, API route handlers, and database operations. Tests are written in Jest with TypeScript and use mocking for Supabase clients.

## Running Tests

### Run All Tests

```bash
npm test
```

Runs all tests once and exits.

### Watch Mode (Development)

```bash
npm test:watch
```

Re-runs tests when files change. Useful during development.

### Coverage Report

```bash
npm test:coverage
```

Generates coverage report showing:
- Statements covered
- Branches covered
- Functions covered
- Lines covered

**Coverage Goal**: 80%+ for new code

---

## Test Structure

### Location
```
src/app/api/admin/
├── users/
│   └── __tests__/
│       ├── route.test.ts      (GET /users, POST /users)
│       └── [id].route.test.ts  (GET, PUT, DELETE /users/:id)
└── /* other endpoints tested similarly */
```

### Test Files
- `route.test.ts` — Tests for main route (GET list, POST create)
- `[id].route.test.ts` — Tests for dynamic route (GET detail, PUT update, DELETE remove)
- Service unit tests — Tests for helper functions and services

### Test Organization

Each test file follows this structure:

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';

describe('API: /api/admin/users', () => {
  let mockSupabase: any;

  beforeEach(() => {
    // Setup: Mock Supabase client
    mockSupabase = {
      auth: { getUser: jest.fn() },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      // ... other mocks
    };
  });

  describe('GET /api/admin/users', () => {
    it('should return 401 if user is not authenticated', async () => {
      // Arrange
      mockSupabase.auth.getUser.mockResolvedValue({
        error: new Error('Not authenticated'),
        data: { user: null }
      });

      // Act
      const response = await GET(new Request('...'));

      // Assert
      expect(response.status).toBe(401);
    });

    it('should return 403 if user is not org member', async () => {
      // Test implementation...
    });

    // More tests...
  });

  describe('POST /api/admin/users', () => {
    // Tests for POST endpoint...
  });
});
```

---

## Test Coverage

### User Endpoints

| Endpoint | Tests | Coverage |
|----------|-------|----------|
| GET /users | List all, auth, org member check, empty list | 4 |
| POST /users | Create user, validation, auth, owner check | 4 |
| GET /users/:id | Fetch user, auth, org check, not found | 3 |
| PUT /users/:id | Update name, update role, auth, owner check | 4 |
| DELETE /users/:id | Delete user, last admin protection, auth | 4 |

### Additional Endpoints

| Endpoint | Tests | Coverage |
|----------|-------|----------|
| POST /create-user | Direct creation, validation, auth, owner check | 5 |
| POST /link-existing-user | Link account, auth, owner check, already linked | 5 |
| POST /reset-password | Reset password, auth, owner check, validation | 4 |

**Total Test Count**: ~40+ tests covering core user management flows

---

## Key Test Scenarios

### Authentication Tests

```typescript
it('should return 401 if JWT is invalid', async () => {
  mockSupabase.auth.getUser.mockResolvedValue({
    error: new Error('Invalid token'),
    data: { user: null }
  });

  const response = await GET(new Request('...'));
  expect(response.status).toBe(401);
  expect(response.body).toContain('Unauthorized');
});
```

### Authorization Tests

```typescript
it('should return 403 if user is not organization owner', async () => {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-uuid' } }
  });
  
  // Mock membership with 'member' role
  mockSupabase.from().select().eq().maybeSingle.mockResolvedValue({
    data: { org_role: 'member' },
    error: null
  });

  const response = await POST(new Request('...'));
  expect(response.status).toBe(403);
});
```

### Business Logic Tests

```typescript
it('should prevent deletion of last admin', async () => {
  // Setup: Mock only 1 admin exists
  mockSupabase.from().select().eq().in.mockResolvedValue({
    data: [{ user_id: 'admin-uuid' }],
    error: null
  });

  const response = await DELETE(new Request('...'), 
    { params: { id: 'admin-uuid' } });
  
  expect(response.status).toBe(409);
  expect(response.body).toContain('last admin');
});
```

### Input Validation Tests

```typescript
it('should return 400 if email is missing', async () => {
  const requestBody = JSON.stringify({ name: 'John Doe' });
  
  const response = await POST(
    new Request('...', { body: requestBody })
  );
  
  expect(response.status).toBe(400);
  expect(response.body).toContain('Email is required');
});
```

---

## Mocking Strategy

### Supabase Client Mock

Tests mock the Supabase client to avoid database calls:

```typescript
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn()
    },
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis()
  }))
}));
```

### Service Role Mock

For tests that need Supabase service role:

```typescript
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      admin: {
        createUser: jest.fn(),
        updateUserById: jest.fn(),
        getUserById: jest.fn(),
        listUsers: jest.fn()
      }
    },
    from: jest.fn().mockReturnThis()
  }))
}));
```

---

## Running Specific Tests

### Test a Single File

```bash
npm test -- src/app/api/admin/users/__tests__/route.test.ts
```

### Test with Pattern Matching

```bash
# Run only authentication-related tests
npm test -- --testNamePattern="auth"

# Run only POST endpoint tests
npm test -- --testNamePattern="POST"
```

### Debug a Test

```bash
# Run in debug mode with Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand
```

---

## Debugging Failed Tests

### Check Test Output

```bash
npm test -- --verbose
```

Shows detailed output for each test.

### Enable Jest Debugging

Add to jest.config.ts:

```typescript
{
  verbose: true,
  testTimeout: 10000  // Increase timeout for slow tests
}
```

### Common Issues

| Error | Solution |
|-------|----------|
| `Cannot find module '@/...'` | Verify moduleNameMapper in jest.config.ts |
| `Timeout exceeded` | Increase testTimeout or fix async issue |
| `Unexpected mock/unmock` | Clear mocks between tests with jest.clearAllMocks() |
| `Type errors in mock` | Use jest-mock-extended or proper typing |

---

## Coverage Analysis

### View Coverage Report

```bash
npm run test:coverage
```

Output example:

```
-----------|----------|----------|----------|----------|
File       | % Stmts  | % Branch | % Funcs  | % Lines  |
-----------|----------|----------|----------|----------|
All files  |    82.5  |    78.2  |    85.1  |    82.1  |
 admin/    |    85.0  |    80.0  |    87.0  |    84.5  |
-----------|----------|----------|----------|----------|
```

### Improve Coverage

1. **Find untested files**: Look for low coverage files in report
2. **Add missing scenarios**: Tests for error paths, edge cases
3. **Update after refactoring**: Ensure tests still cover all paths

### Coverage Targets

| Metric | Target | Current |
|--------|--------|---------|
| Statements | 80% | ~82% |
| Branches | 75% | ~78% |
| Functions | 80% | ~85% |
| Lines | 80% | ~82% |

---

## Continuous Integration

### CI Pipeline (GitHub Actions)

```yaml
- name: Run Tests
  run: npm test -- --coverage

- name: Upload Coverage
  uses: codecov/codecov-action@v3
```

Tests run automatically on:
- Pull requests
- Push to main branch
- Scheduled daily runs

### Pre-commit Hook

Optional: Run tests before commit

```bash
# .husky/pre-commit
npm test -- --bail
```

---

## Best Practices

1. **Test behavior, not implementation**: Focus on what the API does, not how
2. **Use descriptive names**: Test name should explain the scenario
3. **Keep tests isolated**: Mock all external dependencies
4. **Test error cases**: Don't just test the happy path
5. **Update tests with code**: Change tests when business logic changes
6. **Use factories/fixtures**: Reduce test boilerplate
7. **Avoid test interdependence**: Each test should be independent

---

## Support

For questions about testing:
- Review test files in `__tests__` directories
- Check Jest documentation: https://jestjs.io/
- Check Supabase TypeScript examples: https://supabase.com/docs
