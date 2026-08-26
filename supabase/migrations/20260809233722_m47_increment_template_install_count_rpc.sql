create or replace function increment_template_install_count(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update board_templates
  set install_count = install_count + 1
  where id = p_template_id and is_public = true;
end;
$$;

grant execute on function increment_template_install_count(uuid) to authenticated;
