"use client";

import { useEffect, useRef, useState } from "react";
import { ColumnData, Priority, Task, dueBadge } from "@/lib/types";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { fetchComments, addComment, type TaskComment } from "@/lib/supabase/comments-repo";
import type { OrgMember } from "@/lib/supabase/members-repo";
import {
  fetchAttachments,
  uploadAttachment,
  deleteAttachment,
  getAttachmentSignedUrl,
  type TaskAttachment,
} from "@/lib/supabase/attachments-repo";
import { fetchActivity, describeActivity, type TaskActivity } from "@/lib/supabase/activity-repo";
import type { Database } from "@/lib/supabase/database.types";
import { openDrivePicker } from "@/lib/google/picker-client";
import {
  fetchChecklists,
  createChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  type Checklist,
} from "@/lib/supabase/checklist-repo";
import {
  fetchOrgTags,
  fetchTaskTags,
  createTag,
  addTagToTask,
  removeTagFromTask,
  type Tag,
} from "@/lib/supabase/tags-repo";
import { fetchTaskMeetInfo } from "@/lib/supabase/meetings-repo";
const TAG_COLOR_OPTIONS = ["--low", "--medium", "--accent", "--muted", "--high"];

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function memberLabel(member: OrgMember): string {
  return member.fullName || member.email || member.userId;
}

interface TaskModalProps {
  mode: "create" | "edit";
  initial?: Task;
  columns: ColumnData[];
  columnId: string;
  onClose: () => void;
  onSave: (task: Omit<Task, "id">, columnId: string, id?: string) => void;
  onDelete?: (id: string) => void;
}

