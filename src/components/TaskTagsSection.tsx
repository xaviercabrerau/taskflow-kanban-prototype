"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import {
  fetchOrgTags,
  fetchTaskTags,
  createTag,
  addTagToTask,
  removeTagFromTask,
  type Tag,
} from "@/lib/supabase/tags-repo";

const TAG_COLOR_OPTIONS = ["--low", "--medium", "--accent", "--muted", "--high"];

interface TaskTagsSectionProps {
  taskId: string;
}

export default function TaskTagsSection({ taskId }: TaskTagsSectionProps) {
  const { supabase, tenantId } = useBoard();
  const [orgTags, setOrgTags] = useState<Tag[]>([]);
  const [taskTags, setTaskTags] = useState<Tag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLOR_OPTIONS[0]);
  const [creatingTag, setCreatingTag] = useState(false);
  const [pendingTagIds, setPendingTagIds] = useState<Set<string>>(new Set());

  // Etiquetas es una sección "core" del modal — se carga de inmediato al
  // montar, igual que antes cuando vivía en el efecto combinado de
  // TaskModal.tsx (Tarea 9 del plan de 2026-09-04).
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchOrgTags(supabase, tenantId ?? ""), fetchTaskTags(supabase, taskId)])
      .then(([allTags, currentTags]) => {
        // orgTags es un reemplazo de catálogo simple (sin carrera de
        // "agregado local" — las etiquetas se crean vía un flujo aparte,
        // a nivel de org, no desde este modal). taskTags usa la misma
        // razón de merge que TaskChecklistSection.tsx.
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
    return () => {
      cancelled = true;
    };
  }, [supabase, taskId, tenantId]);

  async function handleToggleTag(tag: Tag) {
    if (pendingTagIds.has(tag.id)) return;
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
    if (!tenantId || !newTagName.trim() || creatingTag) return;
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

  return (
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
  );
}
