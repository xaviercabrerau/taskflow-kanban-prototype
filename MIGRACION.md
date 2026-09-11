# Migración de TaskFlow a otra cuenta

**Última actualización:** 2026-09-09

Este documento es el procedimiento completo para mover TaskFlow desde las
cuentas actuales (GitHub / Vercel / Supabase / servicios auxiliares) a otras
cuentas distintas, sin perder datos ni dejar el servicio roto a medias.

> ¿Buscas cambiar de cuenta de **Claude** (memoria, historial de sesión,
> conexiones MCP) para seguir trabajando en este mismo proyecto? Eso es una
> migración distinta e independiente de esta — ver
> [`MIGRACION_CUENTA_CLAUDE.md`](MIGRACION_CUENTA_CLAUDE.md).

Los valores que aparecen aquí son los **reales de la instalación actual**. Al
migrar, cada uno se reemplaza por su equivalente en la cuenta destino.

---

## 1. Inventario de servicios

| Servicio | Para qué se usa | Identificador actual | ¿Obligatorio? |
|---|---|---|---|
| **GitHub** | Repositorio y origen del despliegue | `xaviercabrerau/taskflow-kanban-prototype` | Sí |
| **Vercel** | Hosting, build, cron jobs | proyecto `taskflow-kanban-prototype`<br>projectId `prj_pl3xpYa4CT6TUU5WbaheSmcZSozF`<br>orgId `team_LUyGoTDapYDMjHCRVzQaFiaX` | Sí (o equivalente) |
| **Supabase** | Base de datos Postgres, autenticación, RLS | project ref `txdyijyswpsalqnwfopc` | Sí |
| **Dominio** | URL pública | `task.conto.ec` | Sí |
| **Resend** | Envío de emails y notificaciones | dominio verificado del remitente | Sí, para notificaciones |
| **Upstash Redis** | Rate limiting y caché | base REST de Upstash | Sí, para rate limiting |
| **Sentry** | Rastreo de errores | proyecto Sentry | Opcional |
| **Google Cloud** | OAuth de Drive / Calendar / Gmail | cliente OAuth + API key del Picker | Opcional (solo si se usan esas integraciones) |

**Lo que NO se migra solo y hay que rehacer a mano:** todos los secretos
(claves y tokens), la verificación del dominio en Resend, las URLs de
redirección de OAuth en Google Cloud, los registros DNS del dominio y los
usuarios de autenticación de Supabase.

---

## 2. Antes de empezar

1. **Congela los cambios.** No despliegues funcionalidad nueva durante la
   migración: vas a comparar el estado viejo contra el nuevo.
2. **Ten a mano un respaldo fresco** de la base de datos (ver paso 4.2).
3. **Anota qué usuarios reales existen hoy**, porque los vas a validar después:
   ```sql
   select count(*) from auth.users;
   select count(*) from organization_members;
   select count(*) from tasks;
   ```
4. **No borres nada del entorno viejo** hasta terminar el paso 9. El plan de
   reversión depende de que siga existiendo.

---

## 3. GitHub

Dos caminos, según si quieres conservar el historial y los issues:

- **Transferir el repositorio** (conserva historial, issues, PRs):
  Settings → General → Danger Zone → *Transfer ownership*. Después, en tu clon
  local, actualiza el remoto:
  ```bash
  git remote set-url origin https://github.com/<nueva-cuenta>/taskflow-kanban-prototype.git
  git remote -v
  ```

- **Crear un repositorio nuevo y empujar** (empieza limpio, sin issues):
  ```bash
  git remote set-url origin https://github.com/<nueva-cuenta>/<nuevo-repo>.git
  git push -u origin main
  ```

El proyecto trabaja y despliega directamente sobre la rama **`main`**.

---

## 4. Supabase

### 4.1 Crear el proyecto destino

1. Crea un proyecto nuevo en la cuenta destino. Anota su **project ref** (el
   identificador que aparece en la URL del dashboard) y elige la región más
   cercana a tus usuarios.
