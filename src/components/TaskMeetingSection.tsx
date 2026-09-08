"use client";

import { useEffect, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useAdminData } from "@/context/AdminDataContext";
import { fetchTaskMeetInfo } from "@/lib/supabase/meetings-repo";

interface TaskMeetingSectionProps {
  taskId: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function TaskMeetingSection({ taskId }: TaskMeetingSectionProps) {
  const { supabase } = useBoard();
  const { integrations } = useAdminData();
  const googleConnected = integrations.some((i) => i.provider === "google" && i.hasCredential && i.isActive);

  const [meetFormOpen, setMeetFormOpen] = useState(false);
  const [meetDate, setMeetDate] = useState("");
  const [meetTime, setMeetTime] = useState("");
  const [meetDuration, setMeetDuration] = useState(30);
  const [meetExtraEmails, setMeetExtraEmails] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [meetLink, setMeetLink] = useState<string | null>(null);
  const [meetScheduledAt, setMeetScheduledAt] = useState<string | null>(null);
  const [meetError, setMeetError] = useState<string | null>(null);

  // Ver TaskGithubSection.tsx para la razón del delay de 200ms — mismo
  // patrón que tenía embebido en TaskModal.tsx antes de extraerse a su
  // propio componente (Tarea 9 del plan de 2026-09-04).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      fetchTaskMeetInfo(supabase, taskId)
        .then((info) => {
          if (!cancelled) {
            setMeetLink(info.meetLink);
            setMeetScheduledAt(info.meetScheduledAt);
          }
        })
        .catch((err) => {
          console.error("No se pudo cargar el estado de la reunión:", err);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supabase, taskId]);

  async function handleScheduleMeeting() {
    if (!meetDate || !meetTime || scheduling) return;
    setScheduling(true);
    setMeetError(null);
    try {
      const startTime = new Date(`${meetDate}T${meetTime}`).toISOString();
      const extraEmails = meetExtraEmails
        .split(/[,\s]+/)
        .map((e) => e.trim())
        .filter(Boolean);
      const res = await fetch(`/api/tasks/${taskId}/schedule-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime, durationMinutes: meetDuration, extraEmails }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo agendar la reunión.");
      }
      setMeetLink(json.meetLink);
      setMeetScheduledAt(json.scheduledAt);
      setMeetFormOpen(false);
    } catch (err) {
      setMeetError(err instanceof Error ? err.message : "No se pudo agendar la reunión.");
    } finally {
      setScheduling(false);
    }
  }

  if (!googleConnected) return null;

  return (
    <div className="field task-section">
      <label>Agendar reunión</label>
      {meetLink && !meetFormOpen && (
        <p style={{ fontSize: 13.5, marginBottom: 10 }}>
          Reunión agendada
          {meetScheduledAt ? ` para ${formatDateTime(meetScheduledAt)}` : ""} —{" "}
          <a href={meetLink} target="_blank" rel="noopener noreferrer">
            Unirse en Google Meet
          </a>
        </p>
      )}
      {!meetFormOpen ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setMeetFormOpen(true);
            setMeetError(null);
          }}
        >
          📅 {meetLink ? "Reagendar reunión" : "Agendar reunión"}
        </button>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="meet-date">Fecha</label>
              <input
                id="meet-date"
                type="date"
                value={meetDate}
                onChange={(e) => setMeetDate(e.target.value)}
                disabled={scheduling}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="meet-time">Hora</label>
              <input
                id="meet-time"
                type="time"
                value={meetTime}
                onChange={(e) => setMeetTime(e.target.value)}
                disabled={scheduling}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="meet-duration">Duración</label>
              <select
                id="meet-duration"
                value={meetDuration}
                onChange={(e) => setMeetDuration(Number(e.target.value))}
                disabled={scheduling}
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hora</option>
                <option value={120}>2 horas</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="meet-extra-emails">Invitar también a (opcional)</label>
            <input
              id="meet-extra-emails"
              type="text"
              value={meetExtraEmails}
              onChange={(e) => setMeetExtraEmails(e.target.value)}
              placeholder="cliente@empresa.com, otra@empresa.com"
              disabled={scheduling}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn primary"
              onClick={handleScheduleMeeting}
              disabled={!meetDate || !meetTime || scheduling}
            >
              {scheduling ? "Agendando…" : "Agendar"}
            </button>
            <button type="button" className="btn" onClick={() => setMeetFormOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {meetError && (
        <p role="alert" className="field-error">
          {meetError}
        </p>
      )}
    </div>
  );
}
