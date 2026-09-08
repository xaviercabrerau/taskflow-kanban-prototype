"use client";

import { useEffect, useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { fetchComments, addComment, type TaskComment } from "@/lib/supabase/comments-repo";
import type { OrgMember } from "@/lib/supabase/members-repo";

interface TaskCommentsSectionProps {
  taskId: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function TaskCommentsSection({ taskId }: TaskCommentsSectionProps) {
  const { supabase, userId, members } = useBoard();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [commentSummary, setCommentSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [mentionState, setMentionState] = useState<{ prefix: string; start: number } | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Comentarios es una sección "core" del modal — se carga de inmediato al
  // montar, igual que antes cuando vivía en el efecto combinado de
  // TaskModal.tsx (Tarea 9 del plan de 2026-09-04).
  useEffect(() => {
    let cancelled = false;
    fetchComments(supabase, taskId)
      .then((data) => {
        // Merge en vez de reemplazar — misma razón que TaskChecklistSection.tsx.
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
    return () => {
      cancelled = true;
    };
  }, [supabase, taskId]);

  function authorName(authorId: string | null): string {
    if (!authorId) return "Automatización";
    const member = members.find((m) => m.userId === authorId);
    return member?.fullName || member?.email || "Usuario";
  }

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
    if (!newComment.trim()) return;
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

  async function handleSummarizeComments() {
    if (summarizing) return;
    setSummarizing(true);
    setSummaryError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/summarize-comments`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo generar el resumen.");
      }
      setCommentSummary(json.summary);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "No se pudo generar el resumen.");
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <div className="field task-section">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label style={{ margin: 0 }}>Comentarios</label>
        {comments.length > 0 && (
          <button type="button" className="btn" onClick={handleSummarizeComments} disabled={summarizing}>
            {summarizing ? "Resumiendo…" : "✨ Resumir con IA"}
          </button>
        )}
      </div>
      {summaryError && (
        <p role="alert" className="field-error">
          {summaryError}
        </p>
      )}
      {commentSummary && (
        <p style={{ fontSize: 13, background: "var(--accent-soft)", borderRadius: 8, padding: "8px 10px", margin: "8px 0" }}>
          {commentSummary}
        </p>
      )}
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
          maxLength={4000}
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
  );
}
