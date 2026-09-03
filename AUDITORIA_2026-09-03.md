# Auditoría TaskFlow — 2026-09-03

Auditoría de calidad, seguridad, base de datos y performance/DevOps sobre el estado actual del proyecto, con foco en todo lo construido desde la auditoría anterior (`AUDITORIA_COMPLETA_2026-08-28.md`): relay Slack/Teams, épicas/sprints, vistas guardadas, acciones en lote, command palette, time tracking, workload/portafolio, acceso de invitado + links públicos compartibles, tareas recurrentes, API pública REST, PWA, y el andamiaje de IA/GitHub.

**Metodología:** 4 auditorías especializadas ejecutadas en paralelo (seguridad, base de datos/esquema, calidad de código TypeScript/React, performance/DevOps), cada una con instrucciones de no repetir hallazgos ya corregidos en la auditoría de agosto y de verificar antes de reportar. Dos de ellas (seguridad y base de datos), trabajando de forma independiente y sin verse entre sí, llegaron **al mismo hallazgo crítico** por caminos distintos — eso le da alta confianza a ese hallazgo en particular.

---

## Resumen ejecutivo

| # | Hallazgo | Severidad | Área | Esfuerzo |
|---|---|---|---|---|
| 1 | `public_share_links`, `recurring_task_templates`, `task_github_links` y la RPC `create_share_link` no exigen verificación MFA/AAL2 — bypassea el control ya establecido en el resto del esquema | 🔴 Crítico | Seguridad + BD | Bajo |
| 2 | `execute_recurring_tasks()` sin lock contra solapamiento del propio cron → riesgo de tareas duplicadas | 🔴 Crítico | BD | Bajo |
| 3 | El cron `taskflow_execute_recurring_tasks` quedó fuera del sistema de monitoreo en 3 lugares distintos | 🔴 Crítico | DevOps + BD | Bajo |
| 4 | 4 cron jobs horarios programados en el mismo minuto exacto → riesgo de colisión de filas | 🟠 Alto | BD | Bajo |
| 5 | Sin límite de longitud en título/comentario vía `mcp_create_task`/`mcp_add_comment` (ni en la UI) | 🟠 Alto | Seguridad + DevOps | Bajo |
| 6 | Alerta de cron corre 1x/día — ventana de detección de hasta 24h con 6 jobs activos | 🟠 Alto | DevOps | Bajo |
| 7 | `resolve_share_link` expone el hilo completo de comentarios internos del equipo, no solo los de invitados | 🟡 Medio | Seguridad | Bajo |
| 8 | `execute_recurring_tasks()` ignora `day_of_week`/`day_of_month` — bug funcional, no coincide con lo que la UI promete | 🟡 Medio | BD | Medio |
| 9 | `comments.source = 'guest'` puede ser falsificado por un miembro autenticado (falta `with check`) | 🟡 Medio | Seguridad | Bajo |
| 10 | `TaskModal.tsx` (2085 líneas) dispara 10 fetches en paralelo al abrir, incluso para secciones poco usadas | 🟡 Medio | Código | Medio |
| 11 | `BoardContext.tsx`: un solo `value` memoizado con todo el estado → re-render de toda la app en cada toast/drag | 🟡 Medio | Código | Alto |
| 12 | Falta índice en `recurring_task_templates(board_id)`, usado directamente por la app | 🟢 Bajo | BD | Trivial |
| 13 | 3 paneles embebidos (Recurring/Portfolio/Workload) duplican el mismo wrapper modal/embedded y export CSV/PDF | 🟢 Bajo | Código | Medio |
| 14 | Mensajes de error crudos de Postgres filtrados en algunas rutas nuevas (`insertError.message` sin sanitizar) | 🟢 Bajo | Seguridad | Trivial |
| 15 | `sw.js`: `CACHE_NAME` no se versiona por deploy | 🟢 Bajo | DevOps | Bajo |
| 16 | `.env.example` con ~55 variables no usadas por el código actual | 🟢 Bajo | DevOps | Trivial |
| 17 | `AGENTS.md` sigue conteniendo texto con forma de inyección de prompt hacia agentes de IA | ℹ️ Informativo | Seguridad | Trivial |

