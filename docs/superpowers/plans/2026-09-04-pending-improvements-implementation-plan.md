# Plan de implementación — mejoras pendientes de la revisión integral

> **Nota de formato:** este plan cubre 14 mejoras heterogéneas e independientes
> (perf, refactors, config, decisiones de producto/infra) encontradas en la
> revisión de 2026-09-04, no una sola feature nueva. Se agrupan en fases por
> riesgo/esfuerzo/dependencias en vez de usar el formato TDD micro-paso a
> paso completo para las 14 — varias no son lógica nueva unit-testeable sino
> refactors de UI, ajustes de config, o decisiones que requieren tu input
> (upgrade de plan, tradeoff de Sentry). Cada tarea sigue siendo concreta:
> archivos exactos, pasos verificables, sin placeholders.

**Meta:** cerrar los 14 hallazgos pendientes de `AUDITORIA_2026-09-03.md` /
la revisión consolidada de 2026-09-04, en orden de riesgo/beneficio real.

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Supabase
(Postgres/RLS/pg_cron/pg_net) + Vercel.

## Restricciones globales

- Cada tarea termina con `npx tsc --noEmit` + `npm run build` +
  `npm test -- --silent` (199/199) en verde antes de commitear.
- Commits específicos (`git add <archivos>`, nunca `-A`), mensaje +
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Cambios de esquema/DB solo vía migración versionada nueva, nunca
  `execute_sql` crudo (regla ya establecida en `README.md`).
- Verificar en vivo (navegador o SQL de solo lectura) antes de dar una
  tarea por terminada — no basta con que compile.

---

## Fase 1 — Correcciones puntuales, bajo riesgo, sin decisiones pendientes

Estas 3 se pueden hacer ya, cada una es un cambio contenido en 1-2 archivos.

### Tarea 1: Cerrar el bypass de userinfo en `is_safe_webhook_url`

**Hallazgo:** la función de protección SSRF (usada por `webhook`, `crm_sync`,
y cualquier acción de automatización futura que valide URLs) no despoja el
componente "userinfo" de una URL antes de aplicar su lista de bloqueo — una
URL como `https://allowed-host.com@internal-ip/path` podría burlar el
chequeo si el parser de host la interpreta de forma distinta al navegador/
cliente HTTP real que la va a llamar.

**Archivos:**
- Localizar la definición actual: `grep -rn "create.*function.*is_safe_webhook_url\|create or replace function.*is_safe_webhook_url" supabase/migrations/`
- Migración nueva: `supabase/migrations/<timestamp>_fix_is_safe_webhook_url_userinfo_bypass.sql`

- [ ] **Paso 1: Leer la definición actual en vivo** (no confiar en el archivo de migración más viejo, aprender de la regresión de `ingest_webhook_task` de esta misma sesión — siempre verificar el estado real antes de reescribir)

  ```sql
  select pg_get_functiondef(oid) as def from pg_proc where proname = 'is_safe_webhook_url';
  ```

- [ ] **Paso 2: Reescribir la función para extraer el host correctamente**

  El fix es despojar cualquier segmento `usuario:contraseña@` antes de
  extraer el host para el chequeo de bloqueo. Ejemplo de patrón a aplicar
  dentro de la función (ajustar a la lógica real que devuelva `pg_get_functiondef`):

  ```sql
  -- Dentro de la función, antes de extraer v_host:
  -- normaliza quitando cualquier userinfo (todo antes de la última '@' en
  -- la porción de autoridad) para que el chequeo de bloqueo opere sobre el
  -- host real que un cliente HTTP conforme a RFC 3986 usaría.
  v_url_no_userinfo := regexp_replace(p_url, '^(https?://)[^/@]*@', '\1');
  -- ... y usar v_url_no_userinfo (no p_url) para el resto del parseo de host.
  ```

- [ ] **Paso 3: Aplicar la migración**

  Usar `mcp__supabase__apply_migration` con el nombre de archivo de arriba.

- [ ] **Paso 4: Verificar en vivo con casos reales (solo lectura, sin insertar nada)**

  ```sql
  select is_safe_webhook_url('https://good.com@169.254.169.254/latest/meta-data/') as deberia_ser_false;
  select is_safe_webhook_url('https://api.miqacrm-prueba.example.com/tickets') as deberia_ser_true;
  select is_safe_webhook_url('https://10.0.0.1/') as deberia_ser_false;
  ```