export default function TaskModal({
  mode,
  initial,
  columns,
  columnId,
  onClose,
  onSave,
  onDelete,
}: TaskModalProps) {
  const { can, supabase, userId, tenantId, members, integrations } = useBoard();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "medium");
  const [assignee, setAssignee] = useState(initial?.assignee ?? "");
  const [tag, setTag] = useState(initial?.tag ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [selectedColumnId, setSelectedColumnId] = useState(columnId);
  const modalRef = useRef<HTMLFormElement>(null);
  useDialogA11y(modalRef, onClose);

  const taskId = mode === "edit" ? initial?.id : undefined;

  const googleConnected = integrations.some(
    (i) => i.provider === "google" && i.hasCredential && i.isActive
  );

  // `members` se carga de forma asíncrona en BoardContext y puede seguir
  // vacío cuando este modal se monta (loading=false no espera a members).
  // Si guardáramos el default en el useState inicial, quedaría fijo en ""
  // para siempre si el usuario abre "+ Nueva tarea" antes de que members
  // termine de cargar. Se calcula como valor derivado en cada render en vez
  // de con un efecto, así reacciona sin necesitar un setState adicional.
  const effectiveAssignee =
    assignee || (mode === "create" && members[0] ? memberLabel(members[0]) : "");

  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(Boolean(taskId));
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [mentionState, setMentionState] = useState<{ prefix: string; start: number } | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [driveLink, setDriveLink] = useState("");
  const [attachingDrive, setAttachingDrive] = useState(false);
  const [pickerAttaching, setPickerAttaching] = useState(false);
  const [attachmentsLoading, setAttachmentsLoading] = useState(Boolean(taskId));
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [forwardEmailOpen, setForwardEmailOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardNote, setForwardNote] = useState("");
  const [forwardingEmail, setForwardingEmail] = useState(false);
  const [forwardResult, setForwardResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [meetFormOpen, setMeetFormOpen] = useState(false);
  const [meetDate, setMeetDate] = useState("");
  const [meetTime, setMeetTime] = useState("");
  const [meetDuration, setMeetDuration] = useState(30);
  const [scheduling, setScheduling] = useState(false);
  const [meetLink, setMeetLink] = useState<string | null>(null);
  const [meetScheduledAt, setMeetScheduledAt] = useState<string | null>(null);
  const [meetError, setMeetError] = useState<string | null>(null);

  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [checklistsLoading, setChecklistsLoading] = useState(Boolean(taskId));
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [newItemLabel, setNewItemLabel] = useState<Record<string, string>>({});
  const [addingChecklist, setAddingChecklist] = useState(false);
  const [addingItemIds, setAddingItemIds] = useState<Set<string>>(new Set());

  const [orgTags, setOrgTags] = useState<Tag[]>([]);
  const [taskTags, setTaskTags] = useState<Tag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(Boolean(taskId));
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLOR_OPTIONS[0]);
  const [creatingTag, setCreatingTag] = useState(false);
  const [pendingTagIds, setPendingTagIds] = useState<Set<string>>(new Set());

  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(Boolean(taskId));
  const [activityError, setActivityError] = useState<string | null>(null);

  function authorName(authorId: string | null): string {
    if (!authorId) return "Automatización";
    const member = members.find((m) => m.userId === authorId);
    return member?.fullName || member?.email || "Usuario";
  }

  function resolveColumnName(colId: string): string | undefined {
    return columns.find((c) => c.id === colId)?.title;
  }

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;

    fetchComments(supabase, taskId)
      .then((data) => {
        // Merge rather than replace: if the user added a comment while this
        // initial load was still in flight, the optimistic entry (already
        // persisted server-side) might not be in `data` yet and would
        // otherwise vanish from the UI until the modal reopens.
        if (!cancelled) {
          setComments((prev) => {
            const ids = new Set(data.map((c) => c.id));
            const localOnly = prev.filter((c) => !ids.has(c.id));
            return [...data, ...localOnly];
          });
        }
      })
      .catch((err) => {
        console.error("No se pudieron cargar los comentarios:", err);
        if (!cancelled) setCommentsError("No se pudieron cargar los comentarios.");
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });

    fetchAttachments(supabase, taskId)
      .then((data) => {
        // Same merge rationale as fetchComments above — see that comment.
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

    fetchChecklists(supabase, taskId)
      .then((data) => {
        // Same merge rationale as fetchComments above — see that comment.
        if (!cancelled) {
          setChecklists((prev) => {
            const ids = new Set(data.map((c) => c.id));
            const localOnly = prev.filter((c) => !ids.has(c.id));
            return [...data, ...localOnly];
          });
        }
      })
      .catch((err) => {
        console.error("No se pudieron cargar los checklists:", err);
        if (!cancelled) setChecklistError("No se pudieron cargar los checklists.");
      })
      .finally(() => {
        if (!cancelled) setChecklistsLoading(false);
      });

    Promise.all([fetchOrgTags(supabase, tenantId ?? ""), fetchTaskTags(supabase, taskId)])
      .then(([allTags, currentTags]) => {
        // orgTags is a plain catalog replace (no local-only-add race, tags
        // are created via a separate org-wide flow, not this task's modal).
        // taskTags gets the same merge rationale as fetchComments above.
        if (!cancelled) {
          setOrgTags(allTags);
          setTaskTags((prev) => {
            const ids = new Set(currentTags.map((t) => t.id));
            const localOnly = prev.filter((t) => !ids.has(t.id));
            return [...currentTags, ...localOnly];
          });
        }
      })
      .catch((err) => {
        console.error("No se pudieron cargar las etiquetas:", err);
        if (!cancelled) setTagsError("No se pudieron cargar las etiquetas.");
      })
      .finally(() => {
        if (!cancelled) setTagsLoading(false);
      });

    fetchActivity(supabase, taskId)
      .then((data) => {
        if (!cancelled) setActivity(data);
      })
      .catch((err) => {
        console.error("No se pudo cargar el historial de actividad:", err);
        if (!cancelled) setActivityError("No se pudo cargar el historial de actividad.");
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });

    fetchTaskMeetInfo(supabase, taskId)
      .then((info) => {
        if (!cancelled) {
          setMeetLink(info.meetLink);
          setMeetScheduledAt(info.meetScheduledAt);
        }
      })
      .catch((err) => {
        console.error("No se pudo cargar el estado de la reunión:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [supabase, taskId, tenantId]);

  const mentionMatches: OrgMember[] =
    mentionState !== null
      ? members
          .filter((m) => m.fullName && m.fullName.toLowerCase().includes(mentionState.prefix.toLowerCase()))
          .slice(0, 6)
      : [];

  function handleCommentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setNewComment(value);
    const cursor = e.target.selectionStart ?? value.length;
    const upToCursor = value.slice(0, cursor);
    const match = /@([^\s@]*)$/.exec(upToCursor);
    if (match) {
      setMentionState({ prefix: match[1], start: match.index });
      setActiveMentionIndex(0);
    } else {
      setMentionState(null);
    }
  }

  function handleCommentKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionState || mentionMatches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveMentionIndex((i) => (i + 1) % mentionMatches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectMention(mentionMatches[activeMentionIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMentionState(null);
    }
  }

  function selectMention(member: OrgMember) {
    if (!mentionState || !member.fullName) return;
    const cursor = commentTextareaRef.current?.selectionStart ?? newComment.length;
    const before = newComment.slice(0, mentionState.start);
    const after = newComment.slice(cursor);
    const insertion = `@${member.fullName} `;
    const updated = `${before}${insertion}${after}`;
    setNewComment(updated);
    setMentionState(null);
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length;
      commentTextareaRef.current?.focus();
      commentTextareaRef.current?.setSelectionRange(pos, pos);
    });
  }

  function resolveMentionedUserIds(body: string): string[] {
    const namedMembers = members
      .filter((m) => m.fullName)
      .sort((a, b) => (b.fullName?.length ?? 0) - (a.fullName?.length ?? 0));
    const found = new Set<string>();
    for (const member of namedMembers) {
      if (member.fullName && body.includes(`@${member.fullName}`)) {
        found.add(member.userId);
      }
    }
    return Array.from(found);
  }

  async function handleAddComment() {
    if (!taskId || !newComment.trim()) return;
    const body = newComment.trim();
    try {
      const created = await addComment(supabase, taskId, body, userId, {
        mentionedUserIds: resolveMentionedUserIds(body),
        parentCommentId: replyingToId,
      });
      setComments((prev) => [...prev, created]);
      setNewComment("");
      setMentionState(null);
      setReplyingToId(null);
      setCommentsError(null);
    } catch (err) {
      console.error("No se pudo agregar el comentario:", err);
      setCommentsError("No se pudo agregar el comentario.");
    }
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !taskId || !tenantId) return;
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
    if (!link || !taskId || attachingDrive) return;
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
    if (!taskId || pickerAttaching) return;
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

  async function handleForwardEmail() {
    const to = forwardTo.trim();
    if (!to || !taskId || forwardingEmail) return;
    setForwardingEmail(true);
    setForwardResult(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/forward-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, note: forwardNote.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo enviar el email.");
      }
      setForwardResult({ ok: true, message: `Tarea reenviada a ${to}.` });
      setForwardTo("");
      setForwardNote("");
    } catch (err) {
      setForwardResult({
        ok: false,
        message: err instanceof Error ? err.message : "No se pudo enviar el email.",
      });
    } finally {
      setForwardingEmail(false);
    }
  }

  async function handleScheduleMeeting() {
    if (!taskId || !meetDate || !meetTime || scheduling) return;
    setScheduling(true);
    setMeetError(null);
    try {
      const startTime = new Date(`${meetDate}T${meetTime}`).toISOString();
      const res = await fetch(`/api/tasks/${taskId}/schedule-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime, durationMinutes: meetDuration }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo agendar la reunión.");
      }
      setMeetLink(json.meetLink);
      setMeetScheduledAt(json.scheduledAt);
      setMeetFormOpen(false);
    } catch (err) {
      setMeetError(err instanceof Error ? err.message : "No se pudo agendar la reunión.");
    } finally {
      setScheduling(false);
    }
  }

  async function handleAddChecklist(e: React.FormEvent) {
    e.preventDefault();
    if (!taskId || !newChecklistTitle.trim() || addingChecklist) return;
    setAddingChecklist(true);
    try {
      const created = await createChecklist(supabase, taskId, newChecklistTitle.trim(), checklists.length);
      setChecklists((prev) => [...prev, created]);
      setNewChecklistTitle("");
      setChecklistError(null);
    } catch (err) {
      console.error("No se pudo crear el checklist:", err);
      setChecklistError("No se pudo crear el checklist.");
    } finally {
      setAddingChecklist(false);
    }
  }

  async function handleDeleteChecklist(checklistId: string) {
    try {
      await deleteChecklist(supabase, checklistId);
      setChecklists((prev) => prev.filter((c) => c.id !== checklistId));
    } catch (err) {
      console.error("No se pudo eliminar el checklist:", err);
      setChecklistError("No se pudo eliminar el checklist.");
    }
  }

  async function handleAddItem(checklistId: string) {
    const label = (newItemLabel[checklistId] ?? "").trim();
    if (!label || addingItemIds.has(checklistId)) return;
    const checklist = checklists.find((c) => c.id === checklistId);
    if (!checklist) return;
    setAddingItemIds((prev) => new Set(prev).add(checklistId));
    try {
      const created = await addChecklistItem(supabase, checklistId, label, checklist.items.length);
      setChecklists((prev) =>
        prev.map((c) => (c.id === checklistId ? { ...c, items: [...c.items, created] } : c))
      );
      setNewItemLabel((prev) => ({ ...prev, [checklistId]: "" }));
    } catch (err) {
      console.error("No se pudo agregar el ítem:", err);
      setChecklistError("No se pudo agregar el ítem.");
    } finally {
      setAddingItemIds((prev) => {
        const next = new Set(prev);
        next.delete(checklistId);
        return next;
      });
    }
  }

  async function handleToggleItem(checklistId: string, itemId: string, isDone: boolean) {
    setChecklists((prev) =>
      prev.map((c) =>
        c.id === checklistId
          ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, isDone } : i)) }
          : c
      )
    );
    try {
      await toggleChecklistItem(supabase, itemId, isDone);
    } catch (err) {
      console.error("No se pudo actualizar el ítem:", err);
      setChecklistError("No se pudo actualizar el ítem.");
      setChecklists((prev) =>
        prev.map((c) =>
          c.id === checklistId
            ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, isDone: !isDone } : i)) }
            : c
        )
      );
    }
  }

  async function handleDeleteItem(checklistId: string, itemId: string) {
    try {
      await deleteChecklistItem(supabase, itemId);
      setChecklists((prev) =>
        prev.map((c) => (c.id === checklistId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c))
      );
    } catch (err) {
      console.error("No se pudo eliminar el ítem:", err);
      setChecklistError("No se pudo eliminar el ítem.");
    }
  }

  async function handleToggleTag(tag: Tag) {
    if (!taskId || pendingTagIds.has(tag.id)) return;
    const isAttached = taskTags.some((t) => t.id === tag.id);
    setPendingTagIds((prev) => new Set(prev).add(tag.id));
    try {
      if (isAttached) {
        await removeTagFromTask(supabase, taskId, tag.id);
        setTaskTags((prev) => prev.filter((t) => t.id !== tag.id));
      } else {
        await addTagToTask(supabase, taskId, tag.id);
        setTaskTags((prev) => [...prev, tag]);
      }
      setTagsError(null);
    } catch (err) {
      console.error("No se pudo actualizar la etiqueta:", err);
      setTagsError("No se pudo actualizar la etiqueta.");
    } finally {
      setPendingTagIds((prev) => {
        const next = new Set(prev);
        next.delete(tag.id);
        return next;
      });
    }
  }

  async function handleCreateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!taskId || !tenantId || !newTagName.trim() || creatingTag) return;
    setCreatingTag(true);
    try {
      const created = await createTag(supabase, tenantId, newTagName.trim(), newTagColor);
      setOrgTags((prev) => [...prev, created]);
      await addTagToTask(supabase, taskId, created.id);
      setTaskTags((prev) => [...prev, created]);
      setNewTagName("");
      setTagsError(null);
    } catch (err) {
      console.error("No se pudo crear la etiqueta:", err);
      setTagsError("No se pudo crear la etiqueta.");
    } finally {
      setCreatingTag(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const assigneeUserId = members.find((m) => memberLabel(m) === effectiveAssignee)?.userId ?? null;
    onSave(
      {
        title: title.trim(),
        priority,
        assignee: effectiveAssignee,
        assigneeUserId,
        tag: tag.trim() || undefined,
        dueDate: dueDate || undefined,
        commentCount: initial?.commentCount,
        attachmentCount: initial?.attachmentCount,
      },
      selectedColumnId,
      initial?.id
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        style={{ width: "100%", maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-modal-title"
      >
        <div className="modal-head">
          <h2 id="task-modal-title">{mode === "create" ? "Nueva tarea" : "Editar tarea"}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="title">Título</label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ej. Login SSO con Google Workspace"
              autoFocus
              required
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="status">Estado</label>
              <select
                id="status"
                value={selectedColumnId}
                onChange={(e) => setSelectedColumnId(e.target.value)}
              >
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="priority">Prioridad</label>
              <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="urgent">Urgente</option>
                <option value="high">Alta</option>
                <option value="medium">Media</option>
                <option value="low">Baja</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="assignee">Asignado</label>
              <select id="assignee" value={effectiveAssignee} onChange={(e) => setAssignee(e.target.value)}>
                {effectiveAssignee && !members.some((m) => memberLabel(m) === effectiveAssignee) ? (
                  <option value={effectiveAssignee}>{`${effectiveAssignee} (no es miembro actual)`}</option>
                ) : null}
                {members.map((m) => {
                  const label = memberLabel(m);
                  return (
                    <option key={m.membershipId} value={label}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="tag">Etiqueta</label>
              <input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="backend" />
            </div>
            <div className="field">
              <label htmlFor="due">Vence</label>
              <div style={{ display: "flex", alignItems: "center" }}>
                <input
                  id="due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                {(() => {
                  const badge = dueBadge(dueDate || undefined);
                  return badge ? <span className={`due-badge ${badge.variant}`}>{badge.label}</span> : null;
                })()}
              </div>
            </div>
          </div>

          {taskId ? (
            <>
              <div className="field task-section">
                <label>Etiquetas</label>
                {tagsError ? <p role="alert" className="field-error">{tagsError}</p> : null}
                {tagsLoading ? (
                  <p>Cargando etiquetas…</p>
                ) : (
                  <div className="tag-pill-row">
                    {taskTags.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        className="tag-pill"
                        style={{ background: `var(${t.color ?? "--muted"}-soft)`, color: `var(${t.color ?? "--muted"})` }}
                        onClick={() => handleToggleTag(t)}
                        title="Quitar etiqueta"
                      >
                        {t.name} ✕
                      </button>
                    ))}
                    <button type="button" className="tag-pill-add" onClick={() => setShowTagPicker((v) => !v)}>
                      + Etiqueta
                    </button>
                  </div>
                )}
                {showTagPicker ? (
                  <div className="tag-picker">
                    {orgTags
                      .filter((t) => !taskTags.some((tt) => tt.id === t.id))
                      .map((t) => (
                        <button
                          type="button"
                          key={t.id}
                          className="tag-pill"
                          style={{ background: `var(${t.color ?? "--muted"}-soft)`, color: `var(${t.color ?? "--muted"})` }}
                          onClick={() => handleToggleTag(t)}
                        >
                          {t.name}
                        </button>
                      ))}
                    <div className="tag-create-row">
                      <input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="Nueva etiqueta"
                      />
                      <div className="tag-color-swatches" aria-label="Color de la etiqueta">
                        {TAG_COLOR_OPTIONS.map((c) => (
                          <button
                            type="button"
                            key={c}
                            aria-pressed={newTagColor === c}
                            aria-label={c.replace("--", "")}
                            className={`tag-color-swatch${newTagColor === c ? " selected" : ""}`}
                            style={{ background: `var(${c})` }}
                            onClick={() => setNewTagColor(c)}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={handleCreateTag}
                        disabled={!newTagName.trim() || creatingTag}
                      >
                        Crear
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="field task-section">
                <label>Checklist</label>
                {checklistError ? <p role="alert" className="field-error">{checklistError}</p> : null}
                {checklistsLoading ? (
                  <p>Cargando checklists…</p>
                ) : checklists.length === 0 ? (
                  <p>Sin checklists todavía.</p>
                ) : (
                  checklists.map((checklist) => {
                    const total = checklist.items.length;
                    const done = checklist.items.filter((i) => i.isDone).length;
                    const pct = total ? Math.round((done / total) * 100) : 0;
                    return (
                      <div key={checklist.id} className="checklist-block">
                        <div className="checklist-head">
                          <span className="checklist-title">{checklist.title}</span>
                          <button type="button" className="btn danger" onClick={() => handleDeleteChecklist(checklist.id)}>
                            Eliminar
                          </button>
                        </div>
                        <div className="checklist-progress-row">
                          <span className="checklist-pct">{pct}%</span>
                          <div className="checklist-progress-track">
                            <div className="checklist-progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
                          </div>
                        </div>
                        <ul className="checklist-item-list">
                          {checklist.items.map((item) => (
                            <li key={item.id} className="checklist-item">
                              <label className={item.isDone ? "checklist-item-done" : undefined}>
                                <input
                                  type="checkbox"
                                  checked={item.isDone}
                                  onChange={(e) => handleToggleItem(checklist.id, item.id, e.target.checked)}
                                />
                                {item.label}
                              </label>
                              <button
                                type="button"
                                className="icon-btn"
                                aria-label="Eliminar ítem"
                                onClick={() => handleDeleteItem(checklist.id, item.id)}
                              >
                                ✕
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="checklist-add-item-row">
                          <input
                            value={newItemLabel[checklist.id] ?? ""}
                            onChange={(e) =>
                              setNewItemLabel((prev) => ({ ...prev, [checklist.id]: e.target.value }))
                            }
                            placeholder="Añada un elemento"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddItem(checklist.id);
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="btn"
                            onClick={() => handleAddItem(checklist.id)}
                            disabled={addingItemIds.has(checklist.id)}
                          >
                            Añadir
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
                <div className="checklist-add-item-row">
                  <input
                    value={newChecklistTitle}
                    onChange={(e) => setNewChecklistTitle(e.target.value)}
                    placeholder="Nombre del checklist"
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={handleAddChecklist}
                    disabled={!newChecklistTitle.trim() || checklistsLoading || addingChecklist}
                  >
                    + Añadir checklist
                  </button>
                </div>
              </div>

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

              {taskId && googleConnected && (
                <div className="field task-section">
                  <label>Reenviar por email</label>
                  {!forwardEmailOpen ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setForwardEmailOpen(true);
                        setForwardResult(null);
                      }}
                    >
                      📧 Reenviar por email
                    </button>
                  ) : (
                    // Nota: no puede ser un <form> — TaskModal ya está envuelto
                    // en el <form> principal de guardar tarea (línea ~603), y
                    // un <form> anidado es HTML inválido: el navegador lo
                    // descarta y el botón "Enviar" terminaba disparando el
                    // submit del formulario externo (guardaba y cerraba el
                    // modal sin llamar a handleForwardEmail).
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div className="comment-input-wrap" style={{ marginTop: 0 }}>
                        <input
                          id="forward-email-to"
                          name="forwardEmailTo"
                          type="email"
                          value={forwardTo}
                          onChange={(e) => setForwardTo(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleForwardEmail();
                            }
                          }}
                          placeholder="Email del destinatario"
                          disabled={forwardingEmail}
                          required
                        />
                      </div>
                      <textarea
                        id="forward-email-note"
                        name="forwardEmailNote"
                        value={forwardNote}
                        onChange={(e) => setForwardNote(e.target.value)}
                        placeholder="Nota (opcional)"
                        disabled={forwardingEmail}
                        rows={2}
                        style={{ width: "100%" }}
                      />
                      <div>
                        <button
                          type="button"
                          className="btn primary"
                          onClick={handleForwardEmail}
                          disabled={!forwardTo.trim() || forwardingEmail}
                        >
                          {forwardingEmail ? "Enviando…" : "Enviar"}
                        </button>
                      </div>
                    </div>
                  )}
                  {forwardResult && (
                    <p
                      role={forwardResult.ok ? "status" : "alert"}
                      className={forwardResult.ok ? undefined : "field-error"}
                      style={forwardResult.ok ? { color: "var(--low)", fontSize: 13.5 } : undefined}
                    >
                      {forwardResult.message}
                    </p>
                  )}
                </div>
              )}

              {taskId && googleConnected && (
                <div className="field task-section">
                  <label>Agendar reunión</label>
                  {meetLink && !meetFormOpen && (
                    <p style={{ fontSize: 13.5, marginBottom: 10 }}>
                      Reunión agendada
                      {meetScheduledAt ? ` para ${formatDateTime(meetScheduledAt)}` : ""} —{" "}
                      <a href={meetLink} target="_blank" rel="noopener noreferrer">
                        Unirse en Google Meet
                      </a>
                    </p>
                  )}
                  {!meetFormOpen ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setMeetFormOpen(true);
                        setMeetError(null);
                      }}
                    >
                      📅 {meetLink ? "Reagendar reunión" : "Agendar reunión"}
                    </button>
                  ) : (
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div className="field-row">
                        <div className="field">
                          <label htmlFor="meet-date">Fecha</label>
                          <input
                            id="meet-date"
                            type="date"
                            value={meetDate}
                            onChange={(e) => setMeetDate(e.target.value)}
                            disabled={scheduling}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="meet-time">Hora</label>
                          <input
                            id="meet-time"
                            type="time"
                            value={meetTime}
                            onChange={(e) => setMeetTime(e.target.value)}
                            disabled={scheduling}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="meet-duration">Duración</label>
                          <select
                            id="meet-duration"
                            value={meetDuration}
                            onChange={(e) => setMeetDuration(Number(e.target.value))}
                            disabled={scheduling}
                          >
                            <option value={15}>15 min</option>
                            <option value={30}>30 min</option>
                            <option value={60}>1 hora</option>
                            <option value={120}>2 horas</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className="btn primary"
                          onClick={handleScheduleMeeting}
                          disabled={!meetDate || !meetTime || scheduling}
                        >
                          {scheduling ? "Agendando…" : "Agendar"}
                        </button>
                        <button type="button" className="btn" onClick={() => setMeetFormOpen(false)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  {meetError && (
                    <p role="alert" className="field-error">
                      {meetError}
                    </p>
                  )}
                </div>
              )}

              <div className="field task-section">
                <label>Actividad</label>
                {activityError ? <p role="alert" className="field-error">{activityError}</p> : null}
                {activityLoading ? (
                  <p>Cargando actividad…</p>
                ) : activity.length === 0 ? (
                  <p>Sin actividad registrada.</p>
                ) : (
                  <ul className="activity-list">
                    {activity.map((a) => (
                      <li key={a.id} className="activity-item">
                        <span className="activity-text">{describeActivity(a, resolveColumnName)}</span>
                        <span className="activity-meta">
                          {authorName(a.actorId)} · {formatDateTime(a.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="field task-section">
                <label>Comentarios</label>
                {commentsError ? <p role="alert" className="field-error">{commentsError}</p> : null}
                {commentsLoading ? (
                  <p>Cargando comentarios…</p>
                ) : comments.length === 0 ? (
                  <p>Sin comentarios todavía.</p>
                ) : (
                  <ul className="comment-list">
                    {comments
                      .filter((c) => !c.parentCommentId)
                      .map((c) => {
                        const replies = comments.filter((r) => r.parentCommentId === c.id);
                        return (
                          <li key={c.id} className="comment-item">
                            <div className="comment-meta">
                              <strong>{authorName(c.authorId)}</strong>
                              <span>{formatDateTime(c.createdAt)}</span>
                            </div>
                            <p className="comment-body">{c.body}</p>
                            <button
                              type="button"
                              className="comment-reply-btn"
                              onClick={() => setReplyingToId(c.id)}
                            >
                              Responder
                            </button>
                            {replies.length > 0 ? (
                              <ul className="comment-list comment-list-replies">
                                {replies.map((r) => (
                                  <li key={r.id} className="comment-item comment-item-reply">
                                    <div className="comment-meta">
                                      <strong>{authorName(r.authorId)}</strong>
                                      <span>{formatDateTime(r.createdAt)}</span>
                                    </div>
                                    <p className="comment-body">{r.body}</p>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        );
                      })}
                  </ul>
                )}
                {replyingToId ? (
                  <div className="comment-reply-indicator">
                    Respondiendo a {authorName(comments.find((c) => c.id === replyingToId)?.authorId ?? null)}…
                    <button type="button" className="icon-btn" onClick={() => setReplyingToId(null)} aria-label="Cancelar respuesta">
                      ✕
                    </button>
                  </div>
                ) : null}
                <div className="comment-input-wrap">
                  <textarea
                    ref={commentTextareaRef}
                    value={newComment}
                    onChange={handleCommentChange}
                    onKeyDown={handleCommentKeyDown}
                    placeholder="Escribe un comentario… usa @ para mencionar"
                    rows={6}
                    role="combobox"
                    aria-expanded={Boolean(mentionState && mentionMatches.length > 0)}
                    aria-controls={mentionState ? "mention-dropdown-list" : undefined}
                    aria-activedescendant={
                      mentionState && mentionMatches[activeMentionIndex]
                        ? `mention-option-${mentionMatches[activeMentionIndex].userId}`
                        : undefined
                    }
                  />
                  {mentionState && mentionMatches.length > 0 ? (
                    <ul id="mention-dropdown-list" className="mention-dropdown" role="listbox">
                      {mentionMatches.map((m, i) => (
                        <li key={m.userId}>
                          <button
                            type="button"
                            id={`mention-option-${m.userId}`}
                            role="option"
                            aria-selected={i === activeMentionIndex}
                            className={i === activeMentionIndex ? "active" : undefined}
                            onMouseEnter={() => setActiveMentionIndex(i)}
                            onClick={() => selectMention(m)}
                          >
                            {m.fullName}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={handleAddComment}
                  disabled={!newComment.trim()}
                >
                  Enviar
                </button>
              </div>
            </>
          ) : null}
        </div>
        <div className="modal-foot">
          {mode === "edit" && initial && onDelete && can("task.delete") ? (
            <button
              type="button"
              className="btn danger"
              onClick={() => onDelete(initial.id)}
            >
              Eliminar
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn primary">
              {mode === "create" ? "Crear tarea" : "Guardar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
