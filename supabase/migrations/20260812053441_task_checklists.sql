-- Checklists por tarea. Una tarea puede tener varios checklists (como en
-- Trello); cada uno con sus propios ítems ordenables. Sigue el mismo patrón
-- de RLS que comments/attachments/task_tags: cualquier miembro de la
-- organización dueña de la tarea puede leer/escribir (no hay permiso
-- granular tipo has_permission() para esto, igual que para comentarios).
create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null default 'Checklist',
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  label text not null,
  is_done boolean not null default false,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_checklists_task_id on public.checklists(task_id);
create index idx_checklist_items_checklist_id on public.checklist_items(checklist_id);

alter table public.checklists enable row level security;
create policy checklists_all on public.checklists for all using (
  exists (select 1 from public.tasks t where t.id = task_id and public.is_org_member(t.tenant_id))
);

alter table public.checklist_items enable row level security;
create policy checklist_items_all on public.checklist_items for all using (
  exists (
    select 1 from public.checklists c
    join public.tasks t on t.id = c.task_id
    where c.id = checklist_id and public.is_org_member(t.tenant_id)
  )
);
