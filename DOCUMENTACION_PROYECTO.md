# TaskFlow Kanban — Documentación del proyecto

**Producción:** https://task.conto.ec
**Stack:** Next.js 16 (App Router) · Supabase (Postgres/Auth/RLS/Storage/pg_cron/pg_net/Vault) · Vercel · Upstash Redis · Sentry · Resend
**Última actualización:** 2026-09-03

> Este documento describe **qué hace la plataforma hoy**: páginas, API, integraciones, modelo de permisos, notificaciones, esquema de base de datos, multi-tenancy, automatizaciones, panel de administración y observabilidad. Para el historial de seguridad, ver [AUDITORIA_COMPLETA_2026-08-28.md](AUDITORIA_COMPLETA_2026-08-28.md) y [AUDITORIA_2026-09-03.md](AUDITORIA_2026-09-03.md) (17 hallazgos, los 17 resueltos). Para el roadmap de funcionalidades y su estado, ver [ROADMAP_FUNCIONALIDADES.md](ROADMAP_FUNCIONALIDADES.md).

---

## 1. Páginas de la aplicación

| Ruta | Archivo | Qué hace |
|---|---|---|
| `/` | `src/app/page.tsx` | Tablero Kanban principal (arrastrar y soltar entre columnas), command palette (⌘K), acciones en lote, vistas guardadas |
| `/tabla` | `src/app/tabla/page.tsx` | Vista de lista/tabla de todas las tareas |
| `/gantt` | `src/app/gantt/page.tsx` | Vista Gantt/línea de tiempo por fecha de inicio/vencimiento |
| `/calendario` | `src/app/calendario/page.tsx` | Vista calendario por fecha de vencimiento |
| `/dashboard` | `src/app/dashboard/page.tsx` | Panel de métricas / BI |
| `/login` | `src/app/login/page.tsx` | Inicio de sesión, registro, recuperación de contraseña, entrada a SSO empresarial |
| `/reset-password` | `src/app/reset-password/page.tsx` | Definir nueva contraseña tras el link de recuperación |
| `/share/[token]` | `src/app/share/[token]/page.tsx` | **Vista pública** de una tarea o tablero compartido — solo lectura o con comentarios de invitado, sin cuenta de TaskFlow. Exenta de autenticación (`src/proxy.ts`) |
| `/admin/*` | `src/app/admin/**` | Panel de administración (ver sección 10) |

## 2. API (`src/app/api/`)

### Autenticadas (sesión de usuario)

| Endpoint | Propósito |
|---|---|
| `POST /api/mcp` | Servidor MCP (JSON-RPC 2.0) — expone el tablero como herramientas a Claude. Bearer `tfmcp_<hex>`, rate limit 30 req/min por token |
| `GET/POST /api/v1/tasks`, `POST /api/v1/tasks/[id]/move`, `POST /api/v1/tasks/[id]/comments` | **API pública REST** — misma autenticación/tokens que MCP, expuesta como REST plano. Documentada en `/admin/api-docs` |
| `POST /api/tasks/[id]/forward-email` | Reenvía el resumen de una tarea por email desde el Gmail conectado de la org |
| `POST /api/tasks/[id]/drive-attachment` | Adjunta archivo(s) de Google Drive a una tarea (link único o batch del Picker, máx. 25) |
| `POST /api/tasks/[id]/schedule-meeting` | Agenda una reunión de Google Meet para una tarea, invita a responsables + emails extra (clientes) |
| `POST /api/tasks/[id]/github-link` | Vincula un issue/PR de GitHub a una tarea (requiere PAT configurado en Integraciones) |
| `POST /api/tasks/[id]/summarize-comments` | Resume el hilo de comentarios con IA (requiere API key de OpenAI/Anthropic en Integraciones) |
| `POST /api/tasks/parse-natural-language` | Convierte texto libre en título/prioridad/fecha con IA (mismo requisito de credencial) |
| `GET/POST /api/share-links`, `DELETE /api/share-links/[id]` | Crea/lista/revoca links públicos compartibles de una tarea o tablero |
| `GET /api/integrations/google/connect`, `GET /api/integrations/google/callback` | OAuth de Google (Calendar/Drive/Gmail) — solo owner de la org |
| `GET /api/admin/users`, `GET /api/admin/users/[id]` | Lista/lee miembros de la org |
| `POST /api/admin/create-user`, `POST /api/admin/link-existing-user`, `POST /api/admin/reset-password` | Gestión de cuentas — requieren `org_role = owner` + service role |
| `GET/PUT /api/admin/notification-preferences` | Preferencias de notificación por evento/canal |

