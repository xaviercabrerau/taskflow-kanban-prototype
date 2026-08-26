-- Crea el bucket privado 'task-attachments' (Supabase Storage) para archivos
-- reales asociados a public.attachments. Bucket NO público: los archivos se
-- sirven vía signed URLs generadas desde el backend/frontend autenticado,
-- nunca vía URL pública directa.
insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

-- Convención de path de objeto: "{tenant_id}/{task_id}/{filename}"
-- storage.foldername(name) devuelve los segmentos de carpeta como text[]:
--   (storage.foldername(name))[1] = tenant_id (uuid como texto)
--   (storage.foldername(name))[2] = task_id   (uuid como texto)
-- Cada policy valida, vía cast a uuid + EXISTS, que:
--   1) el usuario autenticado es miembro de esa organización (is_org_member), y
--   2) existe una tarea real (public.tasks) con ese id perteneciente a ese tenant_id.
-- Esto evita que un miembro de una organización pueda leer/escribir/borrar
-- objetos bajo el path de una tarea de OTRO tenant, aunque adivine el uuid.

create policy task_attachments_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and is_org_member((storage.foldername(name))[1]::uuid)
    and exists (
      select 1 from public.tasks t
      where t.id = (storage.foldername(name))[2]::uuid
        and t.tenant_id = (storage.foldername(name))[1]::uuid
    )
  );

create policy task_attachments_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'task-attachments'
    and is_org_member((storage.foldername(name))[1]::uuid)
    and exists (
      select 1 from public.tasks t
      where t.id = (storage.foldername(name))[2]::uuid
        and t.tenant_id = (storage.foldername(name))[1]::uuid
    )
  );

create policy task_attachments_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and is_org_member((storage.foldername(name))[1]::uuid)
    and exists (
      select 1 from public.tasks t
      where t.id = (storage.foldername(name))[2]::uuid
        and t.tenant_id = (storage.foldername(name))[1]::uuid
    )
  );
