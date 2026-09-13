# Mejoras TaskFlow (deuda técnica + 4 features) — Diseño

**Fecha:** 2026-09-13
**Estado:** Aprobado

## Objetivo

Cerrar 3 ítems de deuda técnica encontrados en la auditoría de documentación
del 2026-09-10, y construir 4 features pendientes del roadmap
(`ROADMAP_FUNCIONALIDADES.md`, ítems 21, 12-parcial, 3-parcial y 2-parcial).

## Alcance — deuda técnica

### D1. `scripts/validate-environment.sh` valida variables obsoletas

Hoy valida `DATABASE_URL`, `REDIS_*`, `GMAIL_*`, `SLACK_WEBHOOK_URL`,
`PAGERDUTY_*`, `TWILIO_*`, `DD_API_KEY` — ninguna existe en el código.
Reescribir la lista para que valide exactamente las variables reales
(la misma lista de `ENV_SETUP_INSTRUCTIONS.md`, ya verificada):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `CRON_SECRET`,
`INTERNAL_NOTIFY_SECRET`, `ALERT_WEBHOOK_URL`, `RESEND_API_KEY`,
`NOTIFICATION_FROM_EMAIL`, `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`,
`GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`,
`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`, `GOOGLE_OAUTH_REDIRECT_URI`,
`NEXT_PUBLIC_APP_URL`. Distinguir obligatorias (rompen el build/arranque)
de opcionales (features que se degradan sin ellas: Google Drive, alertas).

### D2. `testing/load-test.js` ignora el escenario pedido por CLI

`run-load-tests.sh -s <name>` nunca propaga `TEST_SCENARIO` al proceso de
k6, y `load-test.js` llama `loadTestScenario('baseline')` hardcodeado — los
escenarios `spike`/`stress`/`endurance`/`ramp_up` ya definidos en el archivo
son código muerto inalcanzable. Arreglo: `run-load-tests.sh` exporta
`TEST_SCENARIO=<name>` antes de invocar `k6 run`; `load-test.js` lee
`__ENV.TEST_SCENARIO || 'baseline'` en vez del literal fijo.

### D3. Sin límite de tamaño de archivo en la importación de tareas

`POST /api/admin/import-tasks` (`src/app/api/admin/import-tasks/route.ts`)
lee el archivo completo a memoria (`Buffer.from(await file.arrayBuffer())`)
antes de aplicar el tope de 500 filas. Agregar un chequeo de tamaño antes de
leer el buffer: `file.size > 5 * 1024 * 1024` (5 MB, generoso para un CSV/
XLSX de 500 filas con las 7 columnas del formulario) → responder 400 con
`"El archivo supera el límite de 5 MB."` sin llamar a `XLSX.read`.

## Alcance — features

### F1. Cerrar tarea automáticamente al mergear su PR de GitHub

**Contexto real:** la integración de GitHub hoy es "pull" — un Personal
Access Token guardado por org (`get_github_token` RPC,
`src/lib/github/client.ts`), usado para *traer* título/estado de un
issue/PR ya vinculado (`task_github_links`, un link manual desde
`TaskGithubSection.tsx`). No hay webhook receptor ni GitHub App instalada
— construir eso sería un proyecto aparte (requiere que cada organización
instale una GitHub App o configure un webhook con secreto propio).

**Diseño elegido — polling, no webhook:** reutilizar el mismo patrón pull ya
existente. Nuevo cron diario-frecuente (cada 15 minutos, Vercel Cron —
segunda entrada en `vercel.json` junto a `alert-check`) que:
1. Selecciona todas las filas de `task_github_links` con `kind =
   'pull_request'` y `state != 'merged'` (uniendo con `tasks` para conocer
   `board_id`/`tenant_id`/`column_id` de cada una).
2. Para cada tenant con GitHub conectado, llama
   `fetchGithubIssueOrPr(token, url)` (ya existe) para refrescar `state`.
3. Si el estado devuelto pasa a `"merged"` (el campo `merged` del payload
   de la API de GitHub, no solo `state: closed` — un PR puede cerrarse sin
   mergear) y la tarea vinculada NO está ya en la última columna del
   tablero (`board_columns` ordenada por posición, la de mayor `position`):
   mueve la tarea ahí con la misma lógica de `moveTaskRemote` (posición al
   final de la columna destino), y actualiza `task_github_links.state` a
   `merged`.
4. Registra en `audit_log` la transición automática (acción
   `"task.auto_move_github_merge"`) para que quede trazable y no parezca un
   movimiento manual fantasma.

**Endpoint nuevo:** `GET /api/cron/github-sync-merged` (protegido con
`CRON_SECRET`, mismo patrón que `alert-check`).

**Por qué polling y no webhook:** ninguna organización tiene hoy una GitHub
App instalada ni un secreto de firma configurado; un webhook exigiría que
cada tenant lo configure manualmente en su repo antes de que la feature
sirva de algo, mientras que el polling funciona de inmediato para toda
organización que ya tenga el PAT guardado. El costo es latencia (hasta 15
min de retraso), aceptable para este caso de uso.

### F2. Gráfico de burndown en sprints

**Métrica:** cantidad de tareas (no story points — ese campo no existe en
el esquema y agregarlo es fuera de alcance).

**Reutiliza `metrics_snapshots`** (ya existe, con `board_id`, `sprint_id`,
`metric_type`, `snapshot_date`, `value: Json` — sin migración nueva).
Nuevo job diario de `pg_cron` (extiende `MONITORED_JOBS` en
`src/lib/cron-jobs.ts`, mismo patrón que los 7 existentes) que, para cada
sprint con `status = 'active'`, inserta una fila
`metric_type = 'sprint_burndown'`,
`value = {"total": N, "remaining": M}` — `total` = tareas con ese
`sprint_id` al momento de crear el sprint (fijo, no recalculado cada día),
`remaining` = tareas con ese `sprint_id` cuyo `column_id` no es la última
columna del tablero.

