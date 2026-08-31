import { render } from "react-email";
import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { sendViaGmail } from "@/lib/google/gmail";
import { taskUrl, formatDate } from "@/lib/emails/utils";
import { priorityLabel, type Priority } from "@/lib/types";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";
import { ForwardTaskTemplate } from "@/lib/emails/templates";

// Simple email-shape check: rejects obviously malformed input and any
// string containing whitespace/newlines, without being a full RFC 5322
// validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/tasks/[id]/forward-email
 * Body: { to: string; note?: string }
 * Forwards a task's summary to an external recipient, sent from the org's
 * connected Gmail account (sendViaGmail), not a generic sender. Runs
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

  // Sends a real email from the org's connected Gmail account — without a
  // budget here, any authenticated member could hammer this endpoint to
  // spam-send from the org's Gmail, risking Google's own spam/throttle
  // response against the org's account. Keyed per-user, not per-IP (this
  // route is session-authenticated, not bearer-token like /api/mcp).
  const rateLimit = await checkRateLimit(deriveRateLimitKey(`forward-email:${authData.user.id}`));
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Has enviado demasiados correos. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  let body: { to?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = body.to?.trim();
  if (!to || /[\r\n]/.test(to)) {
    return NextResponse.json(
      { error: "Se requiere un email de destinatario válido." },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json(
      { error: "Se requiere un email de destinatario válido." },
      { status: 400 }
    );
  }
  const note = body.note?.trim();

  // RLS-scoped select: only succeeds if the caller is a member of the
  // task's organization — same authorization boundary every other
  // task-related read/write in this app relies on.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, tenant_id, title, description, priority, due_date")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const dueDateText = task.due_date ? formatDate(task.due_date, "long") : "sin fecha";

  // Plain-text body stays the source of truth for the text/plain MIME part
  // (kept simple, no HTML-rendering dependency needed for it to degrade
  // gracefully in text-only mail clients).
  const bodyLines = [
    task.title,
    "",
    task.description || "(sin descripción)",
    "",
    `Prioridad: ${priorityLabel(task.priority as Priority)}`,
    `Vencimiento: ${dueDateText}`,
    "",
  ];
  if (note) {
    bodyLines.push(`Nota: ${note}`, "");
  }
  bodyLines.push(`Ver tarea completa: ${taskUrl(task.id, task.tenant_id)}`);

  // HTML body: same branded template used by every other notification
  // email (TaskFlow header, priority badge, due date, optional note).
  // sendViaGmail sends this alongside bodyText as multipart/alternative,
  // so a client that can't render HTML still gets the plain-text version.
  const bodyHtml = await render(
    ForwardTaskTemplate({
      taskTitle: task.title,
      taskDescription: task.description,
      priorityLabel: priorityLabel(task.priority as Priority),
      priorityKey: task.priority,
      dueDateText,
      note: note || undefined,
      taskUrl: taskUrl(task.id, task.tenant_id),
    })
  );

  try {
    await sendViaGmail({
      tenantId: task.tenant_id,
      to,
      subject: task.title,
      bodyText: bodyLines.join("\n"),
      bodyHtml,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
