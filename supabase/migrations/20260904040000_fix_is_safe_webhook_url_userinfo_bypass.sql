-- Cierra un bypass real de is_safe_webhook_url (Tarea 1 del plan de
-- 2026-09-04, docs/superpowers/plans/2026-09-04-pending-improvements-implementation-plan.md):
-- la extracción de host `substring(url from '^https://([^/:]+)')` no
-- excluye '@' de la clase de caracteres, así que para una URL con
-- userinfo (ej. https://x@169.254.169.254/latest/meta-data/) el "host"
-- capturado era literalmente "x@169.254.169.254" — y los chequeos de
-- bloqueo (`host ~ '^169\.254\.'`, etc.) están anclados al inicio del
-- string, así que nunca coincidían. Un cliente HTTP real (pg_net, curl,
-- cualquier cliente conforme a RFC 3986) ignora "x" como userinfo y
-- conecta al host real (169.254.169.254, el endpoint de metadata de
-- nube) — es decir, la función devolvía `true` para una URL que en la
-- práctica apunta a una red privada/interna.
create or replace function public.is_safe_webhook_url(url text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  host text;
  authority text;
begin
  if url is null or url !~* '^https://' then
    return false;
  end if;

  -- autoridad = todo entre 'https://' y el primer '/' (o fin de string si
  -- no hay path) — de ahí se despoja cualquier 'usuario:contraseña@'
  -- antes de extraer el host, igual que haría un parser RFC 3986 real.
  authority := substring(url from '^https://([^/]*)');
  if authority is null or authority = '' then
    return false;
  end if;
  if authority ~ '@' then
    -- Despoja hasta el ÚLTIMO '@' (no el primero) — un userinfo con
    -- '@' múltiples (ej. https://trusted.com@evil.com@127.0.0.1/) debe
    -- resolver al host real después del último '@', igual que un
    -- parser de URL conforme a RFC 3986. .* es greedy, así que consume
    -- el máximo posible antes del último '@'.
    authority := regexp_replace(authority, '^.*@', '');
  end if;

  if authority ~ '^\[' then
    host := lower(substring(authority from '^(\[[0-9a-fA-F:]+\])'));
  else
    host := lower(substring(authority from '^([^:]+)'));
  end if;

  if host is null or host = '' then
    return false;
  end if;
  if host = 'localhost' or host = '0.0.0.0' or host = '[::1]' then
    return false;
  end if;
  if host ~ '^(127\.|10\.|192\.168\.|169\.254\.)' then
    return false;
  end if;
  if host ~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.' then
    return false;
  end if;
  if host ~ '^\[(fe80|fc|fd)' then
    return false;
  end if;
  return true;
end;
$function$;
