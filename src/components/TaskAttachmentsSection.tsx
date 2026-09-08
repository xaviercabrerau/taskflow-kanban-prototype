"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useAdminData } from "@/context/AdminDataContext";
import {
  fetchAttachments,
  uploadAttachment,
  deleteAttachment,
  getAttachmentSignedUrl,
  type TaskAttachment,
} from "@/lib/supabase/attachments-repo";
import type { Database } from "@/lib/supabase/database.types";
import { openDrivePicker } from "@/lib/google/picker-client";

interface TaskAttachmentsSectionProps {
  taskId: string;
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskAttachmentsSection({ taskId }: TaskAttachmentsSectionProps) {
  const { supabase, userId, tenantId } = useBoard();
  const { integrations } = useAdminData();
  const googleConnected = integrations.some((i) => i.provider === "google" && i.hasCredential && i.isActive);

  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [driveLink, setDriveLink] = useState("");
  const [attachingDrive, setAttachingDrive] = useState(false);
  const [pickerAttaching, setPickerAttaching] = useState(false);
  const [attachmentsLoading, setAttachmentsLoading] = useState(true);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Adjuntos es una sección "core" del modal — se carga de inmediato al
  // montar, igual que antes cuando vivía en el efecto combinado de
  // TaskModal.tsx (Tarea 9 del plan de 2026-09-04).
  useEffect(() => {
    let cancelled = false;
    fetchAttachments(supabase, taskId)
      .then((data) => {
        // Merge en vez de reemplazar — misma razón que TaskChecklistSection.tsx.
        if (!cancelled) {
          setAttachments((prev) => {
            const ids = new Set(data.map((a) => a.id));
            const localOnly = prev.filter((a) => !ids.has(a.id));
            return [...localOnly, ...data];
          });
        }
      })
      .catch((err) => {
        console.error("No se pudieron cargar los adjuntos:", err);
        if (!cancelled) setAttachmentsError("No se pudieron cargar los adjuntos.");
      })
      .finally(() => {
        if (!cancelled) setAttachmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, taskId]);

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !tenantId) return;
    setUploading(true);
    try {
      const created = await uploadAttachment(supabase, tenantId, taskId, file, userId);
      setAttachments((prev) => [created, ...prev]);
      setAttachmentsError(null);
    } catch (err) {
      console.error("No se pudo subir el adjunto:", err);
      setAttachmentsError("No se pudo subir el archivo.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAttachment(attachment: TaskAttachment) {
    try {
      await deleteAttachment(supabase, attachment.id, attachment.storagePath, attachment.source);
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
    } catch (err) {
      console.error("No se pudo eliminar el adjunto:", err);
      setAttachmentsError("No se pudo eliminar el archivo.");
    }
  }

  async function handleDownloadAttachment(attachment: TaskAttachment) {
    if (attachment.source === "google_drive") {
      if (attachment.externalUrl) {
        window.open(attachment.externalUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    try {
      const url = await getAttachmentSignedUrl(supabase, attachment.storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("No se pudo generar el enlace de descarga:", err);
      setAttachmentsError("No se pudo generar el enlace de descarga.");
    }
  }

  async function handleAttachDriveLink(e: React.FormEvent) {
    e.preventDefault();
    const link = driveLink.trim();
    if (!link || attachingDrive) return;
    setAttachingDrive(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/drive-attachment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareLink: link }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo adjuntar el archivo.");
      }
      const row = json.attachment as Database["public"]["Tables"]["attachments"]["Row"];
      setAttachments((prev) => [
        {
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
        },
        ...prev,
      ]);
      setDriveLink("");
      setAttachmentsError(null);
    } catch (err) {
      setAttachmentsError(err instanceof Error ? err.message : "No se pudo adjuntar el archivo.");
    } finally {
      setAttachingDrive(false);
    }
  }

  async function handlePickFromDrive() {
    if (pickerAttaching) return;
    setPickerAttaching(true);
    setAttachmentsError(null);
    try {
      const picked = await openDrivePicker();
      if (!picked) return; // cancelled — not an error
      const res = await fetch(`/api/tasks/${taskId}/drive-attachment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: picked.fileIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudieron adjuntar los archivos.");
      }
      const rows = json.attachments as Database["public"]["Tables"]["attachments"]["Row"][];
      const errors = json.errors as { fileId: string; error: string }[];
      if (rows.length > 0) {
        setAttachments((prev) => [
          ...rows.map((row) => ({
            id: row.id,
            taskId: row.task_id,
            fileName: row.file_name,
            storagePath: row.file_url,
            externalUrl: row.external_url,
            source: row.source === "google_drive" ? ("google_drive" as const) : ("upload" as const),
            fileSizeBytes: row.file_size_bytes,
            mimeType: row.mime_type,
            uploadedBy: row.uploaded_by,
            createdAt: row.created_at,
          })),
          ...prev,
        ]);
      }
      if (errors.length > 0) {
        setAttachmentsError(
          errors.length === picked.fileIds.length
            ? "No se pudo adjuntar ningún archivo."
            : `${errors.length} de ${picked.fileIds.length} archivo(s) no se pudieron adjuntar.`
        );
      }
    } catch (err) {
      setAttachmentsError(err instanceof Error ? err.message : "No se pudieron adjuntar los archivos.");
    } finally {
      setPickerAttaching(false);
    }
  }

  return (
    <div className="field task-section">
      <label>Adjuntos</label>
      {attachmentsError ? <p role="alert" className="field-error">{attachmentsError}</p> : null}
      <input
        className="attachment-file-input"
        type="file"
        onChange={handleUploadFile}
        disabled={uploading}
      />
      <div className="comment-input-wrap">
        <input
          value={driveLink}
          onChange={(e) => setDriveLink(e.target.value)}
          placeholder="Pega un enlace de Google Drive para adjuntarlo"
          disabled={attachingDrive}
        />
        <button
          type="button"
          className="btn"
          onClick={handleAttachDriveLink}
          disabled={!driveLink.trim() || attachingDrive}
        >
          {attachingDrive ? "Adjuntando…" : "Adjuntar de Drive"}
        </button>
      </div>
      {googleConnected && (
        <button
          type="button"
          className="btn"
          style={{ marginTop: 12 }}
          onClick={handlePickFromDrive}
          disabled={pickerAttaching}
        >
          {pickerAttaching ? "Abriendo Drive…" : "📁 Elegir de Google Drive"}
        </button>
      )}
      {attachmentsLoading ? (
        <p>Cargando adjuntos…</p>
      ) : attachments.length === 0 ? (
        <p>Sin adjuntos todavía.</p>
      ) : (
        <ul className="attachment-list">
          {attachments.map((a) => (
            <li key={a.id} className="attachment-item">
              <span className="attachment-name">
                {a.source === "google_drive" ? "📁 " : ""}
                {a.fileName} {a.fileSizeBytes != null ? `(${formatFileSize(a.fileSizeBytes)})` : ""}
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn" onClick={() => handleDownloadAttachment(a)}>
                  Descargar
                </button>
                <button type="button" className="btn danger" onClick={() => handleDeleteAttachment(a)}>
                  Eliminar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
