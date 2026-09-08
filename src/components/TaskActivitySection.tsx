"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { fetchActivity, describeActivity, type TaskActivity } from "@/lib/supabase/activity-repo";
import type { ColumnData } from "@/lib/types";

interface TaskActivitySectionProps {
  taskId: string;
  columns: ColumnData[];
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function TaskActivitySection({ taskId, columns }: TaskActivitySectionProps) {
  const { supabase, members } = useBoard();
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  // Actividad es una sección "core" del modal — se carga de inmediato al
  // montar, igual que antes cuando vivía en el efecto combinado de
  // TaskModal.tsx (Tarea 9 del plan de 2026-09-04).
  useEffect(() => {
    let cancelled = false;
    fetchActivity(supabase, taskId)
      .then((data) => {
        if (!cancelled) setActivity(data);
      })
      .catch((err) => {
        console.error("No se pudo cargar el historial de actividad:", err);
        if (!cancelled) setActivityError("No se pudo cargar el historial de actividad.");
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
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

  function resolveColumnName(colId: string): string | undefined {
    return columns.find((c) => c.id === colId)?.title;
  }

  return (
    <div className="field task-section">
      <label>Actividad</label>
      {activityError ? <p role="alert" className="field-error">{activityError}</p> : null}
      {activityLoading ? (
        <p>Cargando actividad…</p>
      ) : activity.length === 0 ? (
        <p>Sin actividad registrada.</p>
      ) : (
        <ul className="activity-list">
          {activity.map((a) => (
            <li key={a.id} className="activity-item">
              <span className="activity-text">{describeActivity(a, resolveColumnName)}</span>
              <span className="activity-meta">
                {authorName(a.actorId)} · {formatDateTime(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
