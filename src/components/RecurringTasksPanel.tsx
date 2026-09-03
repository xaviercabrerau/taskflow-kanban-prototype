"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { priorityLabel, type Priority } from "@/lib/types";
import {
  fetchRecurringTaskTemplates,
  createRecurringTaskTemplate,
  toggleRecurringTaskTemplate,
  deleteRecurringTaskTemplate,
  type RecurringTaskTemplate,
  type RecurrenceFrequency,
} from "@/lib/supabase/recurring-tasks-repo";
import AdminPanelShell from "./AdminPanelShell";
import { useEmbeddedPanelData } from "@/hooks/useEmbeddedPanelData";

interface RecurringTasksPanelProps {
  onClose: () => void;
  embedded?: boolean;
}

const FREQUENCY_LABEL: Record<RecurrenceFrequency, string> = {
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
};

const WEEKDAY_LABEL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Ajusta la fecha/hora elegida al día de la semana o del mes seleccionado,
// preservando la hora — mismo cálculo que el anclaje del lado servidor en
// execute_recurring_tasks() (20260903230000_recurring_tasks_day_anchor.sql),
// así el primer disparo ya cae en el día correcto, no solo las repeticiones
// siguientes.
function anchorStartDate(date: Date, frequency: RecurrenceFrequency, dayOfWeek: number | null, dayOfMonth: number | null): Date {
  const anchored = new Date(date);
  if (frequency === "weekly" && dayOfWeek !== null) {
    const diff = (dayOfWeek - anchored.getDay() + 7) % 7;
    anchored.setDate(anchored.getDate() + diff);
  } else if (frequency === "monthly" && dayOfMonth !== null) {
    anchored.setDate(dayOfMonth);
    if (anchored < date) anchored.setMonth(anchored.getMonth() + 1);
  }
  return anchored;
}

