-- tasks.column_id: make the RESTRICT-like behavior explicit and self-documenting
-- (was implicit NO ACTION) — deleting a column that still has tasks should fail,
-- not silently orphan them.
alter table public.tasks drop constraint tasks_column_id_fkey;
alter table public.tasks
  add constraint tasks_column_id_fkey
  foreign key (column_id) references public.board_columns(id)
  on delete restrict;

-- metrics_snapshots.sprint_id: was ON DELETE CASCADE, silently deleting
-- historical BI/velocity snapshots when a sprint is deleted. These are
-- retention/reporting data, not sprint-owned state — preserve the metric
-- row with sprint_id set to null instead.
alter table public.metrics_snapshots drop constraint metrics_snapshots_sprint_id_fkey;
alter table public.metrics_snapshots
  add constraint metrics_snapshots_sprint_id_fkey
  foreign key (sprint_id) references public.sprints(id)
  on delete set null;
