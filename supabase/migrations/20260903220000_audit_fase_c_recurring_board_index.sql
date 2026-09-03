-- Auditoría 2026-09-03, Fase C, hallazgo 12: recurring_task_templates
-- tenía índices en tenant_id y next_run_at (parcial) pero no en board_id,
-- pese a que fetchRecurringTaskTemplates() (src/lib/supabase/recurring-tasks-repo.ts)
-- filtra por esa columna directamente.
create index if not exists recurring_task_templates_board_idx on recurring_task_templates(board_id);
