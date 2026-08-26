create extension if not exists pg_net;

create or replace function public.automation_conditions_match(
  conditions jsonb, p_priority text, p_tag text, p_assignee_name text, p_title text
) returns boolean
language plpgsql
immutable
as $$
declare
  cond jsonb;
  field_val text;
begin
  if conditions is null or jsonb_array_length(conditions) = 0 then
    return true;
  end if;

  for cond in select jsonb_array_elements(conditions) loop
    field_val := case cond->>'field'
      when 'priority' then p_priority
      when 'tag' then p_tag
      when 'assignee_name' then p_assignee_name
      when 'title' then p_title
      else null
    end;

    if cond->>'operator' = 'eq' then
      if field_val is distinct from (cond->>'value') then return false; end if;
    elsif cond->>'operator' = 'neq' then
      if field_val is not distinct from (cond->>'value') then return false; end if;
    elsif cond->>'operator' = 'contains' then
      if field_val is null or position(lower(cond->>'value') in lower(field_val)) = 0 then return false; end if;
    end if;
  end loop;

  return true;
end;
$$;

revoke execute on function public.automation_conditions_match(jsonb, text, text, text, text) from anon, authenticated, public;
grant execute on function public.automation_conditions_match(jsonb, text, text, text, text) to postgres;
