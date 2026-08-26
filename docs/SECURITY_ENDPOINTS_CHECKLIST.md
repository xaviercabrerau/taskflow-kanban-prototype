# Security Testing Endpoints Checklist

This document tracks which security-critical endpoints need to be implemented for the TaskFlow Notification System before production deployment.

## Executive Summary

**Status:** 3 critical endpoints pending implementation  
**Priority:** HIGH - Required for GDPR compliance and production security  
**Target Completion:** Before first production deployment  

## Endpoint Status Matrix

| Endpoint | Purpose | Status | Priority | GDPR Required | Owner | Target Sprint |
|----------|---------|--------|----------|---------------|-------|---|
| `/api/admin/delete-user` | GDPR: Right to erasure | ⚠️ Planned | **CRITICAL** | YES | Backend | v1.0 |
| `/api/admin/export-data` | GDPR: Data portability | ⚠️ Planned | **CRITICAL** | YES | Backend | v1.0 |
| `/api/admin/audit-logs` | Compliance: Audit trail | ⚠️ Planned | **HIGH** | NO | Backend | v1.0 |
| `/api/health` | Health check | ✅ Implemented | LOW | NO | DevOps | - |
| `/api/admin/users` | User management | ✅ Implemented | MEDIUM | NO | Backend | - |
| `/api/admin/notification-preferences` | Preference management | ✅ Implemented | MEDIUM | NO | Backend | - |
| `/api/webhooks/gmail-reply` | Email replies | ✅ Implemented | MEDIUM | NO | Backend | - |

## Pending Implementations

### 1. `DELETE /api/admin/delete-user` - GDPR Right to Erasure

**Purpose:** Allow authorized users to permanently delete another user's account and associated data  
**Legal Basis:** GDPR Article 17 (Right to be forgotten)  
**Status:** Not yet implemented

#### Requirements

**Request:**
```http
POST /api/admin/delete-user
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "reason": "user_request",  // user_request | admin_cleanup | account_issue
  "confirm": true             // Must explicitly confirm
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "deletion_queued",
  "deleted_at": "2026-08-18T14:30:00Z",
  "message": "User deletion queued. Process may take up to 30 days."
}
```

**Error Responses:**
- `400` - Invalid request (missing user_id, confirm=false)
- `401` - Not authenticated
- `403` - Not organization owner
- `404` - User not found
- `409` - User has active billing; complete payment first
- `500` - Database error

#### Implementation Checklist

- [ ] Add endpoint route at `/api/admin/delete-user`
- [ ] Require authentication (JWT token)
- [ ] Require authorization (organization owner role)
- [ ] Validate request body (user_id required, confirm must be true)
- [ ] Log deletion request to audit trail
- [ ] Delete user authentication record (Supabase Auth)
- [ ] Delete user profile record
- [ ] Delete user organization memberships
- [ ] Delete associated notification preferences
- [ ] Delete associated notification history (anonymize if immutable)
- [ ] Delete associated email logs
- [ ] Delete associated API keys/tokens
- [ ] Delete any webhooks associated with user
- [ ] Queue background job for "soft delete" (30-day retention for compliance)
- [ ] Send confirmation email to organization owner
- [ ] Return deletion timestamp for record-keeping

#### Security Considerations

- ✅ Only organization owners can delete users
- ✅ Cannot delete self (prevent accidental account loss)
- ✅ Require explicit confirmation (prevent accidental API calls)
- ✅ Log all deletion attempts (audit trail)
- ✅ Implement 30-day grace period (GDPR requirement)
- ✅ Audit retention: keep deletion records for 7 years (compliance)
- ⚠️ TODO: Send notification to deleted user
- ⚠️ TODO: Implement backup retention policy

#### Timeline

- **Implementation:** 2-3 days
- **Testing:** 2-3 days
- **QA/Review:** 2 days
- **Documentation:** 1 day

---

### 2. `GET /api/admin/export-data` - GDPR Data Portability

**Purpose:** Export all user data in portable format (JSON/CSV)  
**Legal Basis:** GDPR Article 20 (Data portability)  
**Status:** Not yet implemented

#### Requirements

**Request:**
```http
GET /api/admin/export-data?user_id=550e8400-e29b-41d4-a716-446655440000&format=json
Authorization: Bearer {JWT}
```

**Query Parameters:**
- `user_id` (required): UUID of user to export
- `format` (optional): `json` (default) or `csv`
- `include_attachments` (optional): `true` or `false` (default)

