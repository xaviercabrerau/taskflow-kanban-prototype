-- Minor finding from the platform audit's advisor scan: is_safe_webhook_url
-- is the only function in this schema missing SET search_path (every
-- sibling SECURITY DEFINER/plpgsql function already sets it), which the
-- Supabase linter flags as function_search_path_mutable. This function is
-- IMMUTABLE and only does string parsing on its own text argument, so the
-- mutable-search-path risk is theoretical here, but there's no reason to
-- leave it inconsistent with every other function.
create or replace function public.is_safe_webhook_url(url text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  host text;
begin
  if url is null or url !~* '^https://' then
    return false;
  end if;
  host := lower(substring(url from '^https://([^/:]+)'));
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
$$;