### Públicas / sin sesión

| Endpoint | Propósito | Auth |
|---|---|---|
| `GET /api/health` | Chequeo de salud (conectividad a Supabase) | Público |
| `GET /api/health/cron` | Estado de los jobs de pg_cron (6 jobs monitoreados, ver `src/lib/cron-jobs.ts`) | Público (dato de baja sensibilidad) |
| `GET /api/public/share/[token]` | Resuelve un link público — título/descripción/comentarios de invitados de una tarea, o resumen de un tablero | Token en la URL (validado server-side, hasheado en DB) |
| `POST /api/public/share/[token]/comment` | Comenta como invitado (solo links `scope=task` + `permission=comment`) | Token en la URL |
| `GET /sw.js` | Service worker de la PWA (ruta dinámica, no archivo estático — `CACHE_NAME` incluye el commit SHA del deploy) | Público |
| `POST /api/internal/notify-event`, `POST /api/internal/sync-calendar-event` | Disparados por triggers de Postgres vía `pg_net` | Secreto compartido |
| `POST /api/cron/alert-check` | Job programado (1x/día — el plan Hobby de Vercel no permite cron más frecuente) que revisa salud y avisa por webhook si algo falla | `CRON_SECRET` |
| `POST /api/gmail-webhook`, `POST /api/webhooks/gmail-reply` | Recepción de respuestas de email a tareas | **No implementado** — devuelven 501, pendiente de verificación JWT de Pub/Sub |

## 3. Funcionalidades del tablero

- **Tareas** — CRUD completo, indexación fraccional para reordenar, límite de 300 caracteres en el título (defensa en profundidad además del límite de la API).
- **Subtareas** (`parent_task_id`) — tareas hijas de nivel superior, visibles en el modal de la tarea padre.
- **Dependencias** (`task_links`) — "bloqueada por / bloquea" con aviso visual cuando hay bloqueos sin resolver.
- **Épicas y Sprints** — agrupación de tareas con barra de progreso, gestionadas desde `/admin/planificacion`.
- **Columnas** — configurables por tablero (etiqueta, color, orden, marca de "estado terminado").
- **Arrastrar y soltar** entre y dentro de columnas.
- **Acciones en lote** — seleccionar varias tareas (Cmd/Ctrl+click) y mover/etiquetar/asignar/eliminar en conjunto.
- **Vistas guardadas / filtros personalizados** (`saved_views`) — por usuario, no compartidas entre miembros.
- **Command palette (⌘K)** — buscar/crear/navegar sin mouse; usa `search_workspace()` para búsqueda global (tareas, comentarios, adjuntos).
- **Checklists** por tarea (ítems con orden y estado).
- **Comentarios con @menciones** — hilos, notifican a los mencionados; comentarios de invitados (vía link público) marcados con `source='guest'`.
- **Resumen de comentarios con IA** — botón "✨ Resumir con IA" (requiere credencial configurada).
- **Crear tarea con IA** — campo "✨ Crear con IA" en el modal de creación, interpreta texto libre en título/prioridad/fecha (requiere credencial configurada).
- **Etiquetas (tags)** — catálogo por organización.
- **Campos personalizados** (`custom_field_definitions`) — administrables desde `/admin/campos-personalizados`.
- **Adjuntos** — subida directa (Supabase Storage, URLs firmadas de 60s) o vía Google Drive (link o Picker nativo con selección múltiple).
- **Vincular GitHub** — issues/PRs vinculados a una tarea con título/estado sincronizado (requiere PAT configurado).
- **Compartir** — generar un link público de solo lectura (tarea o tablero) o de "invitado" (puede comentar), revocable en cualquier momento. Exige verificación MFA/AAL2 del creador si la organización la requiere.
- **Time tracking** — cronómetro iniciar/parar por tarea o registro manual de minutos.
- **Reunión de Google Meet** — botón "Agendar reunión" en el modal de tarea, invita a responsables + emails extra (clientes).
- **Búsqueda y filtro** — global (command palette) y del lado del cliente (título/responsable/prioridad/tag).
- **Responsables** — campo de texto simple más soporte de múltiples responsables (`task_assignees`).
- **Prioridades** — `low | medium | high | urgent`.
- **Fechas** — inicio/vencimiento, alimentan Gantt, Calendario, recordatorios "por vencer" y automatizaciones.
- **Tareas recurrentes** (`recurring_task_templates`) — plantillas diaria/semanal/mensual gestionadas desde `/admin/tareas-recurrentes`; para semanal/mensual se puede anclar a un día de la semana o del mes específico (`day_of_week`/`day_of_month`), respetado tanto en la primera ejecución como en las siguientes.
- **Registro de actividad** — feed de solo-lectura por tarea (creación, cambios de estado, asignación, campos editados).

