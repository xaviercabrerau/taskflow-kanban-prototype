# TaskFlow Kanban — Documentación del proyecto

**Producción:** https://task.conto.ec
**Stack:** Next.js 16 (App Router) · Supabase (Postgres/Auth/RLS/Storage/pg_cron/pg_net) · Vercel · Upstash Redis · Sentry · Resend
**Última actualización:** 2026-08-31

> Este documento describe **qué hace la plataforma hoy**: páginas, API, integraciones, modelo de permisos, notificaciones, esquema de base de datos, multi-tenancy, automatizaciones, panel de administración y observabilidad. Para el historial de bugs corregidos y hallazgos de seguridad, ver [AUDITORIA_COMPLETA_2026-08-28.md](AUDITORIA_COMPLETA_2026-08-28.md).

---

## 1. Páginas de la aplicación

| Ruta | Archivo | Qué hace |
|---|---|---|
| `/` | `src/app/page.tsx` | Tablero Kanban principal (arrastrar y soltar entre columnas) |
| `/tabla` | `src/app/tabla/page.tsx` | Vista de lista/tabla de todas las tareas |
| `/gantt` | `src/app/gantt/page.tsx` | Vista Gantt/línea de tiempo por fecha de inicio/vencimiento |
| `/calendario` | `src/app/calendario/page.tsx` | Vista calendario por fecha de vencimiento |
| `/dashboard` | `src/app/dashboard/page.tsx` | Panel de métricas / BI |
| `/login` | `src/app/login/page.tsx` | Inicio de sesión, registro, recuperación de contraseña, entrada a SSO empresarial |
| `/reset-password` | `src/app/reset-password/page.tsx` | Definir nueva contraseña tras el link de recuperación |
| `/admin/*` | `src/app/admin/**` | Panel de administración (ver sección 10) |

## 2. API (`src/app/api/`)

| Endpoint | Propósito | Autenticación |
|---|---|---|
| `GET /api/health` | Chequeo de salud (conectividad a Supabase) | Público |
| `GET /api/health/cron` | Estado de los jobs de pg_cron | Reenvía header si existe; la RPC subyacente también es accesible por `anon` |
| `POST /api/mcp` | Servidor MCP (JSON-RPC 2.0) — expone el tablero como herramientas a Claude | Bearer `tfmcp_<hex>`; rate limit 30 req/min por token |
| `POST /api/tasks/[id]/forward-email` | Reenvía el resumen de una tarea por email desde el Gmail conectado de la org | Cookie de sesión; rate limit por usuario |
| `POST /api/tasks/[id]/drive-attachment` | Adjunta archivo(s) de Google Drive a una tarea (link único o batch del Picker, máx. 25) | Cookie de sesión; rate limit por usuario |
| `GET /api/integrations/google/connect` | Redirige al owner de la org al consentimiento OAuth de Google | Cookie de sesión; requiere `org_role = owner` |
| `GET /api/integrations/google/callback` | Intercambia el código OAuth por tokens, los guarda vía `upsert_integration` | Cookie de sesión + `state` firmado |
| `POST /api/internal/notify-event` | Dispara una notificación (llamado por triggers de Postgres vía `pg_net`) | Secreto compartido `x-internal-secret` |
| `POST /api/internal/sync-calendar-event` | Sincroniza el vencimiento de una tarea a Google Calendar (llamado por trigger) | Secreto compartido |
| `GET /api/admin/users`, `GET /api/admin/users/[id]` | Lista/lee miembros de la org | Cookie de sesión, membresía de org |
| `POST /api/admin/create-user` | Crea un usuario nuevo en Supabase Auth y lo añade a la org | Cookie de sesión + `SUPABASE_SERVICE_ROLE_KEY` |
| `POST /api/admin/link-existing-user` | Vincula un email ya existente en Auth a la org | Cookie de sesión + service role |
| `POST /api/admin/reset-password` | Restablece la contraseña de un miembro | Cookie de sesión; requiere `org_role = owner`; service role |
| `GET/PUT /api/admin/notification-preferences` | Lee/actualiza preferencias de notificación por evento/canal | Cookie de sesión |
| `POST /api/cron/alert-check` | Job programado que revisa salud y avisa por Slack/Discord si falla | Bearer/`?secret=` con `CRON_SECRET` |
| `POST /api/gmail-webhook`, `POST /api/webhooks/gmail-reply` | Recepción de respuestas de email a tareas (marcar hecho, comentar, cambiar estado) | **No implementado** — devuelven 501, pendiente de verificación JWT de Pub/Sub |

