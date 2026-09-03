// Fuente única de verdad para los jobs de pg_cron monitoreados por
// /api/health/cron y /api/cron/alert-check. Antes cada ruta tenía su propia
// copia de esta lista — cuando se agregó taskflow_execute_recurring_tasks
// (20260903110000_add_recurring_tasks.sql) quedó fuera de get_cron_health()
// Y de ambas copias, dejando ese cron completamente invisible para el
// sistema de monitoreo (AUDITORIA_2026-09-03.md, hallazgo 3). Debe
// coincidir exactamente con la lista `monitored_jobs` de get_cron_health()
// en supabase/migrations/20260903200000_audit_fase_a_security_fixes.sql.
export const MONITORED_JOBS = [
  { name: "taskflow_check_due_soon_tasks", schedule: "hourly" },
  { name: "taskflow_execute_due_date_automations", schedule: "hourly" },
  { name: "taskflow_execute_sla_automations", schedule: "hourly" },
  { name: "taskflow_execute_recurring_tasks", schedule: "hourly" },
  { name: "purge-expired-audit-logs", schedule: "daily" },
  { name: "record-daily-metrics-snapshots", schedule: "daily" },
] as const;