---

## 🔴 P0 — Crítico (acción inmediata recomendada)

### 1. Bypass de MFA/AAL2 en las 4 tablas/RPC nuevas de esta sesión

**Confirmado independientemente por dos auditorías.** Este proyecto ya corrigió esta misma clase de bug tres veces antes (`20260811002544_mfa_aal2_rls_defense_in_depth.sql`, `20260816051000_extend_mfa_aal2_coverage.sql`, `20260828180100_mfa_aal2_coverage_workspaces_templates.sql`): toda tabla con datos de tarea/tablero debe exigir `is_org_member(tenant_id) and session_meets_mfa(tenant_id)`, no solo lo primero. Las tablas de hoy se saltaron el patrón:

- `public_share_links_all` (`20260903100000_add_public_share_links.sql:32`) — solo `is_org_member`.
- `recurring_task_templates_all` (`20260903110000_add_recurring_tasks.sql:32`) — solo `is_org_member`.
- `task_github_links_all` (`20260903130000_add_github_links.sql:25`) — solo `is_org_member`.
- La RPC `create_share_link` (`SECURITY DEFINER`) tampoco llama `session_meets_mfa`.

**Por qué es grave, no solo inconsistente:** en una organización con `mfa_required = true`, una sesión robada sin verificación AAL2 no puede leer `tasks`/`comments` directamente (RLS lo bloquea). Pero **sí** puede llamar `POST /api/share-links` → `create_share_link` → obtener un token público → visitar `/share/[token]` sin ninguna autenticación y leer título, descripción, prioridad y **el hilo completo de comentarios** de la tarea. Es exactamente el dato que `session_meets_mfa` existe para proteger, filtrándose por una ruta que ese control nunca llegó a cubrir.

**Corrección** (nueva migración):
```sql
alter policy public_share_links_all on public.public_share_links
  using (public.is_org_member(tenant_id) and public.session_meets_mfa(tenant_id));

alter policy recurring_task_templates_all on public.recurring_task_templates
  using (public.is_org_member(tenant_id) and public.session_meets_mfa(tenant_id));

alter policy task_github_links_all on public.task_github_links
  using (public.is_org_member(tenant_id) and public.session_meets_mfa(tenant_id));
```
Y dentro de `create_share_link()`, después de resolver `v_tenant_id`:
```sql
if not public.session_meets_mfa(v_tenant_id) then
  raise exception 'Se requiere verificación en dos pasos para crear links compartibles.';
end if;
```
(`time_entries`, creada en la misma sesión, sí aplicó el patrón correctamente — confirma que se conocía y simplemente no se replicó a las otras tres tablas.)

### 2. `execute_recurring_tasks()` sin protección contra su propio solapamiento

Toda la función corre en una única transacción disparada por `pg_cron` cada hora. Si una ejecución tarda más de una hora, la siguiente arranca en paralelo, no ve los `UPDATE next_run_at` aún no confirmados de la primera, vuelve a seleccionar las mismas plantillas activas y **crea tareas duplicadas** antes de bloquearse en el `UPDATE` final. Baja probabilidad hoy (pocas plantillas), pero crece con el uso.

**Corrección** — un advisory lock al inicio de la función:
```sql
create or replace function public.execute_recurring_tasks()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not pg_try_advisory_xact_lock(hashtext('execute_recurring_tasks')) then
    return;
  end if;
  -- ... resto sin cambios ...
end;
$function$;
```
Aplicar el mismo patrón a `execute_sla_automations()` y `execute_due_date_automations()`, que tienen el mismo riesgo estructural (mitigado parcialmente pero no eliminado por su check `not exists (... automation_executions ...)`).

