"use client";

import { useEffect, useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import {
  fetchFieldDefinitions,
  createFieldDefinition,
  deleteFieldDefinition,
  type CustomFieldDefinition,
  type CustomFieldType,
} from "@/lib/supabase/custom-fields-repo";

interface CustomFieldsModalProps {
  onClose: () => void;
  embedded?: boolean;
}

const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "Texto",
  number: "Número",
  select: "Lista de opciones",
  checkbox: "Sí/No",
};

// Matches the "key" column's expected shape: a stable identifier used both
// as the custom_field_definitions.key and as the JSON key inside
// tasks.custom_fields — lowercase snake_case, no spaces, so it survives as
// a plain object property name without escaping.
function slugifyKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function CustomFieldsModal({ onClose, embedded = false }: CustomFieldsModalProps) {
  const { supabase, activeBoardId: boardId, isOwner } = useBoard();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    fetchFieldDefinitions(supabase, boardId)
      .then((data) => {
        if (!cancelled) setFields(data);
      })
      .catch((err) => {
        console.error("No se pudieron cargar los campos personalizados:", err);
        if (!cancelled) setError("No se pudieron cargar los campos personalizados.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, boardId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!boardId || !label.trim() || saving) return;
    const key = slugifyKey(label);
    if (!key) return;
    if (fields.some((f) => f.key === key)) {
      setError(`Ya existe un campo con la clave "${key}" — usa un nombre distinto.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const options =
        fieldType === "select"
          ? optionsText
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : null;
      const created = await createFieldDefinition(supabase, boardId, {
        key,
        label: label.trim(),
        fieldType,
        options,
        isRequired,
        orderIndex: fields.length,
      });
      setFields((prev) => [...prev, created]);
      setLabel("");
      setOptionsText("");
      setIsRequired(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el campo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFieldDefinition(supabase, id);
      setFields((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el campo.");
    }
  }

  const panel = (
    <div
      className={embedded ? "admin-panel" : "modal"}
      style={embedded ? undefined : { width: 480 }}
      onClick={embedded ? undefined : (e) => e.stopPropagation()}
      ref={modalRef}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-labelledby="custom-fields-modal-title"
    >
      <div className="modal-head">
        <h2 id="custom-fields-modal-title">Campos personalizados</h2>
        {!embedded && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        )}
      </div>
      <div className="modal-body">
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="field" style={{ marginBottom: 16 }}>
          {loading ? (
            <p>Cargando…</p>
          ) : fields.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Todavía no hay campos personalizados en este tablero.</p>
          ) : (
            fields.map((f) => (
              <div
                key={f.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{f.label}</span>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                    {FIELD_TYPE_LABEL[f.fieldType]}
                    {f.isRequired ? " · Obligatorio" : ""}
                    {f.fieldType === "select" && f.options ? ` · ${f.options.join(", ")}` : ""}
                  </div>
                </div>
                {isOwner && (
                  <button type="button" className="icon-btn" title="Eliminar" onClick={() => handleDelete(f.id)}>
                    🗑️
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {isOwner && (
          <form onSubmit={handleCreate}>
            <div className="field">
              <label htmlFor="custom-field-label">Nombre del campo</label>
              <input
                id="custom-field-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ej. Presupuesto del cliente"
                required
              />
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="custom-field-type">Tipo</label>
              <select id="custom-field-type" value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}>
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="select">Lista de opciones</option>
                <option value="checkbox">Sí/No</option>
              </select>
            </div>
            {fieldType === "select" && (
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="custom-field-options">Opciones (separadas por coma)</label>
                <input
                  id="custom-field-options"
                  type="text"
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder="Baja, Media, Alta"
                />
              </div>
            )}
            <div className="field" style={{ marginTop: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none" }}>
                <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} style={{ width: "auto" }} />
                Obligatorio
              </label>
            </div>
            <button type="submit" className="btn primary" style={{ marginTop: 12 }} disabled={!label.trim() || saving}>
              {saving ? "Creando…" : "Crear campo"}
            </button>
          </form>
        )}
      </div>
    </div>
  );

  if (embedded) return panel;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      {panel}
    </div>
  );
}
