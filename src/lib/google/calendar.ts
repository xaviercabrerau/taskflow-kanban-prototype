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

// Separate deterministic-ID namespace ("taskflowmeet...") from the due-date
// sync event above ("taskflow...") — a task can have both a due-date event
// and a scheduled-meeting event without colliding.
function meetEventIdForTask(taskId: string): string {
  return `taskflowmeet${taskId.replace(/-/g, "")}`.toLowerCase().slice(0, 1024);
}

export interface ScheduleMeetingInput {
  tenantId: string;
  taskId: string;
  taskTitle: string;
  taskUrl: string;
  startTime: string; // ISO 8601 datetime
  durationMinutes: number;
  attendeeEmails: string[];
}

export interface ScheduleMeetingResult {
  meetLink: string;
  eventId: string;
}

/**
 * Creates or updates a Calendar event with an auto-generated Google Meet
 * link on the org's connected Google account, inviting `attendeeEmails` —
 * each invitee gets Google's own calendar invite, landing the meeting on
 * their own calendar once accepted. Idempotent per task via a deterministic
 * event ID: calling this again (e.g. to reschedule) updates the same event
 * instead of creating a duplicate.
 */
export async function scheduleTaskMeeting(input: ScheduleMeetingInput): Promise<ScheduleMeetingResult> {
  const accessToken = await getGoogleAccessToken(input.tenantId);
  if (!accessToken) {
    throw new Error("Google no está conectado para esta organización.");
  }

  const eventId = meetEventIdForTask(input.taskId);
  const start = new Date(input.startTime);
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);

  const event = {
    id: eventId,
    summary: input.taskTitle,
    description: `Reunión agendada desde TaskFlow: ${input.taskUrl}`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: input.attendeeEmails.map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  // sendUpdates=all so attendees actually receive Google's invite email;
  // conferenceDataVersion=1 is required for Google to honor conferenceData
  // and generate the Meet link at all — omitting it silently drops it.
  const query = "?conferenceDataVersion=1&sendUpdates=all";
  let res = await fetch(`${CALENDAR_API}/${eventId}${query}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (res.status === 404) {
    // Same PUT-then-fallback-to-POST pattern as syncTaskDueDate above.
    res = await fetch(`${CALENDAR_API}${query}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
  }

  if (!res.ok) {
    throw new Error(`No se pudo agendar la reunión: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    id: string;
    conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
    hangoutLink?: string;
  };

  const meetLink =
    data.hangoutLink ??
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;

  if (!meetLink) {
    throw new Error("Google no devolvió un link de Meet para el evento creado.");
  }

  return { meetLink, eventId: data.id };
}
