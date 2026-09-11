# TaskFlow

> Documento de entrada del repositorio. Si nunca viste el proyecto, empieza
> aquí: con este archivo deberías poder clonar, instalar, configurar,
> levantar, testear y desplegar TaskFlow.
>
> **Nota de migración:** este README menciona valores atados a la cuenta
> actual (dominio `task.conto.ec`, proyecto Supabase `txdyijyswpsalqnwfopc`,
> proyecto de Vercel, repo de GitHub). Son los valores reales de hoy. Si el
> proyecto se migra a otra cuenta de GitHub/Vercel/Supabase, el procedimiento
> completo está en [`MIGRACION.md`](./MIGRACION.md).

## Qué es TaskFlow

TaskFlow es una aplicación SaaS multi-tenant de gestión de proyectos y tableros
Kanban, pensada para que varios departamentos de una organización (Desarrollo,
Servicios Técnicos, Contabilidad, etc.) trabajen sobre la misma plataforma con
permisos independientes. Incluye RBAC granular con roles personalizados,
autenticación multifactor (MFA), SSO, un marketplace interno de plantillas de
tablero, un motor de automatizaciones (triggers → condiciones → acciones),
integraciones con terceros vía webhooks, y un servidor MCP nativo que expone
`list_tasks`, `create_task`, `move_task` y `add_comment` como herramientas
para agentes de IA (Claude Desktop, Claude Code) autenticados con tokens de
acceso personal.

El diseño completo de producto (arquitectura, RBAC, notificaciones, roadmap
por fases, esquema de base de datos) vive en `PLAN_MAESTRO_TASKFLOW.md`, un
documento que **no forma parte de este repositorio** (vive en la carpeta
local `~/Claude/`, fuera de git, junto a otros proyectos). Este repositorio
es el prototipo funcional de esa visión: ya no persiste en `localStorage`,
sino en Supabase, con autenticación, multitenancy y RLS reales.

Es una aplicación real pero en etapa temprana: hoy funciona con un puñado de
cuentas de prueba/piloto, no con tráfico de producción a escala.

## Stack técnico

Versiones reales según `package.json`:

| Pieza | Versión / servicio |
|---|---|
| Framework | Next.js **16.3.0** (App Router) |
| UI | React **19.2.8** + TypeScript 5 |
| Base de datos / auth | Supabase (`@supabase/supabase-js` ^2.112.2, `@supabase/ssr` ^0.12.4) — Postgres con RLS, Auth, Realtime |
| Drag & drop | `@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10.0.0, `@dnd-kit/utilities` ^3.2.2 |
| Email transaccional | `resend` ^4.0.1 + `react-email` ^6.9.2 |
| Rate limiting / caché | `@upstash/ratelimit` ^2.0.8 + `@upstash/redis` ^1.38.2 |
| Observabilidad | `@sentry/nextjs` ^10.70.0 |
| Auth de la API pública v1 | `jsonwebtoken` ^9.0.3 |
| Import/export de hojas de cálculo | `xlsx` (SheetJS) — ver nota abajo |
| Tests | Jest 29 + ts-jest |
| Hosting | Vercel — dominio de producción `https://task.conto.ec` |

