-- Simplificación deliberada para esta fase del prototipo: el modelo completo del
-- plan (task_assignees -> auth.users, tags/task_tags normalizadas) requiere
-- múltiples usuarios reales invitados a la organización, algo que todavía no
-- existe (solo hay un usuario: el dueño de la cuenta). Mientras tanto se guarda
-- el nombre del responsable y la etiqueta como texto plano directamente en
-- `tasks`. Se migrará a task_assignees/tags cuando exista flujo de invitación
-- de miembros.
alter table tasks add column assignee_name text;
alter table tasks add column tag text;
