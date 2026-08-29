/**
 * Google Calendar sync: mirrors a task's due date as a Calendar event on
 * the org's connected Google account. One event per task, tracked via
 * Calendar's own event ID (we generate a deterministic ID from the task ID
 * so create/update/delete are all idempotent without a separate mapping
 * table).
 */

import { getGoogleAccessToken } from "./client";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// Calendar event IDs must be 5-1024 lowercase base32hex chars (RFC 4648
// section 7) — a raw UUID (has hyphens, is not base32hex) doesn't qualify.
// Deriving one deterministically from the task ID keeps sync idempotent
// (same task always maps to the same event) without a mapping table.
function eventIdForTask(taskId: string): string {
  return `taskflow${taskId.replace(/-/g, "")}`.toLowerCase().slice(0, 1024);
}

export interface CalendarSyncInput {
  tenantId: string;
  taskId: string;
  taskTitle: string;
  dueDate: string | null; // YYYY-MM-DD, or null to remove the event
  taskUrl: string;
}

/**
 * Creates, updates, or deletes the Calendar event for a task, depending on
 * whether dueDate is set. No-ops (returns without error) when Google isn't
 * connected for this org — Calendar sync is a nice-to-have layered on top
 * of the task, never a dependency the rest of the app should break on.
 */
export async function syncTaskDueDate(input: CalendarSyncInput): Promise<void> {
  const accessToken = await getGoogleAccessToken(input.tenantId);
  if (!accessToken) return;

  const eventId = eventIdForTask(input.taskId);

  if (!input.dueDate) {
    await fetch(`${CALENDAR_API}/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {
      // Deleting an event that doesn't exist (already removed, or never
      // created because there was no due date before) is not an error.
    });
    return;
  }

  const event = {
    id: eventId,
    summary: input.taskTitle,
    description: `Tarea en TaskFlow: ${input.taskUrl}`,
    start: { date: input.dueDate },
    end: { date: input.dueDate },
    source: { title: "TaskFlow", url: input.taskUrl },
  };

  // PUT to the specific event ID both creates (if absent) and updates (if
  // present) in the Calendar API — no need to branch on "does it exist yet".
  const res = await fetch(`${CALENDAR_API}/${eventId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (res.status === 404) {
    // PUT to a nonexistent event ID 404s instead of creating it in this API
    // — fall back to POST (create) using the same explicit id.
    const createRes = await fetch(CALENDAR_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
    if (!createRes.ok) {
      throw new Error(`No se pudo crear el evento de Calendar: ${await createRes.text()}`);
    }
    return;
  }

  if (!res.ok) {
    throw new Error(`No se pudo actualizar el evento de Calendar: ${await res.text()}`);
  }
}