**Nota sobre `xlsx`:** la dependencia se instala **desde el CDN de SheetJS**
(`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), no desde el registro
de npm. La versión publicada en npm arrastra dos vulnerabilidades HIGH sin
parche (prototype pollution y ReDoS) que SheetJS solo corrige en su propio
CDN. Esto es intencional: **no lo "arregles"** cambiándolo por `xlsx: ^0.18.5`.

## Requisitos

- **Node.js ≥ 20.9.0** (lo exige Next.js 16) y npm.
- Una cuenta de **Supabase** con un proyecto creado (o acceso al existente).
- Opcionalmente, la **CLI de Supabase** (`supabase`) para aplicar migraciones.
- Opcionalmente, la **CLI de Vercel** (`vercel`) para desplegar desde local.
- Cuentas en los servicios externos que quieras activar (ver
  [Servicios externos](#servicios-externos)).

## Instalación

```bash
git clone https://github.com/xaviercabrerau/taskflow-kanban-prototype.git
cd taskflow-kanban-prototype
npm install
cp .env.example .env.local   # y rellena los valores (ver abajo)
npm run dev
```

## Variables de entorno

La lista canónica y comentada vive en [`.env.example`](./.env.example);
cópiala a `.env.local` y rellénala. **Nunca** commitees `.env.local` ni
pegues valores reales de claves en la documentación: `.gitignore` ya excluye
todos los `.env*` salvo `.env.example`.

De dónde sacar cada valor: [`ENV_SETUP_INSTRUCTIONS.md`](./ENV_SETUP_INSTRUCTIONS.md).
Política de manejo, rotación y revocación de credenciales:
[`CREDENTIALS_SETUP.md`](./CREDENTIALS_SETUP.md).

### Mínimo para levantar la app

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública (anon) de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio, solo backend; salta RLS en flujos puntuales |

### Resto de variables usadas por el código

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Base para construir enlaces absolutos en emails |
| `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` | Envío de emails de notificación (Resend) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limiting y caché |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Alternativa a las dos anteriores; es lo que provisiona la integración "Upstash for Redis" del Marketplace de Vercel (nombres legacy de `@vercel/kv`). `src/lib/rate-limit.ts` acepta cualquiera de los dos pares |
| `CRON_SECRET` | Autentica el cron de Vercel contra `/api/cron/alert-check` |
| `INTERNAL_NOTIFY_SECRET` | Autentica los endpoints internos `/api/internal/*` (los llaman triggers de Postgres vía `pg_net`) |
| `JWT_SECRET` | Firma el `state` del OAuth de Google y los tokens de la API pública v1 |
| `ALERT_WEBHOOK_URL` | Webhook entrante (Slack/Discord) al que el cron de alertas publica fallos |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | OAuth de Google server-side (Calendar, Drive, Gmail) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | Botón "Elegir de Google Drive" en el navegador |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Rastreo de errores (opcional; hoy sin activar) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Duplicados sin prefijo `NEXT_PUBLIC_`, usados **solo** por los scripts de `scripts/` |

`NODE_ENV` y `VERCEL_GIT_COMMIT_SHA` los inyecta la plataforma: no los
configures a mano.

## Desarrollo local

```bash
npm run dev
```

La app se sirve en `http://localhost:3000`. El puerto y el comando están
declarados en `.claude/launch.json` bajo la configuración `taskflow-dev`.

Para que arranque necesitas, como mínimo, `NEXT_PUBLIC_SUPABASE_URL` y
`NEXT_PUBLIC_SUPABASE_ANON_KEY` apuntando a un proyecto de Supabase con el
esquema aplicado (ver [Migraciones](#migraciones-de-base-de-datos)). Si no
tienes credenciales del proyecto actual, pídelas al resto del equipo: no
están —ni deben estar— en el repositorio.

## Scripts disponibles

| Script | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo (`next dev`). |
| `npm run build` | Compila la app para producción (`next build`). |
| `npm start` | Sirve el build de producción (`next start`). |
| `npm run lint` | ESLint sobre el proyecto. |
| `npm test` | Suite de Jest. |
| `npm run test:watch` | Jest en modo watch. |
| `npm run test:coverage` | Jest con reporte de cobertura. |

No hay script npm dedicado a la verificación de tipos: se corre con
`npx tsc --noEmit`.

## Tests y verificaciones

```bash
npm test              # 15 suites, 215 tests (estado verificado: 2026-09-09)
npx tsc --noEmit      # verificación de tipos
npm run lint          # ESLint
npm run build         # build de producción
```

Jest está configurado en `jest.config.ts`: entorno `node`, preset `ts-jest`,
y solo recoge `src/**/__tests__/**/*.test.ts`. **No existe un pipeline de CI**
(`.github/workflows/`) en este repositorio: estas cuatro verificaciones se
corren manualmente antes de cada push.

Los directorios `testing/` (pruebas de carga con k6 y de seguridad) y `ops/`
(monitoreo, runbooks, health checks) contienen material operativo que se
mantiene aparte de la suite de Jest.

## Despliegue

La guía completa y canónica de despliegue es
[`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md). Resumen:

- **Hosting:** Vercel, proyecto `taskflow-kanban-prototype`
  (`projectId: prj_pl3xpYa4CT6TUU5WbaheSmcZSozF`,
  `orgId: team_LUyGoTDapYDMjHCRVzQaFiaX`).
- **Origen:** el repo de GitHub `xaviercabrerau/taskflow-kanban-prototype`.
  Se trabaja y se despliega directamente sobre `main`, sin rama intermedia.
- **Despliegue manual:** `vercel deploy --prod`.
- **Cron:** `vercel.json` declara **un** cron —
  `/api/cron/alert-check` a las `0 8 * * *` (08:00 UTC diario).
- **Salud:** `/api/health` y `/api/health/cron` para verificar antes y
  después de cada despliegue.