## 3. Funcionalidades del tablero

- **Tareas** — CRUD completo, indexación fraccional para reordenar sin renumerar toda la columna.
- **Columnas** — configurables por tablero (etiqueta, color, orden, marca de "estado terminado").
- **Arrastrar y soltar** entre y dentro de columnas.
- **Checklists** por tarea (ítems con orden y estado).
- **Comentarios con @menciones** — hilos, notifican a los mencionados.
- **Etiquetas (tags)** — catálogo por organización.
- **Adjuntos** — subida directa (Supabase Storage, URLs firmadas de 60s) o vía Google Drive (link o Picker nativo con selección múltiple).
- **Búsqueda y filtro** — por título y por responsable (del lado del cliente).
- **Responsables** — campo simple de texto más soporte de múltiples responsables (`task_assignees`).
- **Prioridades** — `low | medium | high | urgent`.
- **Fechas** — inicio/vencimiento, alimentan Gantt, Calendario, recordatorios "por vencer" y automatizaciones.
- **Registro de actividad** — feed de solo-lectura por tarea (creación, cambios de estado, asignación, campos editados).

## 4. Integraciones de terceros

| Proveedor | Función | Estado |
|---|---|---|
| **Google Workspace** | Calendar (sync de vencimientos), Drive (adjuntar por link o Picker), Gmail (reenvío de tareas) | ✅ Funcionando |
| **Gmail inbound** | Responder por email para marcar tareas como hechas/comentar | ⛔ Deshabilitado (endpoints devuelven 501) |
| **Slack / Teams / Zoom / n8n** | Notificaciones salientes vía webhook | ⚠️ Solo configuración guardada — sin código que efectivamente publique, salvo Slack/Discord en el cron de alertas |
| **OpenAI / Anthropic / GitHub** | Guardan una API key | ⛔ No conectados — ningún código las consume aún |
| **Resend** | Envío de emails transaccionales de notificación | ✅ Funcionando (dominio de envío pendiente de verificar en producción — ver auditoría) |
| **MCP (Model Context Protocol)** | Expone el tablero como herramientas (`list_tasks`, `create_task`, `move_task`, `add_comment`) a Claude Desktop/Code/Chat/Cowork vía tokens `tfmcp_...` | ✅ Funcionando, verificado en vivo |
| **Webhooks entrantes** | URL tokenizada por columna/tablero que crea tareas | ✅ Funcionando |
| **Webhooks salientes** | Acción "webhook" de las automatizaciones | ✅ Funcionando |
| **SSO empresarial** | Inicio de sesión SAML por dominio | ✅ Funcionando (vía Supabase Auth) |

## 5. Permisos y roles (RBAC)

- **Rol de organización**: `owner | admin | member` (`organization_members.org_role`) — separado de los permisos finos.
- **Roles personalizados**: `roles` (del sistema o por organización) + `permissions` (catálogo global) + `role_permissions` + `role_assignments` (hoy siempre con `scope_type = "board"`).
- **`has_permission(board_id, perm_key)`**: función usada tanto en políticas RLS como en el código de notificaciones (los owners de la org reciben todo, vía bypass).
- **MFA/AAL2 en dos capas**: `MfaAalGate` exige el segundo factor si el usuario ya lo tiene inscrito; `MfaGate` fuerza la inscripción si la organización requiere MFA y el usuario no tiene ningún factor.
- **Cambio de contraseña forzado**: para cuentas creadas o reseteadas por un admin.

## 6. Sistema de notificaciones

