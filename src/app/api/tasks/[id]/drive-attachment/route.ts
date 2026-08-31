import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { extractDriveFileId, getDriveFileMetadata, getDriveFilesMetadata } from "@/lib/google/drive";
import type { Database } from "@/lib/supabase/database.types";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

type AttachmentRow = Database["public"]["Tables"]["attachments"]["Row"];

// Matches the Drive Picker's own multiselect UX (nobody picks hundreds of
// files in one go) while bounding worst-case fan-out: each id triggers one
// Drive API metadata call (Promise.all in getDriveFilesMetadata) plus one
// DB insert, all within a single request.
const MAX_FILE_IDS_PER_REQUEST = 25;

/**
 * POST /api/tasks/[id]/drive-attachment
 * Body: { shareLink: string } (single file, paste-a-link flow) or
 *       { fileIds: string[] } (one or more files, from the Drive Picker).
 * Attaches Google Drive file(s) to a task. Runs server-side (not a direct
 * client → Supabase call like most mutations in this app) because it needs
 * the org's Google access token, which never reaches the browser.
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

  // Each request can fan out into multiple Drive API calls (fileIds branch)
  // and always makes at least one; without a budget here, a caller could
  // hammer this endpoint to burn the org's Drive API quota. Keyed per-user,
  // not per-IP (this route is session-authenticated, not bearer-token like
  // /api/mcp).
  const rateLimit = await checkRateLimit(deriveRateLimitKey(`drive-attachment:${authData.user.id}`));
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  let body: { shareLink?: string; fileIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // RLS-scoped select: only succeeds if the caller is a member of the
  // task's organization — same authorization boundary every other
  // task-related read/write in this app relies on. Each branch below
  // does its own lookup (rather than one shared call site) because the
  // shareLink branch must preserve its original validation order:
  // shareLink presence check BEFORE the task lookup.
  if (Array.isArray(body.fileIds)) {
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("tenant_id")
      .eq("id", taskId)
      .maybeSingle();

    if (taskError || !task) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }

    const fileIds = body.fileIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (fileIds.length === 0) {
      return NextResponse.json({ error: "fileIds no puede estar vacío" }, { status: 400 });
    }
    if (fileIds.length > MAX_FILE_IDS_PER_REQUEST) {
      return NextResponse.json(
        { error: `No se pueden adjuntar más de ${MAX_FILE_IDS_PER_REQUEST} archivos a la vez.` },
        { status: 400 }
      );
    }

    const results = await getDriveFilesMetadata(task.tenant_id, fileIds);
    const attachments: AttachmentRow[] = [];
    const errors: { fileId: string; error: string }[] = [];

    for (const result of results) {
      if ("error" in result) {
        errors.push({ fileId: result.fileId, error: result.error });
        continue;
      }
      const { metadata } = result;
      const { data: attachment, error: insertError } = await supabase
        .from("attachments")
        .insert({
          task_id: taskId,
          file_name: metadata.name,
          file_url: metadata.id,
          external_url: metadata.webViewLink,
          mime_type: metadata.mimeType,
          file_size_bytes: metadata.sizeBytes,
          uploaded_by: authData.user.id,
          source: "google_drive",
        })
        .select("*")
        .single();

      if (insertError || !attachment) {
        errors.push({ fileId: result.fileId, error: insertError?.message ?? "No se pudo guardar el adjunto." });
        continue;
      }
      attachments.push(attachment);
    }

    return NextResponse.json({ attachments, errors });
  }

  const shareLink = body.shareLink?.trim();
  if (!shareLink) {
    return NextResponse.json({ error: "shareLink es requerido" }, { status: 400 });
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("tenant_id")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const fileId = extractDriveFileId(shareLink);
  if (!fileId) {
    return NextResponse.json(
      { error: "No se reconoce ese enlace como un archivo de Google Drive." },
      { status: 400 }
    );
  }

  try {
    const metadata = await getDriveFileMetadata(task.tenant_id, fileId);

    const { data: attachment, error: insertError } = await supabase
      .from("attachments")
      .insert({
        task_id: taskId,
        file_name: metadata.name,
        file_url: metadata.id,
        external_url: metadata.webViewLink,
        mime_type: metadata.mimeType,
        file_size_bytes: metadata.sizeBytes,
        uploaded_by: authData.user.id,
        source: "google_drive",
      })
      .select("*")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ attachment });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