**Nota de migración:** el dominio, los IDs de Vercel y el repo de GitHub de
arriba corresponden a la cuenta actual. Para moverlos a otra cuenta, ver
[`MIGRACION.md`](./MIGRACION.md).

## Migraciones de base de datos

El proyecto remoto de Supabase (`txdyijyswpsalqnwfopc`) se gestiona mediante
migraciones versionadas en `supabase/migrations/` (**114 archivos** a
2026-09-09). Reglas obligatorias:

1. **Los archivos base del comienzo del historial representan cambios que ya
   fueron aplicados directamente contra el proyecto remoto** (antes de que
   existiera este registro local). No hay que volver a ejecutarlos ni
   modificarlos: son el registro histórico reconstruido para que
   `supabase db push` funcione correctamente de aquí en adelante.

2. **Cualquier cambio de esquema NUEVO debe crearse como un archivo nuevo**
   dentro de `supabase/migrations/`, siguiendo la convención de nombre
   `<timestamp de 14 dígitos>_<nombre_en_snake_case>.sql` (por ejemplo
   `20260811090000_add_workspace_settings_table.sql`). El cambio se aplica
   con:

   ```bash
   supabase link --project-ref txdyijyswpsalqnwfopc
   supabase db push
   ```

   Si se está trabajando dentro de una sesión con un asistente de IA que
   tiene acceso al MCP de Supabase, también se puede usar la herramienta
   `apply_migration` para aplicar el cambio directamente contra el proyecto
   remoto — pero en ese caso el archivo `.sql` resultante debe **committearse
   de inmediato** en `supabase/migrations/`, para que el historial local
   nunca vuelva a divergir del estado real de la base de datos.

3. **Nunca usar `execute_sql` (ni ningún SQL crudo) contra el proyecto
   remoto para cambios de esquema.** Esas herramientas solo deben usarse
   para inspección o depuración de solo lectura (consultar datos, revisar
   políticas RLS existentes, etc.). Cualquier `CREATE`, `ALTER`, `DROP` u
   otro cambio estructural debe pasar siempre por una migración versionada.

**Nota de migración:** el `--project-ref` de arriba es el del proyecto
Supabase actual. Al migrar a otra cuenta cambia, junto con las claves; ver
[`MIGRACION.md`](./MIGRACION.md).

### Dos detalles de arquitectura que sorprenden a todo el mundo

- **`org_role` y RBAC son sistemas separados.** `organization_members.org_role`
  (`owner`/`admin`/`member`/`guest`) no otorga por sí solo permisos granulares
  como `task.create`. Los permisos reales salen de `role_assignments` (una fila
  por tablero, con `role_id` → `roles`), y las políticas RLS revisan
  `role_assignments`, no `org_role`, para las mutaciones de contenido. El rol
  de sistema "Contribuyente" es el que otorga `task.create` / `task.update`.
- **RLS en `profiles`:** la política `profiles_update_own` limita el `UPDATE`
  a `id = auth.uid()`. Un owner que edite el nombre de **otro** usuario debe
  usar un cliente service-role; con el cliente normal el update afecta 0 filas
  y no lanza error. En cambio, `organization_members` sí permite a un owner
  actualizar el `org_role` de otros miembros con el cliente normal
  (`org_members_update`). Además `organization_members` tiene
  `UNIQUE(organization_id, user_id)`: un usuario puede pertenecer a varias
  organizaciones, así que toda consulta de membresía debe filtrar por
  organización, no solo por usuario.

## Estructura del proyecto

```
src/app/                # Rutas del App Router: páginas y /api/*
src/components/         # Componentes de UI (Board, TaskModal, modales de admin...)
src/context/            # BoardContext: estado global y capa de datos
src/hooks/              # Hooks (presencia en tiempo real, accesibilidad de diálogos)
src/lib/                # Lógica de dominio y clientes:
  ├── supabase/         #   clientes y repos por dominio (tasks, roles, mcp, métricas...)
  ├── api-v1/           #   API pública REST v1 (auth por JWT)
  ├── emails/           #   plantillas react-email y utilidades
  ├── notifications/    #   despacho de notificaciones (notify.ts)
  ├── google/           #   OAuth, Calendar, Drive, Gmail
  ├── github/, ai/      #   integraciones opcionales
  ├── import/           #   importación masiva de tareas (task-row.ts)
  ├── tracing/          #   instrumentación
  └── __tests__/        #   tests unitarios
supabase/migrations/    # Historial versionado de cambios de esquema (114 archivos)
scripts/                # Utilidades locales (usuarios y tokens de prueba, validación de entorno)
ops/                    # Monitoreo, alertas, runbooks, health checks
testing/                # Pruebas de carga (k6) y de seguridad
docs/                   # Documentación de detalle (arquitectura, endpoints, testing...)
pitch-deck/             # Material comercial (fuera del alcance del código)
```

