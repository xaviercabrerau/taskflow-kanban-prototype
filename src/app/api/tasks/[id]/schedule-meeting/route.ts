import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { scheduleTaskMeeting } from "@/lib/google/calendar";
import { taskUrl } from "@/lib/emails/utils";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 240;

/**
 * POST /api/tasks/[id]/schedule-meeting
 * Body: { startTime: string (ISO datetime); durationMinutes: number }
 * Creates (or, on a later call for the same task, updates — idempotent by
 * design) a Google Meet-enabled Calendar event on the org's connected
 * Google account, inviting the caller and the task's assignee(s). Runs
 * server-side because it needs the org's Google access token.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: taskId } = await params;

  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Creates a real Calendar event and emails invitees on every call —
  // without a budget, an authenticated member could hammer this to spam
  // invite emails via the org's connected Google account.
  const rateLimit = await checkRateLimit(deriveRateLimitKey(`schedule-meeting:${authData.user.id}`));
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  let body: { startTime?: string; durationMinutes?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const startTime = body.startTime;
  const startDate = startTime ? new Date(startTime) : null;
  if (!startTime || !startDate || Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: "Se requiere una fecha y hora válidas." }, { status: 400 });
  }

  const durationMinutes = body.durationMinutes;
  if (
    typeof durationMinutes !== "number" ||
    durationMinutes < MIN_DURATION_MINUTES ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    return NextResponse.json(
      { error: `La duración debe estar entre ${MIN_DURATION_MINUTES} y ${MAX_DURATION_MINUTES} minutos.` },
      { status: 400 }
    );
  }

  // RLS-scoped select: only succeeds if the caller is a member of the
  // task's organization — same authorization boundary every other
  // task-related read/write in this app relies on.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, tenant_id, title, assignee_user_id")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const { data: assigneeRows } = await supabase
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", taskId);

  const assigneeIds = new Set<string>((assigneeRows ?? []).map((r) => r.user_id));
  if (task.assignee_user_id) assigneeIds.add(task.assignee_user_id);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("email")
    .in("id", assigneeIds.size > 0 ? Array.from(assigneeIds) : ["00000000-0000-0000-0000-000000000000"]);

  const attendeeEmails = Array.from(
    new Set(
      [authData.user.email, ...(profiles ?? []).map((p) => p.email)].filter(
        (email): email is string => Boolean(email)
      )
    )
  );

  try {
    const { meetLink, eventId } = await scheduleTaskMeeting({
      tenantId: task.tenant_id,
      taskId: task.id,
      taskTitle: task.title,
      taskUrl: taskUrl(task.id, task.tenant_id),
      startTime: startDate.toISOString(),
      durationMinutes,
      attendeeEmails,
    });

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        meet_link: meetLink,
        meet_scheduled_at: startDate.toISOString(),
        meet_event_id: eventId,
      })
      .eq("id", taskId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ meetLink, scheduledAt: startDate.toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
