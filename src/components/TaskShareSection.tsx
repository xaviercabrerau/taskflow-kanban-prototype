"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import type { ShareLink, SharePermission } from "@/lib/supabase/share-links-repo";

interface TaskShareSectionProps {
  taskId: string;
}

export default function TaskShareSection({ taskId }: TaskShareSectionProps) {
  const { activeBoardId } = useBoard();
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [shareFormOpen, setShareFormOpen] = useState(false);
  const [sharePermission, setSharePermission] = useState<SharePermission>("view");
  const [creatingShare, setCreatingShare] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [newShareUrl, setNewShareUrl] = useState<string | null>(null);
  const [newShareLinkId, setNewShareLinkId] = useState<string | null>(null);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);

  // Ver TaskGithubSection.tsx para la razón del delay de 200ms — mismo
  // patrón que tenía embebido en TaskModal.tsx antes de extraerse a su
  // propio componente (Tarea 9 del plan de 2026-09-04).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      fetch(`/api/share-links?boardId=${encodeURIComponent(activeBoardId ?? "")}`)
        .then((res) => res.json())
        .then((json) => {
          if (!cancelled && Array.isArray(json.links)) {
            setShareLinks((json.links as ShareLink[]).filter((l) => l.taskId === taskId));
          }
        })
        .catch((err) => {
          console.error("No se pudieron cargar los links compartidos:", err);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [taskId, activeBoardId]);

  async function handleCreateShareLink() {
    if (!activeBoardId || creatingShare) return;
    setCreatingShare(true);
    setShareError(null);
    try {
      const res = await fetch("/api/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: activeBoardId, taskId, scope: "task", permission: sharePermission }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo crear el link.");
      }
      const url = `${window.location.origin}/share/${json.token}`;
      setShareLinks((prev) => [json.link as ShareLink, ...prev]);
      setNewShareUrl(url);
      setNewShareLinkId((json.link as ShareLink).id);
      setShareFormOpen(false);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "No se pudo crear el link.");
    } finally {
      setCreatingShare(false);
    }
  }

  async function handleRevokeShareLink(linkId: string) {
    try {
      await fetch(`/api/share-links/${linkId}`, { method: "DELETE" });
      setShareLinks((prev) => prev.filter((l) => l.id !== linkId));
      if (newShareLinkId === linkId) {
        setNewShareUrl(null);
        setNewShareLinkId(null);
      }
    } catch (err) {
      console.error("No se pudo revocar el link:", err);
    }
  }

  return (
    <div className="field task-section">
      <label>Compartir</label>
      {shareLinks.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {shareLinks.map((link) => (
            <li key={link.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span>
                {link.permission === "comment" ? "Invitado (puede comentar)" : "Solo lectura"}
                {link.label ? ` — ${link.label}` : ""}
              </span>
              {link.id === newShareLinkId && newShareUrl && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    navigator.clipboard.writeText(newShareUrl);
                    setCopiedShareId(link.id);
                    setTimeout(() => setCopiedShareId(null), 2000);
                  }}
                >
                  {copiedShareId === link.id ? "Copiado ✓" : "Copiar link"}
                </button>
              )}
              <button type="button" className="btn" onClick={() => handleRevokeShareLink(link.id)}>
                Revocar
              </button>
            </li>
          ))}
        </ul>
      )}
      {!shareFormOpen ? (
        <button type="button" className="btn" onClick={() => setShareFormOpen(true)}>
          🔗 Crear link compartible
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field">
            <label htmlFor="share-permission">Permiso</label>
            <select
              id="share-permission"
              value={sharePermission}
              onChange={(e) => setSharePermission(e.target.value as SharePermission)}
              disabled={creatingShare}
            >
              <option value="view">Solo lectura</option>
              <option value="comment">Invitado — puede comentar</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn primary" onClick={handleCreateShareLink} disabled={creatingShare}>
              {creatingShare ? "Creando…" : "Crear"}
            </button>
            <button type="button" className="btn" onClick={() => setShareFormOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {shareError && (
        <p role="alert" className="field-error">
          {shareError}
        </p>
      )}
    </div>
  );
}