### Rutas principales

- **Páginas:** `/` (tablero Kanban), `/dashboard`, `/tabla`, `/calendario`,
  `/gantt`, `/login`, `/reset-password`, `/share/[token]`, y el área
  `/admin/*` (usuarios, roles, workspaces, seguridad, auditoría, plantillas,
  automatizaciones, campos personalizados, tareas recurrentes, planificación,
  portafolio, carga de trabajo, reportes, integraciones, api-keys, api-docs,
  importar-tareas).
- **API:** `/api/admin/*`, `/api/cron/alert-check`, `/api/health`,
  `/api/health/cron`, `/api/integrations/google/*`, `/api/internal/*`,
  `/api/public/share/[token]`, `/api/share-links*`, `/api/tasks/*`,
  `/api/v1/tasks*` (API pública), `/api/mcp`, `/api/gmail-webhook`,
  `/api/webhooks/gmail-reply`.

El inventario detallado de endpoints está en
[`docs/API_ENDPOINTS.md`](./docs/API_ENDPOINTS.md).

## Servicios externos

| Servicio | Para qué | ¿Obligatorio? |
|---|---|---|
| Supabase | Base de datos, auth, RLS, storage | Sí |
| Vercel | Hosting, despliegue, cron jobs | Sí (o equivalente) |
| GitHub | Repositorio, origen del despliegue | Sí |
| Resend | Envío de emails de notificación | Sí para notificaciones |
| Upstash Redis | Rate limiting y caché | Sí para rate limiting |
| Sentry | Rastreo de errores | Opcional (instrumentado, aún sin DSN) |
| Google Cloud (OAuth) | Integración Drive / Calendar / Gmail | Opcional |

## Repositorio

TaskFlow es, desde 2026-08-26, su **propio repositorio git independiente**
(`github.com/xaviercabrerau/taskflow-kanban-prototype`), separado del resto
de proyectos que viven en la misma carpeta local (`~/Claude/`). Antes vivía
mezclado con el historial de otros proyectos dentro de un monorepo cuyo
`.git` raíz se perdió por agotamiento de espacio en disco; el historial de
este repo se reinició en el commit `a5c583f` (2026-08-26) a partir del
estado íntegro y verificado del working tree en ese momento — no contiene
commits previos a esa fecha.

Vercel despliega desde la rama `main` de ese repositorio mediante su
integración nativa con GitHub. Se trabaja directamente sobre `main`.

## Estado reciente

### 2026-09-08 / 09 — Importación masiva de tareas

Funcionalidad completa y verificada en producción:

- Página `/admin/importar-tareas`, visible solo para el owner de la
  organización.
- `GET /api/admin/import-tasks/template` descarga una plantilla `.xlsx`.
- `POST /api/admin/import-tasks` acepta `.xlsx`, `.xls` o `.csv`, con un
  máximo de **500 filas**.
- Cabeceras de la plantilla (constante compartida `IMPORT_HEADERS` en
  `src/lib/import/task-row.ts`): Título, Estado, Prioridad, Asignado,
  Etiqueta, Fecha inicio, Fecha vencimiento.
- La importación es parcial: crea las filas válidas y reporta las inválidas
  por número de fila (1 = primera fila de datos, sin contar la cabecera).
- Detecta el BOM UTF-8 para decidir cómo decodificar un CSV (con BOM,
  detección nativa de SheetJS; sin BOM, fuerza codepage 65001). Ambos casos
  tienen test de regresión.

### 2026-09-03

- **Roadmap de funcionalidades completo**: de los 24 ítems identificados en
  [ROADMAP_FUNCIONALIDADES.md](./ROADMAP_FUNCIONALIDADES.md) (subtareas,
  dependencias, épicas/sprints, vistas guardadas, acciones en lote, time
  tracking, carga de trabajo, portafolio, acceso de invitado + links públicos
  compartibles, tareas recurrentes con anclaje a día, API pública REST, PWA
  instalable, andamiaje de IA y GitHub), **22 quedaron implementados y
  desplegados**. 2 no se construyeron (sugerencia de prioridad por IA;
  recepción / slash commands de Slack — solo se hizo el relay saliente) —
  detalle en el propio roadmap.
