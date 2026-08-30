"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { isOverdue, formatDue, priorityLabel, type Task } from "@/lib/types";
import type { OrgMember } from "@/lib/supabase/members-repo";
import type { MetricsReport } from "@/lib/supabase/metrics-repo";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useClickableRow } from "@/hooks/useClickableRow";
import Shell from "./Shell";

const DONUT_COLORS = ["var(--low)", "var(--medium)", "var(--accent)", "var(--muted)"];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

interface MemberSummaryRowData {
  membershipId: string;
  label: string;
  active: number;
  overdue: number;
  done: number;
}

function MemberSummaryRow({ row, onOpen }: { row: MemberSummaryRowData; onOpen: () => void }) {
  const rowProps = useClickableRow(onOpen);
  return (
    <tr className="member-summary-row-clickable" {...rowProps}>
      <td>{row.label}</td>
      <td className="mono">{row.active}</td>
      <td className="mono" style={{ color: row.overdue ? "var(--high)" : undefined }}>
        {row.overdue}
      </td>
      <td className="mono">{row.done}</td>
    </tr>
  );
}

export default function DashboardView() {
  const { state, members, activeBoardId, fetchReport, generateSnapshot } = useBoard();

  const [personTasks, setPersonTasks] = useState<{ label: string; tasks: Task[] } | null>(null);

  const [report, setReport] = useState<MetricsReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [snapshotFeedback, setSnapshotFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchReport(isoDaysAgo(30), isoDaysAgo(0))
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        console.error("No se pudo cargar el reporte de métricas de flujo:", err);
        if (!cancelled) setReportError("No se pudieron cargar las métricas de flujo.");
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchReport, activeBoardId]);

  async function handleGenerateSnapshot() {
    setGenerating(true);
    setSnapshotFeedback(null);
    try {
      const result = await generateSnapshot();
      setSnapshotFeedback(result);
      if (result.ok) {
        const data = await fetchReport(isoDaysAgo(30), isoDaysAgo(0));
        setReport(data);
      }
    } catch (err) {
      setSnapshotFeedback({ ok: false, message: err instanceof Error ? err.message : "No se pudo generar el snapshot." });
    } finally {
      setGenerating(false);
    }
  }

  // Snapshot de "ahora" tomado una sola vez al montar (vía inicializador
  // perezoso de useState, que solo corre en el primer render) — antes usaba
  // useSyncExternalStore con Date.now() como getSnapshot(), pero al no ser
  // un valor estable entre llamadas, React detectaba "cambio" en cada
  // render y entraba en loop infinito ("Maximum update depth exceeded").
  const [now] = useState(() => Date.now());

  const metrics = useMemo(() => {
    const totalTasks = Object.keys(state.tasks).length;
    const distribution = state.columns.map((col) => ({
      title: col.title,
      colorVar: col.colorVar,
      count: col.taskIds.length,
      pct: totalTasks ? (col.taskIds.length / totalTasks) * 100 : 0,
    }));

    const doneColumnIds = new Set(
      state.columns.filter((c) => c.isDoneState).flatMap((c) => c.taskIds)
    );
    const activeAssigneeCounts: Record<string, number> = {};
    let overdueCount = 0;
    const priorityCounts = { urgent: 0, high: 0, medium: 0, low: 0 };
    const activeAgeDays: number[] = [];

    for (const task of Object.values(state.tasks)) {
      const isDone = doneColumnIds.has(task.id);
      if (!isDone) {
        activeAssigneeCounts[task.assignee] = (activeAssigneeCounts[task.assignee] ?? 0) + 1;
        priorityCounts[task.priority] += 1;
        if (isOverdue(task.dueDate)) overdueCount += 1;
        if (task.createdAt) {
          activeAgeDays.push((now - new Date(task.createdAt).getTime()) / 86400000);
        }
      }
    }

    const maxAssigneeCount = Math.max(1, ...Object.values(activeAssigneeCounts));
    const doneCount = doneColumnIds.size;
    const completionRate = totalTasks ? (doneCount / totalTasks) * 100 : 0;
    const avgActiveAgeDays = average(activeAgeDays);

    // Per real member breakdown (active/overdue/done), including members with
    // zero tasks so a manager can spot who's idle. Built with an immutable
    // reduce over `members`, matching the donutSegments convention above.
    const memberBreakdown = members.map((member: OrgMember) => {
      const label = member.fullName || member.email || member.userId;
      const memberTasks = Object.values(state.tasks).filter((task) => task.assigneeUserId === member.userId);
      const counts = memberTasks.reduce(
        (acc, task) => {
          const isDone = doneColumnIds.has(task.id);
          if (isDone) {
            return { ...acc, done: acc.done + 1 };
          }
          if (isOverdue(task.dueDate)) {
            return { ...acc, overdue: acc.overdue + 1 };
          }
          return { ...acc, active: acc.active + 1 };
        },
        { active: 0, overdue: 0, done: 0 }
      );
      return {
        membershipId: member.membershipId,
        userId: member.userId,
        label,
        tasks: memberTasks,
        ...counts,
      };
    });

    // Build donut stroke-dasharray segments from the distribution, immutably:
    // reduce carries the running `cumulative` length forward in its accumulator
    // instead of mutating a `let` across .map() iterations.
    const circumference = 2 * Math.PI * 56;
    const { segments: donutSegments } = distribution.reduce<{
      segments: Array<(typeof distribution)[number] & { length: number; dashoffset: number; color: string }>;
      cumulative: number;
    }>(
      (acc, seg, i) => {
        const length = (seg.pct / 100) * circumference;
        const dashoffset = -acc.cumulative;
        return {
          segments: [
            ...acc.segments,
            { ...seg, length, dashoffset, color: DONUT_COLORS[i % DONUT_COLORS.length] },
          ],
          cumulative: acc.cumulative + length,
        };
      },
      { segments: [], cumulative: 0 }
    );

    return {
      totalTasks,
      doneCount,
      overdueCount,
      completionRate,
      avgActiveAgeDays,
      distribution,
      activeAssigneeCounts,
      maxAssigneeCount,
      priorityCounts,
      circumference,
      donutSegments,
      memberBreakdown,
    };
  }, [state, members, now]);

  const avgThroughput = useMemo(
    () => average((report?.throughput ?? []).map((p) => p.count)),
    [report]
  );
  const avgCycleTimeHours = useMemo(() => {
    const points = (report?.cycleTime ?? []).filter((p) => p.taskCount > 0);
    return average(points.map((p) => p.avgHours));
  }, [report]);

  function openPersonTasks(label: string, tasks: Task[]) {
    setPersonTasks({ label, tasks });
  }

  function columnTitleFor(task: Task): string {
    return state.columns.find((c) => c.taskIds.includes(task.id))?.title ?? "—";
  }

  return (
    <Shell>
      <div className="page-wrap">
        <div className="panel">
          <div className="dash-grid">
            <div className="widget" style={{ gridColumn: "1 / 2" }}>
              <p className="widget-title">Resumen</p>
              <div className="kpi-row">
                <div>
                  <span className="kpi mono">{metrics.totalTasks}</span>
                  <span className="kpi-sub"> tareas totales</span>
                </div>
              </div>
              <div className="kpi-row" style={{ marginTop: 10 }}>
                <div>
                  <span className="kpi mono">{metrics.doneCount}</span>
                  <span className="kpi-sub"> completadas</span>
                </div>
                <div>
                  <span className="kpi mono" style={{ color: metrics.overdueCount ? "var(--high)" : undefined }}>
                    {metrics.overdueCount}
                  </span>
                  <span className="kpi-sub"> vencidas (activas)</span>
                </div>
              </div>
              <div className="kpi-row" style={{ marginTop: 10 }}>
                <div>
                  <span className="kpi mono">{Math.round(metrics.completionRate)}%</span>
                  <span className="kpi-sub"> tasa de finalización</span>
                </div>
                <div>
                  <span className="kpi mono">{metrics.avgActiveAgeDays.toFixed(1)}</span>
                  <span className="kpi-sub"> días de antigüedad prom.</span>
                </div>
              </div>
            </div>

            <div className="widget" style={{ gridColumn: "2 / 3" }}>
              <p className="widget-title">Distribución por estado</p>
              <svg
                viewBox="0 0 160 160"
                width="100%"
                height="160"
                role="img"
                aria-label={`Distribución de ${metrics.totalTasks} tareas por estado`}
              >
                <circle cx="80" cy="80" r="56" fill="none" stroke="var(--surface)" strokeWidth="20" />
                {metrics.donutSegments.map((seg) => (
                  <circle
                    key={seg.title}
                    cx="80"
                    cy="80"
                    r="56"
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="20"
                    strokeDasharray={`${seg.length} ${metrics.circumference - seg.length}`}
                    strokeDashoffset={seg.dashoffset}
                    transform="rotate(-90 80 80)"
                  />
                ))}
                <text x="80" y="76" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--fg)">
                  {metrics.totalTasks}
                </text>
                <text x="80" y="94" textAnchor="middle" fontSize="10" fill="var(--muted)">
                  tareas
                </text>
              </svg>
              <div className="legend-row">
                {metrics.donutSegments.map((seg) => (
                  <span key={seg.title}>
                    <span className="dot" style={{ background: seg.color }} />
                    {seg.title} {Math.round(seg.pct)}%
                  </span>
                ))}
              </div>
            </div>

            <div className="widget" style={{ gridColumn: "1 / 2" }}>
              <p className="widget-title">Carga activa por persona</p>
              <p className="widget-hint">Click en una persona para ver sus tareas.</p>
              <div className="bars-person">
                {Object.entries(metrics.activeAssigneeCounts).length === 0 && (
                  <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin tareas activas.</p>
                )}
                {Object.entries(metrics.activeAssigneeCounts).map(([name, count]) => (
                  <button
                    type="button"
                    className="bp-row bp-row-clickable"
                    key={name}
                    onClick={() =>
                      openPersonTasks(
                        name,
                        Object.values(state.tasks).filter((t) => t.assignee === name)
                      )
                    }
                  >
                    <div className="bp-name">{name}</div>
                    <div className="bp-track">
                      <div
                        className="bp-fill"
                        style={{ width: `${(count / metrics.maxAssigneeCount) * 100}%` }}
                      />
                    </div>
                    <div className="bp-val mono">{count}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="widget" style={{ gridColumn: "2 / 3" }}>
              <p className="widget-title">Prioridad (tareas activas)</p>
              <div className="bars-person">
                <div className="bp-row">
                  <div className="bp-name" style={{ color: "var(--urgent)" }}>
                    Urgente
                  </div>
                  <div className="bp-track">
                    <div
                      className="bp-fill"
                      style={{
                        width: `${(metrics.priorityCounts.urgent / Math.max(1, metrics.totalTasks - metrics.doneCount)) * 100}%`,
                        background: "var(--urgent)",
                      }}
                    />
                  </div>
                  <div className="bp-val mono">{metrics.priorityCounts.urgent}</div>
                </div>
                <div className="bp-row">
                  <div className="bp-name" style={{ color: "var(--high)" }}>
                    Alta
                  </div>
                  <div className="bp-track">
                    <div
                      className="bp-fill"
                      style={{
                        width: `${(metrics.priorityCounts.high / Math.max(1, metrics.totalTasks - metrics.doneCount)) * 100}%`,
                        background: "var(--high)",
                      }}
                    />
                  </div>
                  <div className="bp-val mono">{metrics.priorityCounts.high}</div>
                </div>
                <div className="bp-row">
                  <div className="bp-name" style={{ color: "var(--medium)" }}>
                    Media
                  </div>
                  <div className="bp-track">
                    <div
                      className="bp-fill"
                      style={{
                        width: `${(metrics.priorityCounts.medium / Math.max(1, metrics.totalTasks - metrics.doneCount)) * 100}%`,
                        background: "var(--medium)",
                      }}
                    />
                  </div>
                  <div className="bp-val mono">{metrics.priorityCounts.medium}</div>
                </div>
                <div className="bp-row">
                  <div className="bp-name" style={{ color: "var(--low)" }}>
                    Baja
                  </div>
                  <div className="bp-track">
                    <div
                      className="bp-fill"
                      style={{
                        width: `${(metrics.priorityCounts.low / Math.max(1, metrics.totalTasks - metrics.doneCount)) * 100}%`,
                        background: "var(--low)",
                      }}
                    />
                  </div>
                  <div className="bp-val mono">{metrics.priorityCounts.low}</div>
                </div>
              </div>
            </div>

            <div className="widget" style={{ gridColumn: "1 / 3" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <p className="widget-title">Métricas de flujo (Kanban)</p>
                <button type="button" className="btn" onClick={handleGenerateSnapshot} disabled={generating}>
                  {generating ? "Generando…" : "Generar snapshot de hoy"}
                </button>
              </div>
              <p className="widget-hint">
                Últimos 30 días. Throughput = tareas completadas/día. Cycle time = horas promedio en moverse entre columnas.
              </p>
              {snapshotFeedback && (
                <p
                  role={snapshotFeedback.ok ? "status" : "alert"}
                  style={{ color: snapshotFeedback.ok ? "var(--accent)" : "var(--high)", fontSize: 12.5, marginTop: 4 }}
                >
                  {snapshotFeedback.message}
                </p>
              )}
              {reportLoading ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando métricas…</p>
              ) : reportError ? (
                <p className="field-error">{reportError}</p>
              ) : (
                <div className="kpi-row" style={{ marginTop: 10 }}>
                  <div>
                    <span className="kpi mono">{avgThroughput.toFixed(1)}</span>
                    <span className="kpi-sub"> throughput prom. (tareas/día)</span>
                  </div>
                  <div>
                    <span className="kpi mono">{avgCycleTimeHours.toFixed(1)}</span>
                    <span className="kpi-sub"> cycle time prom. (horas)</span>
                  </div>
                  <div>
                    <span className="kpi mono">{report?.throughput.length ?? 0}</span>
                    <span className="kpi-sub"> días con datos</span>
                  </div>
                </div>
              )}
            </div>

            <div className="widget" style={{ gridColumn: "1 / 3" }}>
              <p className="widget-title">Resumen por persona</p>
              <p className="widget-hint">Click en una fila para ver el listado de tareas.</p>
              {metrics.memberBreakdown.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin miembros en la organización.</p>
              ) : (
                <table className="member-summary-table">
                  <thead>
                    <tr>
                      <th>Persona</th>
                      <th>Activas</th>
                      <th>Vencidas</th>
                      <th>Completadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.memberBreakdown.map((row) => (
                      <MemberSummaryRow
                        key={row.membershipId}
                        row={row}
                        onOpen={() => openPersonTasks(row.label, row.tasks)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {personTasks && (
        <PersonTasksModal
          label={personTasks.label}
          tasks={personTasks.tasks}
          columnTitleFor={columnTitleFor}
          onClose={() => setPersonTasks(null)}
        />
      )}
    </Shell>
  );
}

interface PersonTasksModalProps {
  label: string;
  tasks: Task[];
  columnTitleFor: (task: Task) => string;
  onClose: () => void;
}

function PersonTasksModal({ label, tasks, columnTitleFor, onClose }: PersonTasksModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        style={{ width: 480 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <h2>Tareas de {label}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {tasks.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Sin tareas asignadas.</p>
          ) : (
            <ul className="person-task-list">
              {tasks.map((task) => (
                <li key={task.id} className="person-task-item">
                  <div className="person-task-title">{task.title}</div>
                  <div className="person-task-meta">
                    <span className={`chip pr-${task.priority}`}>{priorityLabel(task.priority)}</span>
                    <span className="chip tag">{columnTitleFor(task)}</span>
                    <span className={`due mono${isOverdue(task.dueDate) ? " overdue" : ""}`}>
                      {formatDue(task.dueDate)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-foot">
          <span />
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