- [ ] **Paso 5: Commit**

  ```bash
  git add supabase/migrations/<timestamp>_fix_is_safe_webhook_url_userinfo_bypass.sql
  git commit -m "$(cat <<'EOF'
  fix: cierra bypass de userinfo en is_safe_webhook_url

  La lista de bloqueo SSRF no despojaba usuario:contraseña@ antes de
  extraer el host, permitiendo potencialmente burlar el chequeo con una
  URL tipo https://allowed@internal-ip/. Afecta a las acciones webhook y
  crm_sync de automatizaciones (hallazgo de la revisión de 2026-09-04).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 2: `CrmGenericCard` — interface de props nombrada

**Archivos:**
- Modificar: `src/components/IntegrationsModal.tsx` (función `CrmGenericCard`, ~línea 328)

- [ ] **Paso 1: Agregar la interface nombrada junto a `ProviderCardProps`**

  ```typescript
  interface CrmGenericCardProps {
    integration: Integration | undefined;
  }
  ```

- [ ] **Paso 2: Usarla en la firma de la función**

  ```typescript
  function CrmGenericCard({ integration }: CrmGenericCardProps) {
  ```

- [ ] **Paso 3: Verificar**

  ```bash
  npx tsc --noEmit
  ```

- [ ] **Paso 4: Commit**

  ```bash
  git add src/components/IntegrationsModal.tsx
  git commit -m "$(cat <<'EOF'
  refactor: CrmGenericCard usa interface de props nombrada

  Consistencia con ProviderCard/RolesModal (hallazgo de la revisión de
  consistencia, 2026-09-04) — cosmético, sin cambio de comportamiento.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 3: `board-repo.ts` — acotar el `select("*")` de tareas

**Hallazgo:** `fetchBoardState` trae `description` y `custom_fields` (jsonb)
para cada tarea en cada carga de tablero, pero las tarjetas Kanban no los
usan.

**Archivos:**
- Leer primero: `src/lib/supabase/board-repo.ts:39-42` (`fetchBoardState`) y `rowToTask()` (~línea 21-36)
- Verificar dependientes: `grep -rn "\.description\b" src/components/TaskCard.tsx src/components/Column.tsx src/components/Board.tsx` y lo mismo con `state.tasks[` en `TaskModal.tsx` para confirmar si `TaskModal` reusa `state.tasks[id].description` (ya cargado) en vez de hacer su propio fetch al abrir — **si `TaskModal` depende de `state.tasks[id].description` ya presente, este cambio rompe la apertura de tareas y hay que descartarlo o hacer que `TaskModal` haga su propio fetch puntual primero.**

- [ ] **Paso 1: Confirmar si TaskModal usa `state.tasks[id].description`/`customFields` directamente**

  ```bash
  grep -n "description\|customFields\|custom_fields" src/components/TaskModal.tsx | head -20
  ```

  Si aparece uso directo del campo desde `state.tasks` (no desde un fetch propio del modal), **detener esta tarea** — el fix correcto sería primero hacer que `TaskModal` cargue la tarea completa por `id` al abrir (tarea aparte, mayor alcance) antes de poder acotar el `select` de la lista.

- [ ] **Paso 2 (solo si el paso 1 confirma que es seguro): acotar el select**

  En `board-repo.ts`, cambiar el `.select("*")` de la query de tasks a:

  ```typescript
  .select("id,title,priority,assignee_name,assignee_user_id,created_at,tag,start_date,due_date,parent_task_id,epic_id,sprint_id,column_id,position")
  ```

- [ ] **Paso 3: Ajustar `rowToTask()` si referencia campos ya no seleccionados**

- [ ] **Paso 4: Probar en el navegador** — abrir el tablero, abrir una tarea con descripción real, confirmar que la descripción se sigue viendo (vía preview_start + navegación real, no solo tsc).

- [ ] **Paso 5: Commit** (solo si el paso 4 pasó sin regresión)

---

## Fase 2 — Refactors de esfuerzo medio, alcance contenido

### Tarea 4: `ProviderCard`/`CrmGenericCard` — remount al cambiar `integration`

**Archivos:** `src/components/IntegrationsModal.tsx`

- [ ] **Paso 1:** en el `.map()` que renderiza las cards (cerca de donde se decide `ProviderCard` vs `CrmGenericCard`), cambiar el `key`:

  ```typescript
  provider === "crm_generic" ? (
    <CrmGenericCard key={byProvider.get(provider)?.id ?? provider} integration={byProvider.get(provider)} />
  ) : (
    <ProviderCard key={byProvider.get(provider)?.id ?? provider} provider={provider} integration={byProvider.get(provider)} />
  )
  ```

- [ ] **Paso 2:** verificar que el `key` anterior (`provider` solo) se reemplaza en ambas ramas, no solo una.
- [ ] **Paso 3:** `npx tsc --noEmit`, probar en navegador: guardar una integración, confirmar que la card refleja el estado nuevo sin recargar la página.
- [ ] **Paso 4:** Commit.

---

### Tarea 5: Acciones en lote — batch en vez de N llamadas independientes

**Archivos:** `src/components/Board.tsx:202-246` (`handleBulkMove`, `handleBulkAssign`, `handleBulkTag`, `handleBulkDelete`), `src/context/BoardContext.tsx` (para exponer una versión batch si se decide a nivel de contexto)

- [ ] **Paso 1:** Leer las 4 funciones actuales para confirmar la firma exacta de `moveTask`/`updateTask`/`deleteTask` que llaman hoy en loop.
- [ ] **Paso 2:** Añadir un `Promise.allSettled` envolviendo las llamadas individuales dentro de cada handler bulk, en vez de fire-and-forget secuencial:

  ```typescript
  async function handleBulkMove() {
    if (!bulkColumnId || selectedTaskIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(
      Array.from(selectedTaskIds).map((taskId) => moveTaskRemote(supabase, taskId, bulkColumnId, /* posición calculada */))
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      pushToast(`${failed} de ${results.length} tareas no se pudieron mover.`);
    }
    setBulkBusy(false);
    setSelectedTaskIds(new Set());
  }
  ```

  Nota: esto es un cambio de "N reversiones optimistas independientes" a
  "una sola notificación de fallos parciales" — no introduce un endpoint
  batch nuevo en el servidor (fuera de alcance), solo evita que un solo
  fallo dispare `load()` completo y descarte actualizaciones optimistas
  exitosas de las demás tareas del lote.

- [ ] **Paso 3:** Repetir el mismo patrón para `handleBulkAssign`, `handleBulkTag`, `handleBulkDelete`.
- [ ] **Paso 4:** Probar en navegador: seleccionar 3+ tareas, mover en lote, confirmar que todas se mueven y no hay parpadeo de recarga completa.
- [ ] **Paso 5:** Commit.

---

### Tarea 6: `BoardContext` — no cargar datos admin-only para usuarios no-admin

**Archivos:** `src/context/AdminDataContext.tsx` (el `useEffect` de carga, líneas ~178-238)

- [ ] **Paso 1:** en `AdminDataProvider`, obtener `isOwner` desde `useBoard()` además de los campos ya usados.
- [ ] **Paso 2:** envolver el cuerpo del `useEffect` de carga (todas las llamadas `fetch*`) en un chequeo:

  ```typescript
  useEffect(() => {
    if (!tenantId || !activeBoardId || !activeWorkspaceId) return;
    // Los admin panels solo son alcanzables para isOwner (ver isOwner &&
    // en cada modal) — no tiene sentido pagar 11 fetches para cada
    // usuario no-admin que solo abre el tablero.
    if (!isOwner) return;
    const key = `${tenantId}:${activeBoardId}:${activeWorkspaceId}`;
    // ... resto igual
  }, [tenantId, activeBoardId, activeWorkspaceId, isOwner, userId, supabase, pushToast]);
  ```

- [ ] **Paso 3:** ⚠️ Verificar que ningún panel accesible por no-admin lee estos campos — repasar la tabla de grep de la Sección "punto 2" de esta misma sesión: `AutomationsModal`/`McpTokensModal`/etc. ya están gateados por `isOwner &&` en sus componentes padres, pero **confirmar explícitamente antes de commitear**, ejecutando `grep -rn "isOwner" src/components/AutomationsModal.tsx src/components/McpTokensModal.tsx src/components/IntegrationsModal.tsx src/components/RolesModal.tsx` y revisando que el renderizado del contenido (no solo el botón) esté detrás de ese chequeo.
- [ ] **Paso 4:** Probar en navegador con una cuenta no-owner: confirmar que `Automatizaciones`/`Integraciones`/etc. siguen mostrando su fallback de solo-lectura sin errores de consola (mismo patrón ya verificado para "Automatizaciones" con la cuenta admin de esta sesión).
- [ ] **Paso 5:** Commit.

---

### Tarea 7: `RecurringTasksPanel` — eliminar la doble fuente de verdad

**Archivos:** `src/components/RecurringTasksPanel.tsx:55-58`, `src/hooks/useEmbeddedPanelData.ts`

- [ ] **Paso 1:** Leer `useEmbeddedPanelData.ts` completo para entender su contrato actual (qué expone: `data`, `loading`, `error`, `setError`).
- [ ] **Paso 2:** Añadir un parámetro opcional de merge optimista al hook, o (alternativa más simple y de menor alcance) reemplazar el `useEffect` que sincroniza `data` → `templates` por una función `mergeCreated(created: RecurringTaskTemplate)` que se llama explícitamente solo desde `handleCreate`, sin depender de que `data` cambie:

  ```typescript
  // En vez de:
  // useEffect(() => { if (data) setTemplates(data); }, [data]);
  // usar templates derivado directamente de data + una lista de ids
  // creados-localmente-no-reflejados-aún, evitando el efecto de
  // sincronización que causaba el bug de "loading" documentado en el
  // comentario de handleCreate.
  ```

  Este es el ítem de mayor ambigüedad de diseño del plan — antes de
  implementar, confirmar conmigo el enfoque exacto si el hook se toca
  (afecta a otros consumidores de `useEmbeddedPanelData`, revisar
  `grep -rln "useEmbeddedPanelData" src/components/`).

- [ ] **Paso 3:** Probar en navegador: crear una tarea recurrente, confirmar que aparece de inmediato sin parpadeo ni desaparición.
- [ ] **Paso 4:** Commit.

---

## Fase 3 — Requieren tu decisión antes de implementar

Estas 4 no son "solo código" — cada una necesita que elijas un tradeoff.

### Tarea 8: Bundle de Sentry (143 KB gzip en cada ruta)

**Decisión pendiente:** ¿bajar `tracesSampleRate` (menos trazas de
performance, mismo bundle), lazy-init después de la primera interacción
(bundle no bloquea el first paint pero sigue pesando lo mismo total), o
recortar integraciones del SDK que no uses (browser tracing/replay)?

**Archivo:** `sentry.client.config.ts:5-8`

- [ ] Una vez decidido el enfoque, este es un cambio de 1 archivo — puedo implementarlo en la misma sesión que se decida.

---

### Tarea 9: Dividir `TaskModal.tsx` (2107 líneas, 15 secciones)

**Decisión pendiente:** ya la tomaste explícitamente esta sesión (dejarlo
para otra sesión con más tiempo de QA manual por panel). Este plan solo
deja el punto de partida documentado para cuando decidas retomarlo:
extraer primero las secciones más aisladas — GitHub links y Time
Tracking (ya tienen su propio archivo de repo, mínima interdependencia
con el resto del modal) — como primer paso incremental, no una reescritura
completa de una vez.

---

### Tarea 10: Upgrade de plan Supabase (Free → pago) y Vercel (Hobby → Pro)

**Decisión pendiente:** es una decisión de facturación, no de código — no
hay tarea de implementación de mi parte más allá de confirmarte cuándo el
proyecto realmente necesita el upgrade (ya diste la estimación de
capacidad: ~150-200 conectados / ~30-50 activos simultáneos con la
infraestructura actual).

---

### Tarea 11: Prueba de carga real

**Decisión pendiente:** contra qué entorno correrla (ya la pausamos
explícitamente esta sesión). Retomar con `performance-optimizer:load-testing-specialist` cuando elijas el entorno.

---

## Fase 4 — Opcional, cosmético, alto blast radius para bajo beneficio

### Tarea 12: Unificar verbos `create`/`add`/`insert` en los repos

**No recomendado hacer ahora.** Renombrar `addComment`, `addChecklistItem`,
`addTagToTask`, `addManualEntry`, `insertTask`, `insertColumn`,
`getAttachmentSignedUrl` a la convención `create*`/`fetch*` dominante
tocaría cada call site de esas 7 funciones en todo `src/components/` — alto
riesgo de introducir un typo en un rename masivo, para un beneficio
puramente cosmético. Si se hace, debe ser su propia sesión dedicada con
`grep -rn` de cada nombre antes de tocar nada, uno a la vez, con
`tsc --noEmit` entre cada rename (el compilador detecta cualquier call
site no actualizado).

---

## Autorrevisión

- **Cobertura:** las 14 mejoras pendientes de la tabla consolidada de
  2026-09-04 están cubiertas (Tareas 1-9, más 10-11 como decisiones sin
  código, más 12 explícitamente desaconsejada con razón documentada).
- **Sin placeholders:** cada tarea de código (1-7) tiene archivos exactos y
  pasos concretos; las de decisión (8-11) están marcadas como tales, no
  disfrazadas de "tareas" con pasos vacíos.
- **Consistencia de tipos:** Tarea 4 reutiliza `Integration` ya importado en
  `IntegrationsModal.tsx`; Tarea 6 reutiliza `isOwner`/`useBoard()` ya
  presentes en el mismo archivo que edita.