export default function RecurringTasksPanel({ onClose, embedded = false }: RecurringTasksPanelProps) {
  const { supabase, activeBoardId, tenantId, userId, state, members } = useBoard();

  const { data, loading, error, setError } = useEmbeddedPanelData<RecurringTaskTemplate[]>(
    () => fetchRecurringTaskTemplates(supabase, activeBoardId!),
    [supabase, activeBoardId],
    { skip: !activeBoardId, errorMessage: "No se pudieron cargar las tareas recurrentes." }
  );
  const [templates, setTemplates] = useState<RecurringTaskTemplate[]>([]);
  useEffect(() => {
    if (data) setTemplates(data);
  }, [data]);

  const [title, setTitle] = useState("");
  const [columnId, setColumnId] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("weekly");
  const [intervalCount, setIntervalCount] = useState(1);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!columnId && state.columns.length > 0) setColumnId(state.columns[0].id);
  }, [state.columns, columnId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBoardId || !tenantId || !title.trim() || !columnId || !startDate || creating) return;
    setCreating(true);
    setError(null);
    try {
      const anchoredDayOfWeek = frequency === "weekly" ? dayOfWeek : null;
      const anchoredDayOfMonth = frequency === "monthly" ? dayOfMonth : null;
      const anchoredStart = anchorStartDate(new Date(startDate), frequency, anchoredDayOfWeek, anchoredDayOfMonth);
      const created = await createRecurringTaskTemplate(
        supabase,
        tenantId,
        activeBoardId,
        {
          columnId,
          title: title.trim(),
          priority,
          assigneeUserId: assigneeUserId || null,
          frequency,
          intervalCount,
          dayOfWeek: anchoredDayOfWeek,
          dayOfMonth: anchoredDayOfMonth,
          nextRunAt: anchoredStart.toISOString(),
        },
        userId
      );
      setTemplates((prev) => [created, ...prev]);
      setTitle("");
      setStartDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la tarea recurrente.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(tpl: RecurringTaskTemplate) {
    try {
      await toggleRecurringTaskTemplate(supabase, tpl.id, !tpl.active);
      setTemplates((prev) => prev.map((t) => (t.id === tpl.id ? { ...t, active: !t.active } : t)));
    } catch (err) {
      console.error("No se pudo actualizar la tarea recurrente:", err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteRecurringTaskTemplate(supabase, id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error("No se pudo eliminar la tarea recurrente:", err);
    }
  }

  function columnLabel(id: string): string {
    return state.columns.find((c) => c.id === id)?.title ?? "—";
  }

  return (
    <AdminPanelShell embedded={embedded} onClose={onClose} title="Tareas recurrentes" width={640}>
      <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 0 }}>
        Crea una tarea nueva automáticamente de forma diaria, semanal o mensual — útil para checklists recurrentes,
        reportes periódicos, etc.
      </p>
      {error && <p role="alert" className="field-error">{error}</p>}

      <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <div className="field">
          <label htmlFor="rt-title">Título de la tarea</label>
          <input id="rt-title" value={title} onChange={(e) => setTitle(e.target.value)} required disabled={creating} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="rt-column">Columna</label>
            <select id="rt-column" value={columnId} onChange={(e) => setColumnId(e.target.value)} disabled={creating}>
              {state.columns.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rt-priority">Prioridad</label>
            <select id="rt-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} disabled={creating}>
              <option value="low">{priorityLabel("low")}</option>
              <option value="medium">{priorityLabel("medium")}</option>
              <option value="high">{priorityLabel("high")}</option>
              <option value="urgent">{priorityLabel("urgent")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="rt-assignee">Responsable (opcional)</label>
            <select id="rt-assignee" value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)} disabled={creating}>
              <option value="">Sin asignar</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.fullName || m.email || m.userId}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="rt-frequency">Frecuencia</label>
            <select id="rt-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)} disabled={creating}>
              <option value="daily">Diaria</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensual</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="rt-interval">Cada</label>
            <input
              id="rt-interval"
              type="number"
              min={1}
              max={30}
              value={intervalCount}
              onChange={(e) => setIntervalCount(Math.max(1, Number(e.target.value)))}
              disabled={creating}
            />
          </div>
          <div className="field">
            <label htmlFor="rt-start">Primera vez</label>
            <input
              id="rt-start"
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              disabled={creating}
            />
          </div>
        </div>
        {frequency === "weekly" && (
          <div className="field">
            <label htmlFor="rt-day-of-week">Día de la semana</label>
            <select
              id="rt-day-of-week"
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              disabled={creating}
            >
              {WEEKDAY_LABEL.map((label, i) => (
                <option key={i} value={i}>{label}</option>
              ))}
            </select>
          </div>
        )}
        {frequency === "monthly" && (
          <div className="field">
            <label htmlFor="rt-day-of-month">Día del mes</label>
            <input
              id="rt-day-of-month"
              type="number"
              min={1}
              max={28}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value))))}
              disabled={creating}
            />
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
              Máximo 28 para que exista en todos los meses.
            </p>
          </div>
        )}
        <button type="submit" className="btn primary" disabled={creating || !title.trim() || !startDate} style={{ alignSelf: "flex-start" }}>
          {creating ? "Creando…" : "Crear tarea recurrente"}
        </button>
      </form>

      {loading ? (
        <p>Cargando…</p>
      ) : templates.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>Sin tareas recurrentes configuradas.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {templates.map((t) => (
            <li
              key={t.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                opacity: t.active ? 1 : 0.55,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {FREQUENCY_LABEL[t.frequency]} · cada {t.intervalCount}
                  {t.dayOfWeek !== null ? ` · ${WEEKDAY_LABEL[t.dayOfWeek]}` : ""}
                  {t.dayOfMonth !== null ? ` · día ${t.dayOfMonth}` : ""} · {columnLabel(t.columnId)} · próxima:{" "}
                  {new Date(t.nextRunAt).toLocaleString("es-EC")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button type="button" className="btn" onClick={() => handleToggle(t)}>
                  {t.active ? "Pausar" : "Reanudar"}
                </button>
                <button type="button" className="btn" onClick={() => handleDelete(t.id)}>
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminPanelShell>
  );
}