2. Guarda de *Project Settings → API*: la **URL**, la **anon key** y la
   **service role key**. Son tres de las variables de entorno del paso 6.

> La **service role key** salta todas las políticas RLS. Nunca la pongas en
> código cliente, en un repositorio ni en documentación: solo como variable de
> entorno del servidor.

### 4.2 Respaldar el proyecto actual

```bash
# Estructura + datos completos (requiere la contraseña de la BD actual)
pg_dump "postgresql://postgres:<password>@db.txdyijyswpsalqnwfopc.supabase.co:5432/postgres" \
  --no-owner --no-privileges -f taskflow-backup.sql

# Solo los datos (útil si vas a recrear el esquema con las migraciones)
pg_dump "postgresql://postgres:<password>@db.txdyijyswpsalqnwfopc.supabase.co:5432/postgres" \
  --no-owner --no-privileges --data-only -f taskflow-datos.sql
```

También puedes usar *Database → Backups* en el dashboard de Supabase.

### 4.3 Recrear el esquema

El esquema completo está versionado en el repo: **114 archivos de migración** en
`supabase/migrations/`. Esa es la fuente de verdad del esquema — no lo recrees a
mano.

```bash
supabase link --project-ref <nuevo-project-ref>
supabase db push
```

Verifica que las tablas y políticas RLS quedaron creadas:
```sql
select tablename from pg_tables where schemaname = 'public' order by tablename;
select tablename, policyname from pg_policies where schemaname = 'public' order by tablename;
```

### 4.4 Migrar los datos

Restaura el volcado de datos sobre el esquema ya creado:
```bash
psql "postgresql://postgres:<password>@db.<nuevo-project-ref>.supabase.co:5432/postgres" \
  -f taskflow-datos.sql
```

### 4.5 Migrar los usuarios de autenticación

Los usuarios viven en el esquema `auth`, no en `public`. Tienes dos opciones:

- **Recrearlos** con la API de administración (`auth.admin.createUser`) y pedir a
  cada usuario que restablezca su contraseña. Es lo más limpio y lo que hace ya
  el panel de administración del propio proyecto.
- **Migrar la tabla `auth.users`** tal cual, conservando los hashes de contraseña
  para que nadie tenga que cambiarla. Requiere acceso al esquema `auth` y cuidar
  que los `id` (UUID) se mantengan **idénticos**.

> **Crítico:** los `id` de `auth.users` son las llaves foráneas de `profiles`,
> `organization_members`, `role_assignments`, `tasks.created_by`, etc. Si los
> UUID cambian, los datos quedan huérfanos. Si recreas usuarios desde cero,
> tienes que remapear esas referencias.

### 4.6 Verificar la separación de permisos

Este proyecto tiene **dos sistemas de permisos independientes** y es la fuente
de errores más común después de una migración:

- `organization_members.org_role` (owner / admin / member / guest) — controla el
  acceso al panel de administración.
- `role_assignments` (una fila por tablero, apuntando a `roles`) — controla los
  permisos reales sobre el contenido (`task.create`, `task.update`, …). **Las
  políticas RLS revisan esto, no `org_role`.**

Un usuario con `org_role = 'admin'` pero **sin** filas en `role_assignments` no
podrá crear tareas. Verifica después de migrar:
```sql
select om.user_id, om.org_role, count(ra.id) as roles_rbac
from organization_members om
left join role_assignments ra on ra.user_id = om.user_id
group by om.user_id, om.org_role;
```

---

## 5. Servicios auxiliares

### Resend (email)
1. Crea la API key en la cuenta destino.
2. **Verifica el dominio remitente** (registros DNS que da Resend). Sin dominio
   verificado, los emails no salen.
3. `NOTIFICATION_FROM_EMAIL` debe usar un dominio verificado en esa cuenta.

### Upstash Redis (rate limiting)
1. Crea una base Redis nueva y copia su URL y token REST.
2. El proyecto lee tanto `UPSTASH_REDIS_REST_*` como `KV_REST_API_*` — configura
   el par que corresponda a cómo la conectes (la integración de Vercel inyecta
   las `KV_REST_API_*` automáticamente).
