CREATE OR REPLACE FUNCTION public.check_due_soon_tasks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t_rec record;
begin
  for t_rec in
    select t.*
    from public.tasks t
    where t.due_date is not null
      and t.due_date between now() and now() + interval '24 hours'
      and t.due_soon_notified_at is null
      and t.created_by is not null
  loop
    begin
      insert into public.notifications (tenant_id, user_id, type, title, body, related_task_id)
      values (t_rec.tenant_id, t_rec.created_by, 'due_soon', 'Tarea próxima a vencer',
              format('"%s" vence el %s', t_rec.title, to_char(t_rec.due_date, 'DD Mon YYYY')),
              t_rec.id);

      update public.tasks
      set due_soon_notified_at = now()
      where id = t_rec.id;
    exception when others then
      insert into public.audit_log (tenant_id, actor_id, source, action, resource_type, resource_id, metadata)
      values (t_rec.tenant_id, null, 'cron', 'check_due_soon_tasks_error', 'task', t_rec.id,
              jsonb_build_object('error', SQLERRM));
    end;
  end loop;
end;
$function$
