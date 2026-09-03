"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { priorityLabel, formatDue, type Priority } from "@/lib/types";

interface SharedComment {
  id: string;
  body: string;
  source: string;
  guestName: string | null;
  createdAt: string;
}

interface SharedTaskView {
  scope: "task";
  permission: "view" | "comment";
  boardName: string;
  task: {
    id: string;
    title: string;
    description: string | null;
    priority: Priority;
    dueDate: string | null;
    columnLabel: string;
    createdAt: string;
  };
  comments: SharedComment[];
}

interface SharedBoardView {
  scope: "board";
  permission: "view" | "comment";
  boardName: string;
  columns: { id: string; label: string; orderIndex: number }[];
  tasks: { id: string; title: string; priority: Priority; dueDate: string | null; columnId: string }[];
}

type SharedView = SharedTaskView | SharedBoardView;

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [view, setView] = useState<SharedView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/share/${encodeURIComponent(token)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || "No se pudo cargar el link.");
          setView(null);
        } else {
          setView(json.data as SharedView);
        }
      } catch {
        if (!cancelled) setError("No se pudo cargar el link.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", justifyContent: "center", padding: "40px 16px" }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>TaskFlow</span>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>· vista compartida</span>
        </div>

        {loading && <p style={{ color: "var(--muted)" }}>Cargando…</p>}
        {error && !loading && (
          <div className="modal" style={{ padding: 24 }}>
            <p style={{ color: "var(--high)" }}>{error}</p>
          </div>
        )}
        {view && !loading && view.scope === "task" && <TaskShareView view={view} token={token} />}
        {view && !loading && view.scope === "board" && <BoardShareView view={view} />}
      </div>
    </div>
  );
}

function TaskShareView({ view, token }: { view: SharedTaskView; token: string }) {
  const [comments, setComments] = useState(view.comments);
  const [guestName, setGuestName] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/public/share/${encodeURIComponent(token)}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, guestName }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSendError(json.error || "No se pudo enviar el comentario.");
        return;
      }
      setComments((prev) => [
        ...prev,
        { id: json.data.id, body, source: "guest", guestName: guestName.trim() || "Invitado", createdAt: json.data.createdAt },
      ]);
      setBody("");
    } catch {
      setSendError("No se pudo enviar el comentario.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal" style={{ padding: 24 }}>
      <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 0, marginBottom: 4 }}>{view.boardName} · {view.task.columnLabel}</p>
      <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>{view.task.title}</h1>
      <div style={{ display: "flex", gap: 12, fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        <span>Prioridad: {priorityLabel(view.task.priority)}</span>
        {view.task.dueDate && <span>Vence: {formatDue(view.task.dueDate)}</span>}
      </div>
      {view.task.description && (
        <p style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}>{view.task.description}</p>
      )}

      <hr style={{ margin: "20px 0", border: "none", borderTop: "1px solid var(--border)" }} />

      <h2 style={{ fontSize: 14, marginBottom: 12 }}>Comentarios</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {comments.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aún no hay comentarios.</p>}
        {comments.map((c) => (
          <div key={c.id} style={{ fontSize: 13.5 }}>
            <strong>{c.source === "guest" ? c.guestName || "Invitado" : "Equipo"}</strong>{" "}
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {new Date(c.createdAt).toLocaleString("es-EC")}
            </span>
            <p style={{ margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{c.body}</p>
          </div>
        ))}
      </div>

      {view.permission === "comment" && (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="field">
            <label htmlFor="guest-name">Tu nombre (opcional)</label>
            <input id="guest-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="guest-comment">Comentario</label>
            <textarea
              id="guest-comment"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={4000}
              required
            />
          </div>
          {sendError && <p style={{ color: "var(--high)", fontSize: 13 }}>{sendError}</p>}
          <button type="submit" className="btn primary" disabled={sending || !body.trim()} style={{ alignSelf: "flex-end" }}>
            {sending ? "Enviando…" : "Comentar"}
          </button>
        </form>
      )}
    </div>
  );
}

function BoardShareView({ view }: { view: SharedBoardView }) {
  const sortedColumns = [...view.columns].sort((a, b) => a.orderIndex - b.orderIndex);
  return (
    <div className="modal" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px" }}>{view.boardName}</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {sortedColumns.map((col) => {
          const colTasks = view.tasks.filter((t) => t.columnId === col.id);
          return (
            <div key={col.id}>
              <h2 style={{ fontSize: 13.5, marginBottom: 8, color: "var(--muted)" }}>
                {col.label} ({colTasks.length})
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {colTasks.map((t) => (
                  <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13.5 }}>
                    <div>{t.title}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      {priorityLabel(t.priority)}
                      {t.dueDate ? ` · ${formatDue(t.dueDate)}` : ""}
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12.5 }}>Sin tareas.</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
