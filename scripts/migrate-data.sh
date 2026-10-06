#!/usr/bin/env bash
# Migra DATOS y USUARIOS de la base Supabase vieja a la nueva.
# El esquema ya debe estar aplicado en la nueva (supabase db push).
#
# Uso:  bash scripts/migrate-data.sh
#
# - Pide las contraseñas por teclado (no se guardan ni se imprimen).
# - Solo LEE de la base vieja (pg_dump).
# - ESCRIBE en la nueva: vacía las tablas de public y los usuarios de auth y
#   carga el volcado, todo en UNA transacción (si algo falla, no queda nada
#   a medias).
# - El volcado contiene datos personales y hashes de contraseña: queda en
#   ~/taskflow-migration con permisos 600. Bórralo al terminar.
#
# Si la conexión directa falla (la vieja puede ser solo IPv6), usa el pooler:
#   OLD_HOST=aws-0-<region>.pooler.supabase.com OLD_USER=postgres.txdyijyswpsalqnwfopc \
#   bash scripts/migrate-data.sh

set -euo pipefail

OLD_REF="txdyijyswpsalqnwfopc"
NEW_REF="litpmigfigijyjqibysz"
OLD_HOST="${OLD_HOST:-db.${OLD_REF}.supabase.co}"
OLD_USER="${OLD_USER:-postgres}"
NEW_HOST="${NEW_HOST:-db.${NEW_REF}.supabase.co}"
NEW_USER="${NEW_USER:-postgres}"
OUT="$HOME/taskflow-migration"
DUMP="$OUT/datos.sql"

for bin in pg_dump psql; do
  command -v "$bin" >/dev/null || { echo "Falta $bin"; exit 1; }
done

umask 077
mkdir -p "$OUT"
chmod 700 "$OUT"

echo "Origen : $OLD_USER@$OLD_HOST"
echo "Destino: $NEW_USER@$NEW_HOST"
echo
echo "ANTES DE SEGUIR: congela la app vieja (nadie debe escribir mientras se copia)."
read -rp "¿Congelaste la app vieja y quieres continuar? (escribe SI): " ok
case "$ok" in [Ss][Ii]) ;; *) echo "Cancelado (respondiste: '$ok')."; exit 1 ;; esac

read -rsp "Contraseña de la BD VIEJA: " OLD_PW; echo
read -rsp "Contraseña de la BD NUEVA: " NEW_PW; echo

old() { PGPASSWORD="$OLD_PW" psql -h "$OLD_HOST" -U "$OLD_USER" -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
new() { PGPASSWORD="$NEW_PW" psql -h "$NEW_HOST" -U "$NEW_USER" -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

COUNTS="select 'auth.users', count(*) from auth.users
union all select 'profiles', count(*) from public.profiles
union all select 'organization_members', count(*) from public.organization_members
union all select 'role_assignments', count(*) from public.role_assignments
union all select 'boards', count(*) from public.boards
union all select 'tasks', count(*) from public.tasks
order by 1"

echo "Comprobando conexiones..."
old -c "select 1" >/dev/null
new -c "select 1" >/dev/null

echo "Conteos ANTES (vieja):"
old -F ' = ' -c "$COUNTS" | tee "$OUT/conteos_vieja.txt"

echo "Volcando datos de la base vieja..."
# OJO: pg_dump IGNORA --schema cuando hay --table, así que public y las tablas
# de auth van en dos pasadas separadas (una sola pasada dejaba public fuera).
PGPASSWORD="$OLD_PW" pg_dump -h "$OLD_HOST" -U "$OLD_USER" -d postgres \
  --data-only --no-owner --no-privileges \
  --schema=public \
  -f "$DUMP"
PGPASSWORD="$OLD_PW" pg_dump -h "$OLD_HOST" -U "$OLD_USER" -d postgres \
  --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities --table=auth.mfa_factors \
  >> "$DUMP"
chmod 600 "$DUMP"

# Defensa: no escribir nada en la nueva si el volcado no trae lo esencial.
for t in public.tasks public.boards public.profiles public.organization_members auth.users; do
  grep -q "^COPY $t " "$DUMP" || {
    echo "ERROR: el volcado no incluye $t. Abortado: no se escribió nada en la nueva."
    exit 1
  }
done
echo "Volcado: $DUMP ($(du -h "$DUMP" | cut -f1))"

echo
echo "Se va a VACIAR public y auth.users en la base NUEVA y cargar el volcado."
read -rp "¿Continuar? (escribe SI): " ok2
case "$ok2" in [Ss][Ii]) ;; *) echo "Cancelado (respondiste: '$ok2'). Nada se escribió en la nueva."; exit 1 ;; esac

# session_replication_role = replica desactiva triggers de usuario durante la
# carga: sin esto, cada fila insertada dispararía las notificaciones por
# pg_net hacia la app y los triggers de auth.users duplicarían perfiles.
{
  echo "begin;"
  echo "set local session_replication_role = replica;"
  cat <<'SQL'
do $$
declare t text;
begin
  for t in select format('%I.%I', schemaname, tablename)
           from pg_tables where schemaname = 'public' loop
    execute 'truncate table ' || t || ' restart identity cascade';
  end loop;
end $$;
-- DELETE en vez de TRUNCATE ... RESTART IDENTITY: auth.refresh_tokens_id_seq
-- pertenece a supabase_auth_admin y el rol postgres no puede reiniciarla.
-- La base nueva no tiene usuarios, así que solo se limpian las tablas que
-- este script vuelve a cargar.
delete from auth.mfa_factors;
delete from auth.identities;
delete from auth.users;
SQL
  cat "$DUMP"
  echo "commit;"
} | PGPASSWORD="$NEW_PW" psql -h "$NEW_HOST" -U "$NEW_USER" -d postgres -v ON_ERROR_STOP=1 -q

echo
echo "Conteos DESPUÉS (nueva):"
new -F ' = ' -c "$COUNTS" | tee "$OUT/conteos_nueva.txt"
echo
echo "Compara con $OUT/conteos_vieja.txt. Deben ser idénticos."
echo "Cuando valides todo, borra el volcado:  rm -rf $OUT"