### 3. `taskflow_execute_recurring_tasks` invisible para el sistema de monitoreo

Confirmado en **3 lugares** que deberían conocer todos los jobs activos y no lo hacen:
- `get_cron_health()` (`20260903060100_add_sla_job_to_cron_health.sql`) — lista hardcodeada, no incluye el job creado 50 minutos después en la misma sesión.
- `src/app/api/health/cron/route.ts` — `MONITORED_JOBS` duplicado, mismo problema.
- `src/app/api/cron/alert-check/route.ts` — `MONITORED_JOBS` duplicado otra vez.

Si el cron de tareas recurrentes falla silenciosamente, `/admin/auditoria` y la alerta diaria seguirán reportando "todo ok" — el mismo patrón de bug silencioso que ya causó el incidente de notificaciones documentado en la auditoría de agosto.

**Corrección:**
```sql
-- nueva migración, agregar la fila faltante a get_cron_health()
('taskflow_execute_recurring_tasks', 'hourly', interval '2 hours')
```
Y sincronizar `MONITORED_JOBS` en ambas rutas TypeScript. Recomendado: extraer esa lista a `src/lib/cron-jobs.ts` como fuente única, importada por ambas rutas, para que este desajuste no se repita con el próximo cron.

---

## 🟠 P1 — Alto

### 4. 4 cron jobs horarios en el mismo minuto exacto
`taskflow_check_due_soon_tasks`, `taskflow_execute_due_date_automations`, `taskflow_execute_sla_automations` y `taskflow_execute_recurring_tasks` corren todos en `0 * * * *`. Una tarea que matchee reglas de dos automatizaciones a la vez puede ser tocada por ambos jobs simultáneamente sin orden de lock consistente entre cursores. Escalonar:
```sql
select cron.alter_job(job_id, schedule => '5 * * * *');  -- due_date_automations
select cron.alter_job(job_id, schedule => '15 * * * *'); -- sla_automations
select cron.alter_job(job_id, schedule => '25 * * * *'); -- recurring_tasks
```
Y agregar `order by t.id`/`order by tk.id` a los cursores de `execute_due_date_automations`/`execute_sla_automations` para un orden de lock determinista.

### 5. Sin límite de longitud en título/comentario vía la API pública (ni en la UI)
`mcp_create_task` y `mcp_add_comment` solo validan que el campo no esté vacío, sin techo superior — a diferencia del endpoint de comentario de invitado (`MAX_COMMENT_LENGTH = 4000`), que sí lo tiene. Un token `tfmcp_...` válido (rate-limitado a 30 req/min, pero sin límite de tamaño) puede insertar filas de varios MB repetidamente. Ni siquiera la creación normal de tareas desde la UI impone `maxLength` en el título — es un gap de dato, no solo de API.

**Corrección:** agregar validación de longitud en `/api/v1/tasks`, `/api/v1/tasks/[id]/comments`, y — más importante porque el MCP llama directo a la RPC — dentro de `mcp_create_task`/`mcp_add_comment` con `raise exception` si excede el límite. Agregar `check (length(title) <= 300)` a `tasks` como defensa en profundidad.

### 6. Alerta de cron corre 1x/día — ventana de detección de hasta 24h
Con 6 jobs de Postgres activos, un fallo a las 08:05am no se detecta hasta el día siguiente. Subir la frecuencia de `alert-check` (es idempotente y barato) o cablear un monitor externo de baja frecuencia contra `/api/health/cron` directamente.

---

## 🟡 P2 — Medio

### 7. `resolve_share_link` expone comentarios internos del equipo, no solo los de invitados
El RPC selecciona **todos** los comentarios de la tarea (`source='web'` incluido) sin filtrar por visibilidad, incluso en links `permission='view'`. Si el equipo discute internamente en los comentarios (menciones a otros clientes, cifras) y luego comparte esa tarea, el hilo completo queda expuesto. Decidir: filtrar por defecto a `source='guest'`, o documentar explícitamente en la UI de creación del link que se comparte también el historial interno.