- **Eventos**: `task_assigned`, `task_mentioned`, `status_changed`, `due_soon`, `comment_added`, `project_created`, `member_invited`, `task_completed`.
- **Canales**: email (Gmail/Resend) e in-app (`notifications`, campanita).
- **Preferencias**: por usuario, por organización, por tipo de evento, por canal.
- **Flujo**: trigger de Postgres → `pg_net.http_post` → `/api/internal/notify-event` (secreto compartido) → revisa preferencias → escribe notificación in-app y/o envía email con plantilla.
- **Fallos**: registrados en `failed_jobs` para diagnóstico/reintento.
- **"Por vencer"**: job horario de pg_cron detecta vencimientos próximos.

## 7. Esquema de base de datos (`public`, proyecto `txdyijyswpsalqnwfopc`)

Todas las tablas tienen **RLS habilitado**.

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
| `comments` | Comentarios con hilos y menciones |
| `attachments` | Archivos subidos o vinculados desde Drive |
| `activity_log`, `audit_log` | Feed de actividad y auditoría de seguridad |
| `notifications`, `notification_preferences` | Notificaciones in-app y preferencias |
| `automation_rules`, `automation_executions` | Automatizaciones y su historial |
| `integrations` | Configuración de proveedores externos |
| `webhooks_inbound`, `webhooks_outbound` | Webhooks entrantes/salientes |
| `mcp_sessions` | Tokens de acceso MCP |
| `metrics_snapshots` | Snapshots diarios de BI |
| `checklists`, `checklist_items` | Checklists por tarea |
| `email_threads` | Seguimiento de hilos Gmail (aún sin usar — pendiente de `gmail_inbound`) |
| `failed_jobs` | Auditoría de fallos de notificación/jobs |

## 8. Modelo multi-tenant

```
Organización → Workspace(s) → Tablero(s) → Columnas → Tareas
```

- `organizations` es la frontera de tenant; toda tabla con `tenant_id` está protegida por `is_org_member()`/`is_org_owner()` en RLS.
- El primer login crea automáticamente (idempotente, vía `create_organization`): una organización, un workspace "General", un tablero "Prototipo Kanban", columnas y tareas semilla.
- Hoy cada workspace tiene exactamente un tablero (invariante del prototipo, no una limitación técnica del esquema).

## 9. Automatizaciones

- **Disparadores**: tarea creada, cambio de estado (opcionalmente a una columna específica), vencimiento próximo.
- **Condiciones**: campo (prioridad/tag/responsable/título) + operador (igual/distinto/contiene) + valor.
- **Acciones**: mover de columna, cambiar un campo, agregar comentario, o llamar un webhook.
- Las automatizaciones por vencimiento corren en el job horario de pg_cron.

## 10. Panel de administración (`/admin/*`)

| Sección | Qué gestiona |
|---|---|
| Usuarios | Alta, reseteo de contraseña, vínculo de cuentas existentes |
| Roles | Roles personalizados y sus permisos |
| Workspaces | Administración de workspaces |
| Integraciones | Los 10 proveedores de la sección 4 |
| Seguridad | MFA obligatorio y configuración de SSO |
| Auditoría | Exportación del log de auditoría |
| Plantillas | Marketplace de plantillas de tablero |
| Reportes | Dashboards de BI (`metrics_snapshots`) |
| API Keys | Emisión/revocación de tokens MCP |
| Automatizaciones | Reglas de automatización |

## 11. Observabilidad

- **Sentry** configurado para cliente, servidor y edge (`sentry.*.config.ts`) — captura errores de `/api/mcp` explícitamente.
- **Rate limiting** — Upstash Redis (ventana deslizante), protege `/api/mcp`, `/api/tasks/[id]/forward-email` y `/api/tasks/[id]/drive-attachment`; fallback en memoria si Redis no responde (nunca abre sin protección).
- **Cron jobs (pg_cron)**: revisión de vencimientos y automatizaciones (cada hora), purga de auditoría y snapshot de métricas (diarios).
- **Cron de alertas (Vercel)**: `/api/cron/alert-check` diario, revisa salud de la app y de los cron jobs, avisa por Slack/Discord si algo falla.
- **Health checks**: `/api/health` (conectividad a Supabase) y `/api/health/cron` (estado de los jobs).

---

*Para el estado de seguridad, hallazgos, y qué está pendiente de configuración (Sentry, alertas, Drive Picker) ver [AUDITORIA_COMPLETA_2026-08-28.md](AUDITORIA_COMPLETA_2026-08-28.md).*
