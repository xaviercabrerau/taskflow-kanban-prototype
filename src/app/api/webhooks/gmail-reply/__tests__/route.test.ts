/**
 * Tests for the Gmail Reply Webhook Handler.
 *
 * The route was disabled (returns 501) during a security audit fix: it had
 * no real Pub/Sub signature verification (a hardcoded `return true` stub)
 * and used the service-role key to move tasks / insert comments based on
 * attacker-controlled input with no authentication. It also targeted
 * `email_threads`/`failed_jobs` tables whose migrations were never applied
 * to the live database (schema conflict with the pre-existing notifications
 * tables), so it was non-functional regardless. See the sibling
 * /api/gmail-webhook route for the same "not configured yet" pattern.
 */

import { POST } from '../route';

describe('Gmail Reply Webhook (disabled)', () => {
  it('returns 501 and does not process the request', async () => {
    const response = await POST();
    expect(response.status).toBe(501);

    const body = await response.json();
    expect(body.error).toMatch(/no está configurado/i);
  });
});
