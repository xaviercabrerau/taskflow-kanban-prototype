"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import type { OrgMember } from "@/lib/supabase/members-repo";
import {
  fetchTaskTimeEntries,
  startTimer,
  stopTimer,
  addManualEntry,
  deleteTimeEntry,
  type TimeEntry,
} from "@/lib/supabase/time-entries-repo";

interface TaskTimeSectionProps {
  taskId: string;
}

function authorName(members: OrgMember[], authorId: string | null): string {
  if (!authorId) return "Automatización";
  const member = members.find((m) => m.userId === authorId);
  return member?.fullName || member?.email || "Usuario";
}

export default function TaskTimeSection({ taskId }: TaskTimeSectionProps) {
  const { supabase, userId, members } = useBoard();
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [timerBusy, setTimerBusy] = useState(false);
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);

  // Ver TaskGithubSection.tsx para la razón del delay de 200ms — mismo
  // patrón que tenía embebido en TaskModal.tsx antes de extraerse a su
  // propio componente (Tarea 9 del plan de 2026-09-04).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      fetchTaskTimeEntries(supabase, taskId)
        .then((entries) => {
          if (!cancelled) setTimeEntries(entries);
        })
        .catch((err) => {
          console.error("No se pudo cargar el tiempo registrado:", err);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supabase, taskId]);

  const runningEntry = timeEntries.find((e) => e.userId === userId && e.endedAt === null);
  const totalMinutes = timeEntries.reduce((sum, e) => sum + (e.minutes ?? 0), 0);

  async function handleStartTimer() {
    if (!userId || timerBusy) return;
    setTimerBusy(true);
    setTimeError(null);
    try {
      const created = await startTimer(supabase, taskId, userId);
      setTimeEntries((prev) => [created, ...prev]);
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : "No se pudo iniciar el cronómetro.");
    } finally {
      setTimerBusy(false);
    }
  }

  async function handleStopTimer() {
    if (!runningEntry || timerBusy) return;
    setTimerBusy(true);
    setTimeError(null);
    try {
      const updated = await stopTimer(supabase, runningEntry.id, runningEntry.startedAt);
      setTimeEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : "No se pudo detener el cronómetro.");
    } finally {
      setTimerBusy(false);
    }
  }

  async function handleAddManualEntry() {
    const minutes = Number(manualMinutes);
    if (!userId || !minutes || minutes <= 0 || timerBusy) return;
    setTimerBusy(true);
    setTimeError(null);
    try {
      const created = await addManualEntry(supabase, taskId, userId, Math.round(minutes), manualNote.trim() || null);
      setTimeEntries((prev) => [created, ...prev]);
      setManualMinutes("");
      setManualNote("");
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : "No se pudo agregar el registro.");
    } finally {
      setTimerBusy(false);
    }
  }

  async function handleDeleteTimeEntry(entryId: string) {
    try {
      await deleteTimeEntry(supabase, entryId);
      setTimeEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : "No se pudo eliminar el registro.");
    }
  }

  return (
    <div className="field task-section">
      <label>Tiempo</label>
      {timeError && (
        <p role="alert" className="field-error">
          {timeError}
        </p>
      )}
      <p style={{ fontSize: 13.5, marginBottom: 10 }}>
        Total registrado: <strong>{Math.round((totalMinutes / 60) * 10) / 10}h</strong>
      </p>
      {runningEntry ? (
        <button type="button" className="btn danger" onClick={handleStopTimer} disabled={timerBusy}>
          ⏹️ Detener cronómetro
        </button>
      ) : (
        <button type="button" className="btn" onClick={handleStartTimer} disabled={timerBusy}>
          ▶️ Iniciar cronómetro
        </button>
      )}
      <div className="comment-input-wrap" style={{ marginTop: 10 }}>
        <input
          type="number"
          min={1}
          value={manualMinutes}
          onChange={(e) => setManualMinutes(e.target.value)}
          placeholder="Minutos"
        />
        <input value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder="Nota (opcional)" />
        <button type="button" className="btn" onClick={handleAddManualEntry} disabled={!manualMinutes || timerBusy}>
          Agregar
        </button>
      </div>
      {timeEntries.length > 0 && (
        <ul className="attachment-list" style={{ marginTop: 10 }}>
          {timeEntries.map((e) => (
            <li key={e.id} className="attachment-item">
              <span className="attachment-name">
                {authorName(members, e.userId)} —{" "}
                {e.endedAt ? `${e.minutes ?? 0} min` : "en curso…"}
                {e.note ? ` · ${e.note}` : ""}
              </span>
              <button type="button" className="btn danger" onClick={() => handleDeleteTimeEntry(e.id)}>
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