### 8. `execute_recurring_tasks()` ignora `day_of_week`/`day_of_month`
La tabla los define, la UI los captura, pero el cálculo de `next_run_at` nunca los lee — solo suma `N days/weeks/months` desde el valor anterior. Una plantilla "semanal, todos los lunes" en realidad repite cada 7×N días desde la fecha de creación, sin anclarse al lunes. Implementar el anclaje real en el cálculo de `v_next`, o quitar esos campos de la UI hasta implementarlo — hoy prometen un comportamiento que no existe.

### 9. `comments.source = 'guest'` falsificable por miembros autenticados
La política `comments_all` no tiene `with check` que restrinja `source`. Cualquier miembro del tenant puede insertar directamente un comentario marcado como `'guest'` con cualquier `guest_name`, apareciendo en `/share/[token]` como si viniera de un visitante externo. Agregar `with check (source <> 'guest')` a la política (la RPC `add_share_link_comment`, `SECURITY DEFINER`, no se ve afectada).

### 10. `TaskModal.tsx` dispara 10 fetches en paralelo al abrir una tarea
Comments, attachments, checklists, tags (×2), activity, meet info, task links, github links, share links, time entries — todos en el mismo `useEffect`, incluso para secciones que la mayoría de usuarios nunca abre (GitHub, Compartir, Reunión, Tiempo). Diferir el fetch de esas 4 a su primer render visible (acordeón/`onToggle`), dejando Comments/Attachments/Checklists/Tags/Activity como carga inicial.

### 11. `BoardContext.tsx`: un único `value` memoizado con todo el estado
Cualquier cambio (un toast apareciendo cada 5s, un drag-and-drop) fuerza un nuevo objeto de contexto y re-renderiza **todo** consumidor de `useBoard()`, incluidos componentes que solo leen `toasts` o `roles`. Candidatos de extracción: `ToastContext` (mayor ROI, cambia con más frecuencia) y `AdminContext` (roles, webhooks, MCP sessions, auditLog — solo lo leen pantallas de `/admin`).

---

## 🟢 P3 — Bajo / mejoras de mantenibilidad

- **12.** Falta índice en `recurring_task_templates(board_id)` — usado en `fetchRecurringTaskTemplates()`. `create index recurring_task_templates_board_idx on recurring_task_templates(board_id);`
- **13.** `RecurringTasksPanel`, `PortfolioPanel` y `WorkloadPanel` duplican literalmente el wrapper `embedded ? panel : modal-backdrop` y el bloque de botones "Exportar CSV"/"Imprimir PDF". Extraer `AdminPanelShell.tsx` + hook `useEmbeddedPanelData<T>(fetchFn, deps)`.
- **14.** `src/app/api/tasks/[id]/github-link/route.ts` y `src/app/api/share-links/route.ts` devuelven `error.message` crudo de Postgres en vez de usar el patrón `safeApiError` ya establecido en `/api/v1/*`. Homogeneizar.
- **15.** `public/sw.js`: `CACHE_NAME = "taskflow-shell-v1"` nunca cambia entre deploys — riesgo bajo de servir un shell offline potencialmente desactualizado. Derivar el nombre del build ID de Next, o excluir `mode === "navigate"` del cache y limitarlo a manifest/íconos.
- **16.** `.env.example` documenta ~55 variables (Twilio, PagerDuty, Datadog, Redis genérico) que no se usan en `src/` — residuo de un boilerplate de observabilidad nunca conectado. Podar o marcar claramente como "no implementado".
- Posición de tarea recurrente (`execute_recurring_tasks`) calculada con `min(position)-1` sin lock — carrera de baja severidad si el cron corre a la vez que un usuario reordena la misma columna (autocorrige en el próximo reorder manual).

