alter table public.comments
  add column if not exists parent_comment_id uuid references public.comments(id) on delete cascade;

create index if not exists comments_parent_comment_id_idx on public.comments(parent_comment_id);

create or replace function public.notify_comment_mentions()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  mentioned_id uuid;
  task_rec record;
  actor uuid := auth.uid();
begin
  if NEW.mentioned_user_ids is null or array_length(NEW.mentioned_user_ids, 1) is null then
    return NEW;
  end if;

  select t.id, t.tenant_id, t.title into task_rec from tasks t where t.id = NEW.task_id;
  if task_rec.id is null then
    return NEW;
  end if;

  foreach mentioned_id in array NEW.mentioned_user_ids
  loop
    if mentioned_id is distinct from actor
      and exists (
        select 1 from organization_members om
        where om.user_id = mentioned_id and om.organization_id = task_rec.tenant_id
      )
    then
      insert into notifications (tenant_id, user_id, type, title, body, related_task_id)
      values (
        task_rec.tenant_id,
        mentioned_id,
        'mentioned',
        'Te mencionaron en un comentario',
        format('En "%s": %s', task_rec.title, left(NEW.body, 140)),
        task_rec.id
      );
    end if;
  end loop;

  return NEW;
end;
$function$;

revoke execute on function public.notify_comment_mentions() from anon, authenticated, public;

drop trigger if exists trg_notify_comment_mentions on public.comments;
create trigger trg_notify_comment_mentions
  after insert on public.comments
  for each row execute function public.notify_comment_mentions();
