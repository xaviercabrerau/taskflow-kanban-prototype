"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import {
  fetchChecklists,
  createChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  type Checklist,
} from "@/lib/supabase/checklist-repo";

interface TaskChecklistSectionProps {
  taskId: string;
}

export default function TaskChecklistSection({ taskId }: TaskChecklistSectionProps) {
  const { supabase } = useBoard();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [checklistsLoading, setChecklistsLoading] = useState(true);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [newItemLabel, setNewItemLabel] = useState<Record<string, string>>({});
  const [addingChecklist, setAddingChecklist] = useState(false);
  const [addingItemIds, setAddingItemIds] = useState<Set<string>>(new Set());

  // Checklist es una sección "core" del modal (a diferencia de GitHub/
  // Tiempo/Reunión/Compartir, que difieren su carga) — se carga de
  // inmediato al montar, igual que antes cuando vivía en el efecto
  // combinado de TaskModal.tsx (Tarea 9 del plan de 2026-09-04).
  useEffect(() => {
    let cancelled = false;
    fetchChecklists(supabase, taskId)
      .then((data) => {
        // Merge en vez de reemplazar: si el usuario agregó un checklist
        // mientras esta carga inicial seguía en curso, la entrada
        // optimista (ya persistida en el servidor) podría no estar en
        // `data` todavía y desaparecería de la UI hasta reabrir el modal.
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
    return () => {
      cancelled = true;
    };
  }, [supabase, taskId]);

  async function handleAddChecklist(e: React.FormEvent) {
    e.preventDefault();
    if (!newChecklistTitle.trim() || addingChecklist) return;
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

  return (
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
  );
}