3. Los contadores de rate limiting no se migran: empiezan de cero, y no pasa nada.

### Sentry (opcional)
Crea el proyecto y copia el DSN a `SENTRY_DSN` y `NEXT_PUBLIC_SENTRY_DSN`. Si no
lo configuras, la aplicación funciona igual, sin rastreo de errores.

### Google Cloud OAuth (opcional)
Solo si usas las integraciones de Drive / Calendar / Gmail:
1. Crea el cliente OAuth y la API key del Picker en el proyecto de Google Cloud
   destino.
2. **Actualiza las URIs de redirección autorizadas** al dominio nuevo — este es
   el paso que más se olvida y rompe el login de la integración:
   `https://<dominio-nuevo>/api/integrations/google/callback`
3. `GOOGLE_OAUTH_REDIRECT_URI` debe coincidir **exactamente** con lo registrado
   en Google Cloud.

---

## 6. Variables de entorno

Configúralas en la cuenta nueva de Vercel (*Settings → Environment Variables*)
para los entornos Production, Preview y Development, y en `.env.local` para
desarrollo local.

### Obligatorias

| Variable | De dónde sale | ¿Cambia al migrar? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (secreta) | Sí |
| `NEXT_PUBLIC_APP_URL` | El dominio público nuevo | Sí |

### Notificaciones por email

| Variable | De dónde sale | ¿Cambia al migrar? |
|---|---|---|
| `RESEND_API_KEY` | Resend → API Keys | Sí |
| `NOTIFICATION_FROM_EMAIL` | Remitente en un dominio verificado en Resend | Sí |

### Rate limiting / caché

| Variable | De dónde sale | ¿Cambia al migrar? |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash → base Redis | Sí |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash → base Redis | Sí |
| `KV_REST_API_URL` | Integración KV de Vercel | Sí |
| `KV_REST_API_TOKEN` | Integración KV de Vercel | Sí |

### Secretos propios de la aplicación

| Variable | Qué protege | ¿Cambia al migrar? |
|---|---|---|
| `JWT_SECRET` | Firma de los tokens de la API pública `/api/v1/*` | Puedes conservarlo o generarlo nuevo — **ver aviso abajo** |
| `CRON_SECRET` | Autentica el cron de Vercel contra `/api/cron/alert-check` | Genera uno nuevo |
| `INTERNAL_NOTIFY_SECRET` | Protege `/api/internal/notify-event` | Genera uno nuevo |

> **Aviso sobre `JWT_SECRET`:** si generas uno nuevo, **todas las API keys que
> tus usuarios ya tengan emitidas dejan de funcionar** (las de `/admin/api-keys`
> y las de la integración MCP). Tendrán que reemitirlas. Si quieres una
> migración transparente para ellos, conserva el mismo valor.

Para generar secretos nuevos:
```bash
openssl rand -base64 32
```

### Integraciones opcionales

| Variable | Servicio |
|---|---|
| `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_OAUTH_REDIRECT_URI` | Google OAuth (debe apuntar al dominio nuevo) |
| `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | Google Picker (Drive) |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Sentry |
| `ALERT_WEBHOOK_URL` | Webhook de alertas (Slack u otro) |

> **Cuidado al usar `vercel env pull`:** ese comando sobrescribe tu `.env.local`.
> Si tienes valores locales que no están en Vercel, respáldalo antes.

---

## 7. Vercel

1. Importa el repositorio en la cuenta destino (*Add New → Project*).
2. Framework: Next.js. Los ajustes por defecto sirven; los comandos reales son
   `npm run build` para construir y `npm install` para instalar.
3. Carga **todas** las variables del paso 6 antes del primer despliegue.
4. Verifica que el cron quedó registrado. Está declarado en `vercel.json` y hay
   **uno solo**:
   ```json
   { "crons": [ { "path": "/api/cron/alert-check", "schedule": "0 8 * * *" } ] }
   ```
   (diario a las 08:00 UTC). Aparece en *Settings → Cron Jobs* después del
   primer despliegue a producción.
5. Asigna el dominio en *Settings → Domains* y actualiza los registros DNS.

> **Nota sobre la dependencia `xlsx`:** está instalada desde el CDN de SheetJS
> (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) y **no** desde el
> registro de npm, porque la versión publicada en npm tiene dos
> vulnerabilidades HIGH sin parche. Es intencional. El build necesita poder
> alcanzar ese CDN; no lo "arregles" cambiándolo a `xlsx: ^0.18.5`.

Despliegue manual a producción:
```bash
git push origin main
vercel deploy --prod
```

---

## 8. Verificación posterior

Ejecuta esto contra el dominio nuevo, en orden. No des la migración por buena
hasta que todo pase.

```bash
# 1. Salud del servicio y conexión a la base de datos
curl -s https://<dominio-nuevo>/api/health
# Esperado: {"status":"ok","checks":{"supabase":{"ok":true,...}},...}

