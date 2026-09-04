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
  // Resuelve el external_ticket_id devuelto por el CRM tras una creación
  // (crm_sync, 20260904000000_crm_generic_adapter.sql) — corre cada minuto
  // porque vive en pg_cron (Postgres), no en el cron de Vercel.
  { name: "taskflow_resolve_crm_sync_responses", schedule: "every_minute" },
] as const;