## 4. Integraciones de terceros

| Proveedor | Función | Estado |
|---|---|---|
| **Google Workspace** | Calendar (sync de vencimientos), Drive (adjuntar por link o Picker), Gmail (reenvío de tareas), Meet (agendar reuniones) | ✅ Funcionando |
| **Gmail inbound** | Responder por email para marcar tareas como hechas/comentar | ⛔ Deshabilitado (endpoints devuelven 501) |
| **Slack / Teams** | Notificaciones **salientes** (relay automático de eventos de notificación a un webhook entrante configurado) | ✅ Funcionando (saliente); **no** hay slash commands ni recepción de mensajes — eso requeriría una Slack App + signing secret que no se ha configurado |
| **Zoom / n8n** | Guardan configuración | ⛔ Sin código que la use |
| **OpenAI / Anthropic** | Crear tareas por lenguaje natural + resumen de comentarios | ✅ Código funcional, **inactivo** hasta que la org agregue una API key en Integraciones |
| **GitHub** | Vincular issues/PRs a tareas (Personal Access Token) | ✅ Código funcional, **inactivo** hasta que la org agregue un token en Integraciones |
| **Resend** | Envío de emails transaccionales de notificación | ✅ Funcionando, dominio verificado |
| **MCP (Model Context Protocol)** | Expone el tablero como herramientas (`list_tasks`, `create_task`, `move_task`, `add_comment`) a Claude Desktop/Code/Chat/Cowork vía tokens `tfmcp_...` | ✅ Funcionando, verificado en vivo |
| **API pública REST** | Envoltura REST sobre las mismas herramientas MCP, para integraciones que no hablan JSON-RPC | ✅ Funcionando, documentada en `/admin/api-docs` |
| **Webhooks entrantes** | URL tokenizada por columna/tablero que crea tareas | ✅ Funcionando |
| **Webhooks salientes** | Acción "webhook" de las automatizaciones | ✅ Funcionando |
| **SSO empresarial** | Inicio de sesión SAML por dominio | ✅ Funcionando (vía Supabase Auth) |
| **PWA instalable** | Manifest + service worker (network-first, nunca cachea `/api/*`) | ✅ Funcionando |

## 5. Permisos y roles (RBAC)

- **Rol de organización**: `owner | admin | member` (`organization_members.org_role`) — separado de los permisos finos.
- **Roles personalizados**: `roles` (del sistema o por organización) + `permissions` (catálogo global) + `role_permissions` + `role_assignments` (hoy siempre con `scope_type = "board"`).
- **`has_permission(board_id, perm_key)`**: función usada tanto en políticas RLS como en el código de notificaciones (los owners de la org reciben todo, vía bypass).
- **MFA/AAL2 en dos capas**: `MfaAalGate` exige el segundo factor si el usuario ya lo tiene inscrito; `MfaGate` fuerza la inscripción si la organización requiere MFA y el usuario no tiene ningún factor. `session_meets_mfa(tenant_id)` se exige en RLS en **toda** tabla con datos de tarea/tablero, incluidas las agregadas en septiembre (`public_share_links`, `recurring_task_templates`, `task_github_links`) — ver auditoría del 2026-09-03.
- **Acceso de invitado/cliente**: no es un rol de organización — se implementa vía `public_share_links` con `permission='comment'`: un visitante externo puede ver una tarea y comentar sin cuenta, sin acceso a nada más del tablero.
- **Cambio de contraseña forzado**: para cuentas creadas o reseteadas por un admin.

