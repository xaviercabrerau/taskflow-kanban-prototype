"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBoard } from "@/context/BoardContext";
import type { Task } from "@/lib/types";
import { searchWorkspace, type SearchResult } from "@/lib/supabase/search-repo";

interface CommandPaletteProps {
  onOpenTask: (task: Task) => void;
  onCreateTask: () => void;
}

interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  onSelect: () => void;
}

const NAV_ROUTES: { label: string; href: string }[] = [
  { label: "Ir a: Tablero (Kanban)", href: "/" },
  { label: "Ir a: Tabla", href: "/tabla" },
  { label: "Ir a: Gantt", href: "/gantt" },
  { label: "Ir a: Calendario", href: "/calendario" },
  { label: "Ir a: Dashboard", href: "/dashboard" },
  { label: "Ir a: Admin — Usuarios", href: "/admin/usuarios" },
  { label: "Ir a: Admin — Roles y permisos", href: "/admin/roles" },
  { label: "Ir a: Admin — Épicas y Sprints", href: "/admin/planificacion" },
  { label: "Ir a: Admin — Automatizaciones", href: "/admin/automatizaciones" },
  { label: "Ir a: Admin — Campos personalizados", href: "/admin/campos-personalizados" },
  { label: "Ir a: Admin — Integraciones", href: "/admin/integraciones" },
  { label: "Ir a: Admin — Seguridad y acceso", href: "/admin/seguridad" },
  { label: "Ir a: Admin — API Keys (MCP)", href: "/admin/api-keys" },
  { label: "Ir a: Admin — Auditoría", href: "/admin/auditoria" },
  { label: "Ir a: Admin — Plantillas", href: "/admin/plantillas" },
  { label: "Ir a: Admin — Reportes", href: "/admin/reportes" },
  { label: "Ir a: Admin — Workspaces", href: "/admin/workspaces" },
];

export default function CommandPalette({ onOpenTask, onCreateTask }: CommandPaletteProps) {
  const { supabase, state, activeBoardId } = useBoard();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Búsqueda remota (comentarios/adjuntos) con debounce — los títulos de
  // tarea y los comandos de navegación se filtran localmente sin esperar
  // a esta llamada, así la lista nunca se siente vacía mientras carga.
  useEffect(() => {
    if (!open || !activeBoardId || query.trim().length < 2) {
      setRemoteResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      searchWorkspace(supabase, activeBoardId, query.trim())
        .then((results) => {
          if (!cancelled) setRemoteResults(results);
        })
        .catch((err) => console.error("Error en búsqueda global:", err));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [supabase, activeBoardId, query, open]);

  const items: PaletteItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: PaletteItem[] = [];

    if (!q) {
      result.push({ id: "create", label: "➕ Nueva tarea", onSelect: () => { onCreateTask(); setOpen(false); } });
    }

    for (const route of NAV_ROUTES) {
      if (!q || route.label.toLowerCase().includes(q)) {
        result.push({
          id: `nav:${route.href}`,
          label: route.label,
          onSelect: () => {
            router.push(route.href);
            setOpen(false);
          },
        });
      }
    }

    if (q) {
      const localMatches = Object.values(state.tasks).filter((t) => t.title.toLowerCase().includes(q));
      for (const t of localMatches.slice(0, 10)) {
        result.push({
          id: `task:${t.id}`,
          label: t.title,
          sublabel: "Tarea",
          onSelect: () => {
            onOpenTask(t);
            setOpen(false);
          },
        });
      }

      const seenTaskIds = new Set(localMatches.map((t) => t.id));
      for (const r of remoteResults) {
        if (r.matchType === "task" && seenTaskIds.has(r.taskId)) continue; // ya listado arriba
        const task = state.tasks[r.taskId];
        if (!task) continue;
        result.push({
          id: `search:${r.matchType}:${r.taskId}:${r.snippet}`,
          label: r.taskTitle,
          sublabel:
            r.matchType === "comment" ? `Comentario: "${r.snippet}"` : r.matchType === "attachment" ? `Adjunto: ${r.snippet}` : undefined,
          onSelect: () => {
            onOpenTask(task);
            setOpen(false);
          },
        });
      }
    }

    return result.slice(0, 25);
  }, [query, remoteResults, state.tasks, router, onCreateTask, onOpenTask]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)} style={{ alignItems: "flex-start", paddingTop: "12vh" }}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Paleta de comandos">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[activeIndex]?.onSelect();
              }
            }}
            placeholder="Buscar tareas, comentarios, adjuntos, o navegar…"
            aria-label="Buscar"
            style={{ width: "100%", border: "none", background: "transparent", fontSize: 15, outline: "none", padding: "6px 0" }}
          />
        </div>
        <div className="modal-body" style={{ maxHeight: "50vh", padding: 8 }}>
          {items.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13.5, padding: "8px 8px" }}>Sin resultados.</p>
          ) : (
            items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={item.onSelect}
                onMouseEnter={() => setActiveIndex(i)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 6,
                  background: i === activeIndex ? "var(--surface-2)" : "transparent",
                  color: "var(--fg)",
                  cursor: "pointer",
                  fontSize: 13.5,
                }}
              >
                {item.label}
                {item.sublabel && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{item.sublabel}</div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
