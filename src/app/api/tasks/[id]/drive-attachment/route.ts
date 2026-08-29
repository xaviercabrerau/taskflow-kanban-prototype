import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { extractDriveFileId, getDriveFileMetadata } from "@/lib/google/drive";

/**
 * POST /api/tasks/[id]/drive-attachment
 * Body: { shareLink: string }
 * Attaches a Google Drive file to a task by its share link. Runs
 * server-side (not a direct client → Supabase call like most mutations in
 * this app) because it needs the org's Google access token, which never
 * reaches the browser.
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

  let body: { shareLink?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shareLink = body.shareLink?.trim();
  if (!shareLink) {
    return NextResponse.json({ error: "shareLink es requerido" }, { status: 400 });
  }

  // RLS-scoped select: only succeeds if the caller is a member of the
  // task's organization — same authorization boundary every other
  // task-related read/write in this app relies on.
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