## 6. Sistema de notificaciones

- **Eventos**: `task_assigned`, `task_mentioned`, `status_changed`, `due_soon`, `comment_added`, `project_created`, `member_invited`, `task_completed`.
- **Canales**: email (Gmail/Resend), in-app (`notifications`, campanita), y relay saliente a Slack/Teams si la org tiene un webhook configurado.
- **Preferencias**: por usuario, por organización, por tipo de evento, por canal.
- **Flujo**: trigger de Postgres → `pg_net.http_post` → `/api/internal/notify-event` (secreto compartido) → revisa preferencias → escribe notificación in-app, envía email con plantilla, y/o publica en Slack/Teams.
- **Fallos**: registrados en `failed_jobs` para diagnóstico/reintento.
- **"Por vencer"**: job horario de pg_cron detecta vencimientos próximos.

## 7. Esquema de base de datos (`public`, proyecto `txdyijyswpsalqnwfopc`)

Todas las tablas tienen **RLS habilitado**; las que contienen datos de tarea/tablero exigen además `session_meets_mfa(tenant_id)`.

| Tabla | Propósito |
|---|---|
| `organizations` | Raíz de cada tenant |
| `profiles` | Espejo de `auth.users` (email, nombre) |
| `organization_members` | Membresía + rol de organización |
| `roles`, `permissions`, `role_permissions`, `role_assignments` | RBAC |
| `board_templates`, `template_installs` | Marketplace de plantillas de tablero |
| `workspaces`, `boards`, `board_columns` | Jerarquía de tableros |
| `custom_field_definitions` | Campos personalizados por tablero/org |
| `epics`, `sprints` | Agrupación de tareas |
| `tasks`, `task_assignees`, `tags`, `task_tags`, `task_links` | Núcleo de tareas y relaciones |
| `comments` | Comentarios con hilos, menciones y comentarios de invitado (`source='guest'`) |
| `attachments` | Archivos subidos o vinculados desde Drive |
| `activity_log`, `audit_log` | Feed de actividad y auditoría de seguridad |
| `notifications`, `notification_preferences` | Notificaciones in-app y preferencias |
| `automation_rules`, `automation_executions` | Automatizaciones y su historial |
| `integrations` | Configuración de proveedores externos (secretos en Supabase Vault) |
| `webhooks_inbound`, `webhooks_outbound` | Webhooks entrantes/salientes |
| `mcp_sessions` | Tokens de acceso MCP/API pública (`tfmcp_...`) |
| `metrics_snapshots` | Snapshots diarios de BI |
| `checklists`, `checklist_items` | Checklists por tarea |
| `saved_views` | Vistas/filtros guardados, por usuario |
| `time_entries` | Registro de tiempo (cronómetro o manual) por tarea |
| `public_share_links` | Links públicos compartibles (tarea o tablero), token hasheado |
| `recurring_task_templates` | Plantillas de tareas recurrentes (diaria/semanal/mensual, con anclaje a día) |
| `task_github_links` | Issues/PRs de GitHub vinculados a una tarea |
| `email_threads` | Seguimiento de hilos Gmail (aún sin usar — pendiente de `gmail_inbound`) |
| `failed_jobs` | Auditoría de fallos de notificación/jobs |

**Accesores de credenciales server-only** (Vault, revocados de `anon`/`authenticated`, solo alcanzables con la service-role key): `get_google_refresh_token`, `get_ai_credential`, `get_github_token`.

## 8. Modelo multi-tenant

```
Organización → Workspace(s) → Tablero(s) → Columnas → Tareas
```

- `organizations` es la frontera de tenant; toda tabla con `tenant_id` está protegida por `is_org_member()`/`is_org_owner()` (+ `session_meets_mfa()` donde aplica) en RLS.
- El primer login crea automáticamente (idempotente, vía `create_organization`): una organización, un workspace "General", un tablero "Prototipo Kanban", columnas y tareas semilla.
- Hoy cada workspace tiene exactamente un tablero (invariante del prototipo, no una limitación técnica del esquema).

## 9. Automatizaciones