**UI:** en `EpicsSprintsPanel.tsx`, al expandir un sprint, nuevo bloque con
un gráfico de líneas (ideal: línea recta de `total` en el día de inicio a 0
en el día de fin; real: los puntos `remaining` de `metrics_snapshots`
filtrados por `sprint_id`). Sin librería de gráficos nueva — SVG simple
(mismo patrón ya usado en el dashboard, verificar antes de implementar qué
usa `DashboardView.tsx` para sus gráficos existentes y reutilizarlo).

**Limitación explícita:** los sprints cerrados antes de que este job exista
no tendrán historial — el burndown solo se acumula desde que se despliega
esta feature en adelante. Se documenta en la UI ("Sin datos históricos
antes de la fecha de despliegue") en vez de fingir reconstruir el pasado.

### F3. Sugerencia de prioridad/responsable por IA al crear una tarea

Reutiliza `getAiCredential(tenantId)` (`src/lib/ai/client.ts`) — mismo
patrón que la feature ya existente de "crear tarea por lenguaje natural"
(`src/app/api/tasks/parse-natural-language/route.ts`). Si no hay credencial
configurada, la sugerencia simplemente no aparece (mismo comportamiento
"inactivo sin API key" que las otras 2 features de IA).

**Nuevo endpoint:** `POST /api/tasks/suggest` — recibe `{title, boardId}`,
consulta hasta 20 tareas recientes del mismo tablero (título, prioridad,
responsable) como contexto, arma un prompt pidiendo `{priority,
assigneeName}` en JSON, llama al proveedor configurado. Nunca aplica nada
solo: devuelve la sugerencia al cliente.

**UI:** en el modal de "+ Nueva tarea" (`TaskModal.tsx`), al perder el foco
el campo Título (debounced ~600 ms, no en cada tecla), si hay ≥3 caracteres
se llama al endpoint; la respuesta se muestra como un chip descartable
("Sugerencia: Prioridad Alta, asignar a Ana — usar") junto a los campos de
prioridad/responsable. Un clic la aplica a los campos del formulario; si el
usuario ya escribió algo en esos campos, la sugerencia no se auto-aplica ni
sobreescribe.

### F4. Barras de dependencia conectadas en el Gantt

Hoy `task_links` (tipos `blocks`/`related_to`/`duplicates`) solo se
consultan y muestran como lista en `TaskModal.tsx` — `GanttView.tsx` no los
toca en absoluto. Esta feature es exclusivamente de visualización, sin
cambios de esquema ni backend nuevo: solo los tipo `blocks` se dibujan (los
otros dos tipos no representan una relación temporal, no aplican a un
Gantt).

`GanttView.tsx` obtiene, además de las tareas del tablero, sus
`task_links` tipo `blocks` (una consulta por tablero, no por tarea, para no
generar N+1 — nuevo método `fetchBoardTaskLinks(supabase, boardId)` en
`task-links-repo.ts` que haga un solo `select` con `task_id in (...)` sobre
las tareas visibles). Por cada link `blocks` donde ambas tareas están en el
rango visible del Gantt, dibuja una línea/flecha SVG conectando el borde
derecho de la barra de la tarea bloqueadora con el borde izquierdo de la
tarea bloqueada (patrón estándar de Gantt: flecha "finish-to-start").

**Fuera de alcance:** arrastrar para crear una dependencia nueva desde el
Gantt (se sigue creando desde `TaskModal.tsx`); reflow automático de fechas
cuando una dependencia se viola (solo indicador visual, ya existe como
advertencia de texto, se mantiene).

## Testing

- D1: no requiere test automatizado (script bash de validación) — probar
  manualmente que falla con una variable real ausente y pasa con todas
  presentes.
- D2: test unitario si `load-test.js` expone la función de selección de
  escenario de forma testeable; si no, verificación manual con
  `TEST_SCENARIO=spike node testing/load-test.js --check` (sin ejecutar
  contra un servidor real).
- D3: test de integración en `import-tasks/__tests__/route.test.ts` — un
  `File` de más de 5 MB debe responder 400 sin invocar `XLSX.read`.
- F1: tests de la nueva ruta de cron mockeando `fetchGithubIssueOrPr` y la
  respuesta de Supabase; casos: PR mergeado mueve la tarea, PR cerrado sin
  mergear no la mueve, tarea ya en última columna no se toca dos veces.
- F2: tests del cálculo de `remaining` (mock de tareas por columna) y de
  que el job solo corre sobre sprints `active`.
- F3: tests de la ruta `/api/tasks/suggest` — sin credencial IA devuelve
  `null`/204 sin error; con credencial mockeada, devuelve el JSON parseado
  del proveedor.
- F4: verificación manual en navegador (dev deploy) con 2 tareas
  encadenadas por `blocks` — confirmar que la flecha aparece y apunta en la
  dirección correcta.

## Decisiones ya tomadas (con el usuario, o por defecto ante falta de respuesta)

- Orden de ejecución: deuda técnica (D1-D3) primero, luego features de
  menor a mayor esfuerzo — F1 → F2 → F3 → F4.
- F1 mueve la tarea a la última columna del tablero (no configurable por
  ahora).
- F2 usa cantidad de tareas, no story points.
- F3 aparece al crear una tarea nueva, nunca se aplica automáticamente.
