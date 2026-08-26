# TaskFlow

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

- **Frontend/Backend:** Next.js 16 (App Router, Turbopack) + React 19 +
  TypeScript.
- **Base de datos y backend:** Supabase (Postgres con Row Level Security,
  Auth, Realtime) — ver la sección de migraciones más abajo.
- **Despliegue:** Vercel, con despliegue automático desde la rama `main`.
- **Drag-and-drop:** `@dnd-kit`.
- **Observabilidad:** endpoints de salud (`/api/health`, `/api/health/cron`)
  y un cron de alertas (`/api/cron/alert-check`, programado a diario vía
  `vercel.json`) ya construidos y funcionando. Sentry (`@sentry/nextjs`) está
  instrumentado en cliente, servidor y edge, pero pendiente de activar: falta
  crear un proyecto en Sentry y configurar su DSN. El rate limiting del
  endpoint MCP (`@upstash/ratelimit` + Upstash Redis) también está construido
  pero pendiente de activar: falta añadir la integración de Upstash en
  Vercel para que las variables de entorno existan (mientras tanto, falla en
  modo abierto — el endpoint sigue funcionando sin límite). Ver
  [`OBSERVABILITY.md`](./OBSERVABILITY.md) para el detalle exacto de qué está
  vivo y qué le falta a cada pieza.

## Desarrollo local

```bash
npm install
npm run dev
```

La app se sirve en `http://localhost:3300` (puerto configurado en
`.claude/launch.json` como `taskflow-kanban-dev`).

Se requiere un archivo `.env.local` con, al menos, `NEXT_PUBLIC_SUPABASE_URL`
y `NEXT_PUBLIC_SUPABASE_ANON_KEY` apuntando al proyecto Supabase
(`txdyijyswpsalqnwfopc`). Nota: este repositorio no incluye actualmente un
`.env.local.example`; si no tienes el archivo `.env.local`, pide las
credenciales al resto del equipo.

## Scripts disponibles

| Script | Descripción |
|---|---|
| `npm run dev` | Levanta el servidor de desarrollo (`next dev`). |
| `npm run build` | Compila la app para producción (`next build`). |
| `npm run start` | Sirve el build de producción (`next start`). |
| `npm run lint` | Corre ESLint sobre el proyecto. |

## Estructura del proyecto

```
src/app/               # Rutas (App Router): tableros, /admin/*, /api/*
src/components/        # Componentes de UI (Board, TaskModal, modales de admin...)
src/context/           # BoardContext: estado global y toda la capa de datos
src/lib/supabase/      # Clientes de Supabase y repos por dominio (tasks, roles,
                        # automatizaciones, integraciones, mcp, métricas...)
src/hooks/             # Hooks (presencia en tiempo real, accesibilidad de diálogos)
supabase/migrations/   # Historial versionado de cambios de esquema
OBSERVABILITY.md       # Estado real de monitoreo/alertas
```

## Repositorio

TaskFlow es, desde 2026-08-26, su **propio repositorio git independiente**
(`github.com/xaviercabrerau/taskflow-kanban-prototype`), separado del resto
de proyectos que viven en la misma carpeta local (`~/Claude/`). Antes vivía
mezclado con el historial de otros proyectos dentro de un monorepo cuyo
`.git` raíz se perdió por agotamiento de espacio en disco; el historial de
este repo se reinició en el commit `a5c583f` (2026-08-26) a partir del
estado íntegro y verificado del working tree en ese momento — no contiene
commits previos a esa fecha. No existe actualmente un pipeline de CI
(`.github/workflows/`) en este repositorio; type-check, lint y tests se
corren manualmente (ver scripts abajo) antes de cada push.

Vercel despliega automáticamente desde la rama `main` de ese repositorio
mediante su integración nativa con GitHub.

## Migraciones de base de datos

El proyecto remoto de Supabase (`txdyijyswpsalqnwfopc`) se gestiona mediante
migraciones versionadas en `supabase/migrations/`. Reglas obligatorias a
partir de ahora:

1. **Los 62 archivos base ya existentes en `supabase/migrations/` representan
   el historial de cambios que ya fueron aplicados directamente contra el
   proyecto remoto** (antes de que existiera este registro local). No hay
   que volver a ejecutarlos ni modificarlos: son solo el registro histórico
   reconstruido para que `supabase db push` funcione correctamente de aquí
   en adelante.

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

## Estado reciente (2026-08-26)

- Se corrigió un crash de `/dashboard` ("Maximum update depth exceeded"):
  `useSyncExternalStore` leía `Date.now()` como snapshot, un valor nunca
  estable entre llamadas, provocando un loop infinito de renders. Ver
  [`src/components/DashboardView.tsx`](./src/components/DashboardView.tsx).
- Se eliminaron 14 archivos (`src/app/api/analytics/`, `src/app/api/cron/`,
  `src/jobs/`, `src/dashboards/`, `src/lib/logger.ts`) que resultaron ser de
  un sistema de analítica de ventas/inventario ajeno a TaskFlow, mezclado en
  este directorio por el incidente de monorepo descrito arriba. Ninguno
  compilaba ni tenía referencias desde código legítimo de TaskFlow.
- `tsc --noEmit`, `eslint` y la suite de Jest (285/285 tests) están en
  verde.

## Más información

- [`OBSERVABILITY.md`](./OBSERVABILITY.md) — detalle exacto de qué monitoreo
  y alertas están activos hoy y qué le falta a cada pieza (Sentry, Upstash,
  cron de alertas).
- `PLAN_PRODUCCION_TASKFLOW.md` — estado de preparación para producción
  (documento externo a este repo, en `~/Claude/`).
- [`TERMS_OF_SERVICE.md`](./TERMS_OF_SERVICE.md) y
  [`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md) — estado legal del producto.