# 2. Build y tests en local, apuntando al entorno nuevo
npx tsc --noEmit
npm run build
npm test
# Esperado: 15 suites, 215 tests, todo en verde
```

Checklist funcional en el navegador:

- [ ] Iniciar sesión con un usuario real migrado
- [ ] El tablero Kanban carga con sus tareas y columnas
- [ ] Crear una tarea, moverla de columna y comentarla
- [ ] Entrar al panel `/admin` como owner y ver la lista de usuarios
- [ ] Crear un usuario de prueba desde `/admin/usuarios` y confirmar que **puede
      crear tareas** (esto valida que el rol RBAC se asignó, no solo el
      `org_role`) — bórralo al terminar
- [ ] Descargar la plantilla en `/admin/importar-tareas` e importar 2 filas de
      prueba — bórralas al terminar
- [ ] Llega un email de notificación (valida Resend y el dominio verificado)
- [ ] Si usas Google: conectar la integración desde `/admin/integraciones`
      (valida las URIs de redirección)
- [ ] Esperar o forzar el cron `/api/cron/alert-check` y ver que responde 200
- [ ] Comprobar los datos: mismos conteos de usuarios, miembros y tareas que
      anotaste en el paso 2

---

## 9. Cierre

1. Deja el entorno viejo funcionando y en solo lectura durante unos días.
2. Cuando el nuevo esté validado, **rota los secretos del entorno viejo** (claves
   de Supabase, Resend, Upstash) para que un despliegue antiguo no siga
   escribiendo en servicios reales.
3. Recién entonces, da de baja el proyecto viejo en Vercel y Supabase.

**Reversión:** mientras no hayas apagado el entorno anterior ni cambiado los DNS
de forma definitiva, revertir es apuntar el dominio de vuelta al despliegue
viejo. Por eso el orden importa: DNS al final, baja del entorno viejo después de
todo lo demás.

---

## 10. Resumen de valores a reemplazar

| Dónde | Valor actual | Reemplazar por |
|---|---|---|
| Repositorio | `xaviercabrerau/taskflow-kanban-prototype` | repo de la cuenta destino |
| Dominio público | `task.conto.ec` | dominio nuevo |
| Supabase project ref | `txdyijyswpsalqnwfopc` | ref del proyecto nuevo |
| Vercel projectId | `prj_pl3xpYa4CT6TUU5WbaheSmcZSozF` | el que asigne Vercel |
| Vercel orgId | `team_LUyGoTDapYDMjHCRVzQaFiaX` | el de la cuenta destino |
| URI de redirección OAuth | `https://task.conto.ec/api/integrations/google/callback` | mismo path, dominio nuevo |
| Todas las claves y tokens | — | regenerar en cada servicio destino |

Estos valores también aparecen en otros documentos del repositorio (guías de
despliegue, runbooks, checklists). Al migrar, búscalos y actualízalos:

```bash
grep -rn "task.conto.ec\|txdyijyswpsalqnwfopc\|xaviercabrerau" --include="*.md" . \
  | grep -v node_modules
```