- **Disparadores**: tarea creada, cambio de estado (opcionalmente a una columna específica), vencimiento próximo, tarea estancada en una columna no-terminal por más de N horas (`sla_stale`).
- **Condiciones**: campo (prioridad/tag/responsable/título) + operador (igual/distinto/contiene) + valor.
- **Acciones**: mover de columna, cambiar un campo, agregar comentario, o llamar un webhook (con guard anti-SSRF `is_safe_webhook_url`).
- **pg_cron** (6 jobs, escalonados en distintos minutos de cada hora para evitar colisiones, cada uno con `pg_try_advisory_xact_lock` contra solapamiento):
  - `taskflow_check_due_soon_tasks` (:00) — recordatorios de vencimiento.
  - `taskflow_execute_due_date_automations` (:05).
  - `taskflow_execute_sla_automations` (:15).
  - `taskflow_execute_recurring_tasks` (:25) — crea las tareas de `recurring_task_templates` que correspondan.
  - `purge-expired-audit-logs`, `record-daily-metrics-snapshots` (diarios, 03:00/03:10).
- Estado de los 6 jobs monitoreado en `/admin/auditoria` y `/api/health/cron` (fuente única: `src/lib/cron-jobs.ts`).

## 10. Panel de administración (`/admin/*`)

| Sección | Qué gestiona |
|---|---|
| Usuarios | Alta, reseteo de contraseña, vínculo de cuentas existentes |
| Roles | Roles personalizados y sus permisos |
| Workspaces | Administración de workspaces |
| Épicas y Sprints | Agrupación de tareas con progreso |
| Tareas recurrentes | Plantillas diaria/semanal/mensual, con anclaje a día |
| Campos personalizados | Definición de campos por tablero/org |
| Carga de trabajo | Tareas abiertas y horas registradas por persona |
| Portafolio | Progreso consolidado de todos los tableros visibles |
| Integraciones | Los proveedores de la sección 4 |
| Seguridad | MFA obligatorio y configuración de SSO |
| Auditoría | Exportación del log de auditoría, salud de cron jobs |
| Plantillas | Marketplace de plantillas de tablero |
| Reportes | Dashboards de BI (`metrics_snapshots`) |
| API Keys | Emisión/revocación de tokens MCP/API pública |
| API pública | Documentación REST con ejemplos curl |
| Automatizaciones | Reglas de automatización |

## 11. Observabilidad

- **Sentry** configurado para cliente, servidor y edge (`sentry.*.config.ts`) — captura errores de `/api/mcp` explícitamente.
- **Rate limiting** — Upstash Redis (ventana deslizante), protege `/api/mcp`, `/api/v1/*`, `/api/tasks/[id]/forward-email`, `/api/tasks/[id]/drive-attachment`, `/api/share-links`, `/api/public/share/*` y las rutas de IA/GitHub; fallback en memoria si Redis no responde (nunca abre sin protección).
- **Cron jobs (pg_cron)**: 6 jobs, ver sección 9. Todos monitoreados desde una única fuente de verdad (`src/lib/cron-jobs.ts`), tras corregir un hallazgo de la auditoría de septiembre donde un job nuevo quedó invisible al sistema de monitoreo.
- **Cron de alertas (Vercel)**: `/api/cron/alert-check`, revisa salud de la app y de los cron jobs, avisa por webhook si algo falla. Corre 1x/día — el plan **Hobby** de Vercel no permite mayor frecuencia (se intentó subir a cada 6h y el deploy lo rechazó); requiere plan Pro o un monitor externo para mayor frecuencia.
- **Health checks**: `/api/health` (conectividad a Supabase) y `/api/health/cron` (estado de los 6 jobs).
- **Service worker**: `CACHE_NAME` incluye el commit SHA del deploy (`src/app/sw.js/route.ts`), purga el cache viejo en cada deploy real.

---

*Para el estado de seguridad y hallazgos resueltos, ver [AUDITORIA_COMPLETA_2026-08-28.md](AUDITORIA_COMPLETA_2026-08-28.md) y [AUDITORIA_2026-09-03.md](AUDITORIA_2026-09-03.md). Para el roadmap de funcionalidades y qué se implementó de cada ítem, ver [ROADMAP_FUNCIONALIDADES.md](ROADMAP_FUNCIONALIDADES.md).*