**Response (200 OK - application/json):**
```json
{
  "export_id": "export-550e8400-e29b-41d4-a716-446655440000",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-08-18T14:30:00Z",
  "includes": ["profile", "notifications", "preferences", "audit_logs"],
  "data": {
    "profile": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "full_name": "John Doe",
      "created_at": "2024-01-01T00:00:00Z"
    },
    "notifications": [
      {
        "id": "notif-123",
        "type": "task_assigned",
        "title": "Task Assigned",
        "message": "You were assigned a task",
        "created_at": "2026-08-18T10:00:00Z"
      }
    ],
    "preferences": {
      "email_notifications": true,
      "notification_frequency": "daily",
      "opt_in_marketing": false
    },
    "audit_logs": [
      {
        "action": "login",
        "ip_address": "192.168.1.1",
        "user_agent": "Mozilla/5.0...",
        "timestamp": "2026-08-18T08:00:00Z"
      }
    ]
  }
}
```

**Error Responses:**
- `400` - Invalid request (missing user_id, unsupported format)
- `401` - Not authenticated
- `403` - User cannot export other users' data (unless owner)
- `404` - User not found
- `500` - Database error

#### Implementation Checklist

- [ ] Add endpoint route at `/api/admin/export-data`
- [ ] Require authentication (JWT token)
- [ ] Enforce access control (can only export own data or owned users)
- [ ] Query user profile data
- [ ] Query associated notifications (paginated if large)
- [ ] Query notification preferences
- [ ] Query audit logs (login attempts, data access)
- [ ] Query email delivery history (sanitized)
- [ ] Support JSON export format
- [ ] Support CSV export format (optional)
- [ ] Support ZIP download with attachments (optional)
- [ ] Implement streaming for large exports (don't load all in memory)
- [ ] Set proper Content-Type headers (`application/json` or `text/csv`)
- [ ] Add rate limiting (max 1 export per hour per user)
- [ ] Log export requests (audit trail)
- [ ] Return 200 OK with data

#### Security Considerations

- ✅ Users can only export their own data
- ✅ Organization owners can export member data
- ✅ PII is included (this is the purpose - data portability)
- ✅ Sanitize user IDs and sensitive fields appropriately
- ✅ Rate limit to prevent abuse
- ✅ Log all export requests (audit trail)
- ⚠️ TODO: Encrypt exported files if containing PII
- ⚠️ TODO: Add expiration to exports

#### Timeline

- **Implementation:** 3-4 days (including streaming)
- **Testing:** 2-3 days
- **QA/Review:** 2 days
- **Documentation:** 1 day

---

### 3. `GET /api/admin/audit-logs` - Compliance Audit Trail

**Purpose:** Retrieve audit logs for compliance and security investigation  
**Legal Basis:** GDPR Article 32 (Security measures), SOC 2 requirement  
**Status:** Not yet implemented

#### Requirements

**Request:**
```http
GET /api/admin/audit-logs?
  start_date=2026-08-01&
  end_date=2026-08-31&
  action=login&
  limit=100&
  offset=0
Authorization: Bearer {JWT}
```

**Query Parameters:**
- `start_date` (optional): ISO 8601 date (default: 30 days ago)
- `end_date` (optional): ISO 8601 date (default: now)
- `user_id` (optional): Filter by user
- `action` (optional): Filter by action type (login, api_call, data_access, etc.)
- `limit` (optional): Pagination limit (default: 100, max: 1000)
- `offset` (optional): Pagination offset (default: 0)

**Response (200 OK):**
```json
{
  "total_count": 1250,
  "limit": 100,
  "offset": 0,
  "logs": [
    {
      "id": "audit-123",
      "timestamp": "2026-08-18T14:30:00Z",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "action": "api_call",
      "resource": "/api/admin/users",
      "method": "GET",
      "ip_address": "192.168.1.1",
      "user_agent": "curl/7.64.1",
      "status_code": 200,
      "request_id": "req-abc123",
      "details": {
        "organization_id": "org-123",
        "affected_users": []
      }
    }
  ]
}
```

**Error Responses:**
- `400` - Invalid date format or parameters
- `401` - Not authenticated
- `403` - User cannot view audit logs
- `500` - Database error

#### Auditable Events to Log

| Action | Trigger | Details Captured |
|--------|---------|-----------------|
| `user_login` | User signs in | user_id, ip, user_agent, timestamp |
| `user_logout` | User signs out | user_id, ip, timestamp |
| `api_call` | API endpoint accessed | method, path, status_code, user_id, ip |
| `data_access` | User views sensitive data | user_id, resource_id, field_names |
| `data_modification` | User creates/updates data | user_id, resource_id, old_value, new_value |
| `data_deletion` | User deletes data | user_id, resource_id, deleted_value |
| `permission_change` | User role/permissions change | user_id, old_role, new_role, changed_by |
| `authentication_failure` | Failed login attempt | email, ip, reason, timestamp |
| `export_data` | GDPR export requested | user_id, requester_id, export_id, timestamp |
| `configuration_change` | System settings changed | setting_name, old_value, new_value, changed_by |

#### Implementation Checklist

- [ ] Add audit log table/collection to database
- [ ] Log all login attempts (success and failure)
- [ ] Log all API calls with:
  - [ ] Timestamp
  - [ ] User ID
  - [ ] HTTP method (GET, POST, PUT, DELETE)
  - [ ] Endpoint path
  - [ ] HTTP status code
  - [ ] Client IP address
  - [ ] User-Agent header
- [ ] Log all data modifications (create, update, delete)
- [ ] Log all permission/role changes
- [ ] Log password resets and account actions
- [ ] Log authentication failures with reason
- [ ] Add endpoint route at `/api/admin/audit-logs`
- [ ] Require authentication (JWT token)
- [ ] Require authorization (organization owner or admin)
- [ ] Implement date range filtering
- [ ] Implement action type filtering
- [ ] Implement pagination (limit + offset)
- [ ] Optimize for large log volumes (proper indexing)
- [ ] Implement log retention policy (7 years for compliance)

#### Security Considerations

- ✅ Only organization owners/admins can view audit logs
- ✅ Cannot view audit logs for other organizations
- ✅ IP addresses logged for traceability
- ✅ User-Agent logged to detect automated access
- ✅ Failed login attempts logged (detect brute force)
- ✅ Immutable audit logs (append-only, no deletion)
- ⚠️ TODO: Hash/encrypt sensitive data in logs
- ⚠️ TODO: Implement tamper detection

#### Timeline

- **Implementation:** 3-4 days
- **Database schema:** 1 day
- **Logging integration:** 2-3 days
- **Testing:** 2 days
- **QA/Review:** 1 day
- **Documentation:** 1 day

---

## Testing Status

### Security Testing Coverage

Current test file: `testing/2-security-testing.sh`

**Test Results for Pending Endpoints:**

```
SECTION 10: Compliance Testing
═══════════════════════════════════════════════════════

Test 10.1: Data deletion functionality...
⚠ Data deletion: HTTP 404 - ENDPOINT NOT FOUND

Test 10.2: Audit logging presence...
⚠ Audit logging: Endpoint not found - NEEDS IMPLEMENTATION

Test 10.3: GDPR data export functionality...
⚠ Data export: Endpoint not found - NEEDS IMPLEMENTATION
```

**Action Items:**
- [ ] Implement all 3 endpoints
- [ ] Re-run security tests to verify implementation
- [ ] Update test file with proper endpoint paths
- [ ] Verify all GDPR tests pass before production

---

## Production Readiness Criteria

### Before v1.0 Release

- [ ] All 3 pending endpoints implemented
- [ ] Security tests: 100% pass rate
- [ ] Audit logging functional (all events captured)
- [ ] Data deletion tested with 30-day grace period
- [ ] Data export tested with multiple formats
- [ ] GDPR data protection impact assessment (DPIA) completed
- [ ] Legal review of compliance implementation
- [ ] Load testing includes audit log queries
- [ ] Monitoring/alerting for compliance violations
- [ ] Documentation for compliance team

### For SOC 2 Certification

- [ ] Audit logs immutable and tamper-proof
- [ ] Audit logs retained for 7+ years
- [ ] Access logs for sensitive operations
- [ ] Encryption audit logs for PII
- [ ] Incident response procedures documented
- [ ] Annual security audit scheduled

---

## Related Documentation

- [API Endpoints Reference](./API_ENDPOINTS.md) - Full endpoint documentation
- [Security Testing Suite](../testing/2-security-testing.sh) - Test automation
- [GDPR Compliance](./PRIVACY_POLICY.md) - Legal requirements
- [Load Testing Guide](./LOAD_TEST_SETUP.md) - Performance testing
- [Deployment Checklist](./DEPLOYMENT.md) - Pre-release verification

---

## Implementation Priority

### Phase 1 (Sprint 1) - CRITICAL
- [ ] `/api/admin/delete-user` - Required for GDPR
- [ ] `/api/admin/export-data` - Required for GDPR

### Phase 2 (Sprint 2) - HIGH
- [ ] `/api/admin/audit-logs` - Required for compliance

### Phase 3+ (Post-MVP) - MEDIUM
- [ ] Enhanced audit trail features
- [ ] Compliance reporting dashboards
- [ ] Integration with SIEM tools

---

## References

- [GDPR Article 17 - Right to be Forgotten](https://gdpr-info.eu/art-17-gdpr/)
- [GDPR Article 20 - Data Portability](https://gdpr-info.eu/art-20-gdpr/)
- [GDPR Article 32 - Security Measures](https://gdpr-info.eu/art-32-gdpr/)
- [SOC 2 Audit Requirements](https://www.aicpa.org/interestareas/informationmanagement/socialmediakit.html)
- [OpenAPI Security Best Practices](https://swagger.io/resources/articles/best-practices-in-api-security/)

---

**Last Updated:** 2026-08-18  
**Maintained By:** Security Team  
**Next Review:** 2026-09-15
