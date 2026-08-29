import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

const BUCKET = "task-attachments";

export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  // Para source "upload": path del objeto en Supabase Storage (bucket
  // privado, se resuelve vía signed URL). Para "google_drive": el file_id
  // de Drive — no vive en Storage, ver externalUrl para el link real.
  storagePath: string;
  externalUrl: string | null;
  source: "upload" | "google_drive";
  fileSizeBytes: number | null;
  mimeType: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

function mapRow(row: Database["public"]["Tables"]["attachments"]["Row"]): TaskAttachment {
  return {
    id: row.id,
    taskId: row.task_id,
    fileName: row.file_name,
    storagePath: row.file_url,
    externalUrl: row.external_url,
    source: row.source === "google_drive" ? "google_drive" : "upload",
    fileSizeBytes: row.file_size_bytes,
    mimeType: row.mime_type,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

// RLS (attachments_all) ya limita a miembros de la organización de la tarea;
// el filtro por task_id aquí es defensivo/legible, no aporta seguridad extra.
export async function fetchAttachments(supabase: TypedClient, taskId: string): Promise<TaskAttachment[]> {
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

// Path convention {tenant_id}/{task_id}/{filename}, requerido por las políticas
// RLS de storage.objects (m29_task_attachments_storage_bucket_and_rls).
export async function uploadAttachment(
  supabase: TypedClient,
  tenantId: string,
  taskId: string,
  file: File,
  uploadedBy: string | null
): Promise<TaskAttachment> {
  const storagePath = `${tenantId}/${taskId}/${file.name}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("attachments")
    .insert({
      task_id: taskId,
      file_name: file.name,
      file_url: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      uploaded_by: uploadedBy,
    })
    .select("*")
    .single();
  if (error) {
    try {
      await supabase.storage.from(BUCKET).remove([storagePath]);
    } catch (cleanupError) {
      console.error("Failed to clean up orphaned storage object after insert failure:", cleanupError);
    }
    throw error;
  }
  return mapRow(data);
}

export async function deleteAttachment(
  supabase: TypedClient,
  attachmentId: string,
  storagePath: string,
  source: "upload" | "google_drive" = "upload"
): Promise<void> {
  // Google Drive attachments have no corresponding Storage object — file_url
  // holds the Drive file ID, not a Storage path — so there's nothing to
  // remove from the bucket.
  if (source === "upload") {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (storageError) throw storageError;
  }

  const { error } = await supabase.from("attachments").delete().eq("id", attachmentId);
  if (error) throw error;
}

// Signed URL de corta duración (60s) para descargar/ver el archivo — el bucket
// es privado, no hay URL pública directa.
export async function getAttachmentSignedUrl(supabase: TypedClient, storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}
