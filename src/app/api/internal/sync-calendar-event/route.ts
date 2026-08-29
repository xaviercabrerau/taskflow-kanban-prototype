import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { syncTaskDueDate } from "@/lib/google/calendar";

// Internal-only endpoint, same pattern as /api/internal/notify-event: called
// by a Postgres trigger (via net.http_post) whenever a task's due_date
// changes, so the task's Google Calendar event (if the org has connected
// Google) stays in sync. Never call this from the browser.

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_NOTIFY_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("x-internal-secret");
  if (!provided) return false;
  return timingSafeStringEqual(provided, secret);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    tenantId?: string;
    taskId?: string;
    taskTitle?: string;
    dueDate?: string | null;
    taskUrl?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.tenantId || !body.taskId || !body.taskTitle || !body.taskUrl) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Best-effort, matching notify.ts's convention: a Calendar sync failure
  // (Google down, token expired and refresh fails, etc.) must never surface
  // as an error to the trigger that called this — it already committed the
  // real due-date change to the database.
  try {
    await syncTaskDueDate({
      tenantId: body.tenantId,
      taskId: body.taskId,
      taskTitle: body.taskTitle,
      dueDate: body.dueDate ?? null,
      taskUrl: body.taskUrl,
    });
  } catch (err) {
    console.error("Calendar sync failed", { taskId: body.taskId, error: err instanceof Error ? err.message : String(err) });
  }

  return NextResponse.json({ processed: true });
}
