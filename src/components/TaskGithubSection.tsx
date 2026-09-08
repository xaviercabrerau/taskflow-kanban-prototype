"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { fetchTaskGithubLinks, deleteTaskGithubLink, type TaskGithubLink } from "@/lib/supabase/github-links-repo";

interface TaskGithubSectionProps {
  taskId: string;
}

export default function TaskGithubSection({ taskId }: TaskGithubSectionProps) {
  const { supabase } = useBoard();
  const [githubLinks, setGithubLinks] = useState<TaskGithubLink[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [linkingGithub, setLinkingGithub] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  // GitHub es una sección minoritaria del modal — la mayoría de usuarios
  // nunca la abre en una sesión dada. Se carga con un pequeño delay para no
  // competir con los fetches "core" del modal (comments/attachments/
  // checklists/tags/activity/links) por ancho de banda justo cuando el
  // modal recién se vuelve interactivo (AUDITORIA_2026-09-03.md, hallazgo
  // 10) — mismo patrón que tenía embebido en TaskModal.tsx antes de
  // extraerse a su propio componente (Tarea 9 del plan de 2026-09-04).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      fetchTaskGithubLinks(supabase, taskId)
        .then((links) => {
          if (!cancelled) setGithubLinks(links);
        })
        .catch((err) => {
          console.error("No se pudieron cargar los links de GitHub:", err);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supabase, taskId]);

  async function handleLinkGithub() {
    if (!githubUrl.trim() || linkingGithub) return;
    setLinkingGithub(true);
    setGithubError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/github-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: githubUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo vincular el issue/PR.");
      }
      const link = json.link;
      setGithubLinks((prev) => [
        {
          id: link.id,
          taskId: link.task_id,
          url: link.url,
          repo: link.repo,
          number: link.number,
          kind: link.kind,
          title: link.title,
          state: link.state,
          createdAt: link.created_at,
        },
        ...prev,
      ]);
      setGithubUrl("");
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "No se pudo vincular el issue/PR.");
    } finally {
      setLinkingGithub(false);
    }
  }

  async function handleRemoveGithubLink(id: string) {
    try {
      await deleteTaskGithubLink(supabase, id);
      setGithubLinks((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      console.error("No se pudo quitar el link de GitHub:", err);
    }
  }

  return (
    <div className="field task-section">
      <label>GitHub</label>
      {githubLinks.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {githubLinks.map((l) => (
            <li key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span>
                {l.kind === "pull_request" ? "🔀" : "◯"} {l.repo}#{l.number} — {l.title}{" "}
                <span style={{ color: "var(--muted)" }}>({l.state})</span>
              </span>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="btn">
                Ver
              </a>
              <button type="button" className="btn" onClick={() => handleRemoveGithubLink(l.id)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          placeholder="https://github.com/owner/repo/issues/123"
          disabled={linkingGithub}
        />
        <button type="button" className="btn" onClick={handleLinkGithub} disabled={linkingGithub || !githubUrl.trim()}>
          {linkingGithub ? "Vinculando…" : "Vincular"}
        </button>
      </div>
      {githubError && (
        <p role="alert" className="field-error">
          {githubError}
        </p>
      )}
    </div>
  );
}
