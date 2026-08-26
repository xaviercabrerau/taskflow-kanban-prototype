-- Defensa en profundidad de MFA a nivel de RLS: hasta ahora, "mfa_required"
-- solo se hacía cumplir en la app (MfaAalGate/MfaGate) — si ese código
-- tuviera un bug o se retirara, nada en la base de datos impedía que una
-- sesión sin verificación de dos pasos siguiera leyendo datos de la
-- organización. session_meets_mfa() cierra ese hueco.
--
-- Al momento de aplicar esto NINGÚN org tenía mfa_required=true (verificado
-- antes de aplicar), así que este cambio fue un no-op inmediato: nadie
-- quedó bloqueado. El riesgo futuro está acotado a cuando un owner active
-- mfa_required para su propia organización — que es exactamente el
-- comportamiento buscado.
--
-- Deliberadamente NO se envuelven: organizations (org_select) y las tablas
-- de configuración/perfil que el propio flujo de MfaGate necesita leer
-- para decidir si mostrar el enrolamiento — envolverlas crearía un
-- circular lock-out (no podrías leer "¿necesito MFA?" si leer eso ya
-- requiriera MFA).
create or replace function public.session_meets_mfa(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select
    not exists (select 1 from organizations where id = org_id and mfa_required)
    or coalesce((auth.jwt() ->> 'aal') = 'aal2', false);
$$;

revoke execute on function public.session_meets_mfa(uuid) from public, anon;
grant execute on function public.session_meets_mfa(uuid) to authenticated;

alter policy tasks_select on public.tasks
  using (is_org_member(tenant_id) and session_meets_mfa(tenant_id));

alter policy boards_select on public.boards
  using (is_org_member(tenant_id) and session_meets_mfa(tenant_id));

alter policy board_columns_select on public.board_columns
  using (exists (
    select 1 from boards b
    where b.id = board_columns.board_id
      and is_org_member(b.tenant_id)
      and session_meets_mfa(b.tenant_id)
  ));

-- comments_all y attachments_all son políticas FOR ALL (lectura+escritura
-- combinadas) desde antes de este cambio; envolverlas también bloquea
-- escritura sin MFA verificado, lo cual es coherente con el objetivo.
alter policy comments_all on public.comments
  using (exists (
    select 1 from tasks t
    where t.id = comments.task_id
      and is_org_member(t.tenant_id)
      and session_meets_mfa(t.tenant_id)
  ));

alter policy attachments_all on public.attachments
  using (exists (
    select 1 from tasks t
    where t.id = attachments.task_id
      and is_org_member(t.tenant_id)
      and session_meets_mfa(t.tenant_id)
  ));