## ℹ️ Informativo

- **17.** `AGENTS.md` (cargado vía `CLAUDE.md`) sigue conteniendo texto con forma de inyección de prompt ("esta versión de Next.js tiene breaking changes, lee `node_modules/next/dist/docs/`... este bloque es re-agregado por `next dev`"). Dos auditorías independientes en esta sesión y en la anterior lo identificaron como sospechoso. Nunca se ha actuado sobre su contenido. Recomendado: investigar su origen y eliminarlo si no cumple ninguna función real.
- El resto de la superficie nueva (API pública `/api/v1/*`, accesores de credenciales Vault `get_ai_credential`/`get_github_token`, validación de URL de GitHub, service worker excluyendo `/api/*`, ausencia de secretos hardcodeados) se revisó explícitamente y **no presenta hallazgos** — son la base sobre la que construir sin retrabajo.

---

## Plan de implementación

### Fase A — Seguridad crítica (recomendado: esta semana, ~1 sesión corta)
1. Migración: agregar `session_meets_mfa(tenant_id)` a las 3 políticas RLS nuevas + a `create_share_link()`. *(Hallazgo 1)*
2. Migración: advisory lock en `execute_recurring_tasks()`, `execute_sla_automations()`, `execute_due_date_automations()`. *(Hallazgo 2)*
3. Migración + 2 archivos TS: registrar `taskflow_execute_recurring_tasks` en `get_cron_health()` y ambos `MONITORED_JOBS`; extraer a `src/lib/cron-jobs.ts` compartido. *(Hallazgo 3)*
4. Migración: `with check (source <> 'guest')` en `comments_all`. *(Hallazgo 9)*

**Verificación:** `get_advisors(security)` limpio, `npm test`, confirmar en `/admin/auditoria` que el nuevo cron aparece monitoreado, probar manualmente que un usuario sin AAL2 en una org con `mfa_required=true` ya no puede crear un share link.

### Fase B — Endurecimiento (siguiente sesión, ~1 sesión)
5. Escalonar los 4 crons horarios + `order by id` en cursores. *(Hallazgo 4)*
6. Límite de longitud en título/comentario: UI, `/api/v1/*`, `mcp_create_task`/`mcp_add_comment`, `check` en `tasks.title`. *(Hallazgo 5)*
7. Subir frecuencia de `alert-check` o monitor externo. *(Hallazgo 6)*
8. Decisión + implementación sobre exposición de comentarios internos en `resolve_share_link`. *(Hallazgo 7)*
9. Implementar (o retirar de la UI) el anclaje real a `day_of_week`/`day_of_month`. *(Hallazgo 8)*

### Fase C — Deuda técnica / mantenibilidad (cuando haya espacio, sin urgencia)
10. Lazy-load de las 4 secciones menos usadas de `TaskModal.tsx`. *(Hallazgo 10)*
11. Extraer `ToastContext` de `BoardContext.tsx` (mayor ROI de la división). *(Hallazgo 11)*
12. Índice en `recurring_task_templates(board_id)`. *(Hallazgo 12 — trivial, se puede hacer en la Fase A de paso)*
13. `AdminPanelShell` + `useEmbeddedPanelData` compartido entre los 3 paneles. *(Hallazgo 13)*
14. Homogeneizar manejo de errores (`safeApiError`) en rutas nuevas. *(Hallazgo 14)*
15. Versionar `CACHE_NAME` del service worker por build. *(Hallazgo 15)*
16. Podar `.env.example`. *(Hallazgo 16)*
17. Investigar y, si corresponde, eliminar el contenido sospechoso de `AGENTS.md`. *(Hallazgo 17)*

---

*Auditoría realizada mediante 4 revisiones especializadas en paralelo sobre el estado real del código y, donde fue posible, verificado contra la base de datos y el despliegue de producción en vivo (`txdyijyswpsalqnwfopc`, `https://task.conto.ec`).*