- **Auditoría completa** ([AUDITORIA_2026-09-03.md](./AUDITORIA_2026-09-03.md)):
  17 hallazgos en seguridad, base de datos, calidad de código y
  performance/DevOps, **los 17 corregidos**. El más grave: 4 tablas/función
  nuevas se saltaban el gate de verificación en dos pasos (MFA/AAL2) que el
  resto del esquema exige, permitiendo — en una organización con MFA
  obligatorio — que una sesión sin verificación en dos pasos generara un link
  público y leyera el contenido de una tarea sin autenticación alguna. También
  se corrigió un riesgo real de tareas duplicadas (cron sin lock de
  solapamiento) y un cron que había quedado invisible para el sistema de
  monitoreo.
- `tsc --noEmit`, `next build` y la suite de Jest en verde en cada entrega.

### 2026-08-28

- Auditoría de código y seguridad: hallazgos críticos/altos corregidos
  (migraciones duplicadas sin RLS eliminadas, webhook de Gmail sin
  autenticación deshabilitado, kill-switch de MCP restaurado, colisión de
  teclado en drag-and-drop corregida, entre otros).
- Sistema de notificaciones conectado a un envío real (Resend) por primera
  vez — detalle completo en
  [`OBSERVABILITY.md`](./OBSERVABILITY.md#6-notification-system--email--in-app).
  De paso se corrigió un bug real preexistente: marcar notificaciones como
  leídas fallaba silenciosamente en producción (columna `read` inexistente).
- **Los deployments de producción llevaban 10+ días fallando** por un
  "Root Directory" mal configurado en Vercel (resabio de cuando este repo
  vivía dentro de un monorepo) — no relacionado con ningún cambio de código
  de esa sesión. Corregido; el sitio vuelve a desplegar en
  `https://task.conto.ec`.

### 2026-08-26

- Se corrigió un crash de `/dashboard` ("Maximum update depth exceeded"):
  `useSyncExternalStore` leía `Date.now()` como snapshot, un valor nunca
  estable entre llamadas, provocando un loop infinito de renders. Ver
  [`src/components/DashboardView.tsx`](./src/components/DashboardView.tsx).
- Se eliminaron 14 archivos (`src/app/api/analytics/`, `src/app/api/cron/`,
  `src/jobs/`, `src/dashboards/`, `src/lib/logger.ts`) que resultaron ser de
  un sistema de analítica de ventas/inventario ajeno a TaskFlow, mezclado en
  este directorio por el incidente de monorepo descrito arriba. Ninguno
  compilaba ni tenía referencias desde código legítimo de TaskFlow.

## Documentación relacionada

### Documentos maestros

| Documento | Qué cubre |
|---|---|
| [`MIGRACION.md`](./MIGRACION.md) | **Procedimiento completo para migrar el proyecto a otra cuenta** de GitHub / Vercel / Supabase / Resend / Upstash / Google Cloud. |
| [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md) | Guía canónica de despliegue a producción. |
| [`ENV_SETUP_INSTRUCTIONS.md`](./ENV_SETUP_INSTRUCTIONS.md) | De dónde se obtiene cada variable de entorno. |
| [`CREDENTIALS_SETUP.md`](./CREDENTIALS_SETUP.md) | Manejo seguro, rotación y revocación de credenciales. |
| [`CONFIG_CHECKLIST.md`](./CONFIG_CHECKLIST.md) | Checklist de configuración antes de desplegar. |
| [`DEPLOYMENT_READINESS_README.md`](./DEPLOYMENT_READINESS_README.md) | Índice del conjunto de documentos de despliegue. |

### Estado y detalle técnico

- [`DOCUMENTACION_PROYECTO.md`](./DOCUMENTACION_PROYECTO.md) — documentación
  funcional y técnica extendida.
- [`ROADMAP_FUNCIONALIDADES.md`](./ROADMAP_FUNCIONALIDADES.md) — roadmap y
  estado de cada funcionalidad.
- [`OBSERVABILITY.md`](./OBSERVABILITY.md) — qué monitoreo y alertas están
  activos hoy y qué le falta a cada pieza (Sentry, Upstash, cron de alertas).
- [`AUDITORIA_2026-09-03.md`](./AUDITORIA_2026-09-03.md) — última auditoría
  de seguridad y calidad.
- [`docs/`](./docs/) — arquitectura, endpoints, testing, gestión de usuarios y
  guías de detalle.
- [`TERMS_OF_SERVICE.md`](./TERMS_OF_SERVICE.md) y
  [`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md) — estado legal del producto.
- `PLAN_PRODUCCION_TASKFLOW.md` — estado de preparación para producción
  (documento externo a este repo, en `~/Claude/`).
