# Mejoras TaskFlow (deuda técnica + 4 features) — Plan de implementación

> **Para agentes:** REQUIERE SUB-SKILL: usa superpowers:subagent-driven-development
> (recomendado) o superpowers:executing-plans para ejecutar este plan tarea
> por tarea. Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Objetivo:** cerrar 3 ítems de deuda técnica y construir 4 features
pendientes del roadmap, según el diseño aprobado en
`docs/superpowers/specs/2026-09-13-mejoras-taskflow-design.md`.

**Arquitectura:** Next.js 16 App Router + Supabase (Postgres con pg_cron) +
Vercel Cron. Cada feature reutiliza infraestructura ya existente (RBAC,
`metrics_snapshots`, credenciales de IA/GitHub por tenant) — sin librerías
nuevas.

**Tech Stack:** TypeScript, Jest, Supabase (migraciones SQL versionadas),
xlsx (ya instalado), sin dependencias nuevas.

## Restricciones globales

- Todo cambio de esquema va en una migración nueva en
  `supabase/migrations/`, nunca SQL suelto.
- Ningún endpoint nuevo debe romper convenciones ya establecidas: auth de
  cron con `CRON_SECRET` (patrón de `alert-check`), auth de usuario con
  sesión + membership check filtrado por `user_id` (patrón de
  `parse-natural-language`).
- Trabajo directo sobre `main`, sin worktree — mismo acuerdo vigente el
  resto de esta sesión.
- Antes de cada commit: `npx tsc --noEmit && npm run build && npm test --
  --silent` en verde.

---

### Tarea 1: Arreglar `scripts/validate-environment.sh`

**Archivos:**
- Modificar: `scripts/validate-environment.sh`

**Interfaces:** ninguna (script bash independiente, no importado por código TS).

- [ ] **Paso 1: Leer el script actual completo**

  ```bash
  cat scripts/validate-environment.sh
  ```

  Localizar el arreglo de variables validadas (probablemente
  `REQUIRED_VARS=(...)` o similar) y las validaciones específicas de
  `DATABASE_URL`/`REDIS_*`/`GMAIL_*`/`SLACK_WEBHOOK_URL`/`PAGERDUTY_*`/
  `TWILIO_*`/`DD_API_KEY`.

- [ ] **Paso 2: Reemplazar la lista de variables**

  Reemplazar el arreglo de variables obligatorias por exactamente estas
  (verificadas contra `grep -rhoE "process\.env\.[A-Z_0-9]+" src` — son las
  únicas que el código realmente lee):

  ```bash
  REQUIRED_VARS=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
    "JWT_SECRET"
    "NEXT_PUBLIC_APP_URL"
  )

  OPTIONAL_VARS=(
    "CRON_SECRET"
    "INTERNAL_NOTIFY_SECRET"
    "ALERT_WEBHOOK_URL"
    "RESEND_API_KEY"
    "NOTIFICATION_FROM_EMAIL"
    "UPSTASH_REDIS_REST_URL"
    "UPSTASH_REDIS_REST_TOKEN"
    "KV_REST_API_URL"
    "KV_REST_API_TOKEN"
    "GOOGLE_CLIENT_ID"
    "NEXT_PUBLIC_GOOGLE_CLIENT_ID"
    "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY"
    "GOOGLE_OAUTH_REDIRECT_URI"
  )
  ```

  Mantener la lógica de recorrido del script (probablemente un `for var in
  "${REQUIRED_VARS[@]}"; do [ -z "${!var}" ] && MISSING+=("$var"); done`) —
  solo reemplazar el contenido de los arreglos, no la lógica de control. Si
  el script hoy solo tiene un arreglo (sin distinguir obligatorias/
  opcionales), agregar un segundo bloque que recorra `OPTIONAL_VARS` e
  imprima una advertencia (no un error) por cada una ausente, ej.:

  ```bash
  echo ""
  echo "Variables opcionales no configuradas (features degradadas, no bloquea el arranque):"
  for var in "${OPTIONAL_VARS[@]}"; do
    if [ -z "${!var}" ]; then
      echo "  ⚠ $var"
    fi
  done
  ```

- [ ] **Paso 3: Verificar manualmente**

  ```bash
  # Debe fallar (faltan REQUIRED_VARS)
  bash scripts/validate-environment.sh; echo "exit: $?"

  # Debe pasar (cargando el .env.local real de producción vía vercel env,
  # o exportando manualmente las 5 obligatorias con valores de prueba)
  NEXT_PUBLIC_SUPABASE_URL=x NEXT_PUBLIC_SUPABASE_ANON_KEY=x \
  SUPABASE_SERVICE_ROLE_KEY=x JWT_SECRET=x NEXT_PUBLIC_APP_URL=x \
  bash scripts/validate-environment.sh; echo "exit: $?"
  ```

- [ ] **Paso 4: Commit**

  ```bash
  git add scripts/validate-environment.sh
  git commit -m "$(cat <<'EOF'
  fix: validate-environment.sh valida las variables reales, no las obsoletas

  El script validaba DATABASE_URL/REDIS_*/GMAIL_*/SLACK_WEBHOOK_URL/
  PAGERDUTY_*/TWILIO_*/DD_API_KEY — ninguna existe en el código. Ahora
  valida las variables que el código realmente lee (verificado con
  grep sobre src/), distinguiendo obligatorias de opcionales.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 2: Arreglar el escenario de `testing/load-test.js`

**Archivos:**
- Modificar: `testing/load-test.js`
- Modificar: `testing/run-load-tests.sh`

**Interfaces:** ninguna (scripts independientes).

- [ ] **Paso 1: Leer ambos archivos completos**

  ```bash
  cat testing/load-test.js
  cat testing/run-load-tests.sh
  ```

  Localizar: en `load-test.js`, la línea que llama
  `loadTestScenario('baseline')` (o equivalente) de forma hardcodeada; en
  `run-load-tests.sh`, el parseo de la flag `-s`/`--scenario` y la
  invocación de `k6 run`.

- [ ] **Paso 2: Propagar el escenario en `run-load-tests.sh`**

  Antes de la línea que ejecuta `k6 run ... load-test.js`, agregar (si no
  existe ya una variable local con el nombre del escenario parseado,
  usarla; si se llama distinto al ejemplo, ajustar el nombre):

  ```bash
  export TEST_SCENARIO="${SCENARIO:-baseline}"
  ```

  Y confirmar que la invocación de `k6 run` está en el mismo shell (no en
  un subshell que no herede el export) — si usa `k6 run testing/load-test.js`
  directamente en el mismo script, el `export` ya es suficiente.

- [ ] **Paso 3: Leer el escenario en `load-test.js`**

  Reemplazar la llamada hardcodeada:

  ```js
  // Antes:
  const scenario = loadTestScenario('baseline');

  // Después:
  const scenarioName = __ENV.TEST_SCENARIO || 'baseline';
  const scenario = loadTestScenario(scenarioName);
  ```

  Si `loadTestScenario` no existe como función invocable y en su lugar hay
  un objeto plano `SCENARIOS = { baseline: {...}, spike: {...}, ... }`
  accedido con `SCENARIOS.baseline` hardcodeado, adaptar de forma
  equivalente:

  ```js
  const scenarioName = __ENV.TEST_SCENARIO || 'baseline';
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) {
    throw new Error(`Escenario desconocido: ${scenarioName}. Válidos: ${Object.keys(SCENARIOS).join(', ')}`);
  }
  ```

- [ ] **Paso 4: Verificar manualmente sin correr contra un servidor real**

  ```bash
  # Debe imprimir/usar el escenario "spike", no "baseline" — verificar en
  # el output de k6 (imprime el nombre del escenario activo) o agregando
  # temporalmente un console.log(scenarioName) que se retira después.
  TEST_SCENARIO=spike k6 run --vus 1 --duration 1s testing/load-test.js 2>&1 | head -20
  ```

- [ ] **Paso 5: Commit**

  ```bash
  git add testing/load-test.js testing/run-load-tests.sh
  git commit -m "$(cat <<'EOF'
  fix: load-test.js ahora respeta el escenario pedido por CLI

  run-load-tests.sh -s <name> nunca propagaba TEST_SCENARIO a k6, y
  load-test.js llamaba loadTestScenario('baseline') hardcodeado — los
  escenarios spike/stress/endurance/ramp_up eran código muerto
  inalcanzable. Ahora se lee __ENV.TEST_SCENARIO.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 3: Límite de tamaño de archivo en importación de tareas

**Archivos:**
- Modificar: `src/app/api/admin/import-tasks/route.ts`
- Modificar: `src/app/api/admin/import-tasks/__tests__/route.test.ts`

**Interfaces:** ninguna nueva — cambio interno a la ruta ya existente.

- [ ] **Paso 1: Escribir el test que falla primero**

  Agregar en `route.test.ts` (siguiendo el patrón de mocks ya usado en ese
  archivo — `mockSupabase` con auth/organization_members/boards mockeados
  igual que los tests existentes de 401/403):

  ```ts
  it('rejects a file larger than 5MB before parsing it', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { organization_id: 'org-1', org_role: 'owner' },
            error: null,
          }),
        };
      }
      if (table === 'boards') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: 'board-1', tenant_id: 'org-1' },
            error: null,
          }),
        };
      }
      return {};
    });

    // Archivo de 6 MB — no necesita ser un xlsx/csv válido, porque el
    // chequeo de tamaño debe rechazarlo ANTES de intentar parsearlo.
    const bigBuffer = Buffer.alloc(6 * 1024 * 1024, 'a');
    const file = new File([bigBuffer], 'grande.csv', { type: 'text/csv' });

    const response = await importTasks(makeFormDataRequest(file, 'board-1'));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/5 ?MB/i);
  });
  ```

- [ ] **Paso 2: Confirmar que el test falla**

  Run: `npm test -- import-tasks --silent`
  Expected: FAIL (el chequeo de tamaño no existe todavía; el archivo
  inválido de 6MB actualmente cae en el catch de `XLSX.read` con el
  mensaje genérico "No se pudo leer el archivo", no el de 5MB).

- [ ] **Paso 3: Implementar el chequeo**

  En `route.ts`, justo después de validar `file instanceof File` (antes de
  llegar a la lectura del buffer y `XLSX.read`), agregar:

  ```ts
  const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 5 MB." }, { status: 400 });
  }
  ```

  Ubicación exacta: después del bloque que valida `!(file instanceof File)
  || typeof boardId !== "string" || !boardId` y antes de la consulta a
  `boards` (para rechazar archivos grandes sin siquiera consultar la base
  de datos).

- [ ] **Paso 4: Correr los tests y confirmar que pasan**

  Run: `npm test -- import-tasks --silent`
  Expected: PASS

- [ ] **Paso 5: Verificar tipos y build completo**

  ```bash
  npx tsc --noEmit
  npm run build
  npm test -- --silent
  ```

- [ ] **Paso 6: Commit**

  ```bash
  git add src/app/api/admin/import-tasks/route.ts src/app/api/admin/import-tasks/__tests__/route.test.ts
  git commit -m "$(cat <<'EOF'
  fix: límite de 5MB antes de parsear el archivo de importación de tareas

  El endpoint leía el archivo completo a memoria antes de aplicar el
  tope de 500 filas. Ahora rechaza archivos de más de 5MB antes de
  intentar leerlos.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 4: Cerrar tarea al mergear su PR de GitHub

**Archivos:**
- Crear: `src/app/api/cron/github-sync-merged/route.ts`
- Crear: `src/app/api/cron/github-sync-merged/__tests__/route.test.ts`
- Modificar: `vercel.json`

**Interfaces:**
- Consume: `getGithubToken(tenantId)` y `fetchGithubIssueOrPr(token, url)`
  de `src/lib/github/client.ts` (ya existen, no se modifican).
- Consume: la tabla `task_github_links` (columnas `id, task_id, url, repo,
  number, kind, state` — ya existe) y `board_columns.is_done_state`.

- [ ] **Paso 1: Escribir el test que falla primero**

  ```ts
  // src/app/api/cron/github-sync-merged/__tests__/route.test.ts
  import { describe, it, expect, jest, beforeEach } from '@jest/globals';

  jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
  jest.mock('@/lib/github/client', () => ({
    getGithubToken: jest.fn(),
    fetchGithubIssueOrPr: jest.fn(),
  }));

  import { GET as githubSyncMerged } from '../route';
  import { createClient } from '@supabase/supabase-js';
  import { getGithubToken, fetchGithubIssueOrPr } from '@/lib/github/client';

  function makeRequest(secret?: string): Request {
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    return new Request('http://localhost:3000/api/cron/github-sync-merged', { headers });
  }

  describe('GET /api/cron/github-sync-merged', () => {
    const OLD_ENV = process.env;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockSupabase: any;

    beforeEach(() => {
      jest.clearAllMocks();
      process.env = { ...OLD_ENV, CRON_SECRET: 'test-secret', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x' };
      mockSupabase = { from: jest.fn() };
      (createClient as jest.Mock).mockReturnValue(mockSupabase);
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('returns 401 without the correct CRON_SECRET', async () => {
      const response = await githubSyncMerged(makeRequest('wrong-secret'));
      expect(response.status).toBe(401);
    });

    it('moves a task to the done column when its linked PR is merged', async () => {
      const linkRow = {
        id: 'link-1',
        task_id: 'task-1',
        url: 'https://github.com/acme/repo/pull/42',
        repo: 'acme/repo',
        number: 42,
        kind: 'pull_request',
        state: 'open',
        tasks: { id: 'task-1', board_id: 'board-1', column_id: 'col-todo', tenant_id: 'org-1' },
      };
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'task_github_links') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            neq: jest.fn().mockResolvedValue({ data: [linkRow], error: null }),
            update: jest.fn().mockReturnThis(),
          };
        }
        if (table === 'board_columns') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue({ data: [{ id: 'col-done', position: 99 }], error: null }),
          };
        }
        if (table === 'tasks') {
          return { update: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ error: null }) };
        }
        if (table === 'audit_log') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
        return {};
      });
      (getGithubToken as jest.Mock).mockResolvedValue('gh-token');
      (fetchGithubIssueOrPr as jest.Mock).mockResolvedValue({
        repo: 'acme/repo', number: 42, kind: 'pull_request', title: 'Fix bug', state: 'merged',
      });

      const response = await githubSyncMerged(makeRequest('test-secret'));
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.moved).toBe(1);
    });

    it('does not move the task when the PR closed without merging', async () => {
      const linkRow = {
        id: 'link-2', task_id: 'task-2', url: 'https://github.com/acme/repo/pull/7',
        repo: 'acme/repo', number: 7, kind: 'pull_request', state: 'open',
        tasks: { id: 'task-2', board_id: 'board-1', column_id: 'col-todo', tenant_id: 'org-1' },
      };
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'task_github_links') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            neq: jest.fn().mockResolvedValue({ data: [linkRow], error: null }),
            update: jest.fn().mockReturnThis(),
          };
        }
        return {};
      });
      (getGithubToken as jest.Mock).mockResolvedValue('gh-token');
      (fetchGithubIssueOrPr as jest.Mock).mockResolvedValue({
        repo: 'acme/repo', number: 7, kind: 'pull_request', title: 'Fix bug', state: 'closed',
      });

      const response = await githubSyncMerged(makeRequest('test-secret'));
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.moved).toBe(0);
    });
  });
  ```

- [ ] **Paso 2: Confirmar que el test falla**

  Run: `npm test -- github-sync-merged --silent`
  Expected: FAIL (el módulo `../route` todavía no existe)

- [ ] **Paso 3: Implementar la ruta**

  ```ts
  // src/app/api/cron/github-sync-merged/route.ts
  import { timingSafeEqual } from "crypto";
  import { createClient } from "@supabase/supabase-js";
  import type { Database } from "@/lib/supabase/database.types";
  import { getGithubToken, fetchGithubIssueOrPr } from "@/lib/github/client";

  // Cron cada 15 minutos (vercel.json) que revisa los PRs vinculados a
  // tareas (task_github_links) y mueve la tarea a la columna "done" del
  // tablero cuando GitHub reporta el PR como mergeado. Polling, no webhook
  // — ninguna organización tiene hoy una GitHub App instalada; el mismo
  // Personal Access Token que ya usa TaskGithubSection.tsx para traer
  // título/estado alcanza para esto (ver diseño 2026-09-13).
  //
  // Auth: mismo patrón que /api/cron/alert-check — Bearer CRON_SECRET.
  function isAuthorized(request: Request): boolean {
    const expected = process.env.CRON_SECRET;
    if (!expected) return false;
    const header = request.headers.get("authorization");
    const provided = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!provided || provided.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  }

  function getServiceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase service-role configuration missing");
    return createClient<Database>(url, key);
  }

  interface LinkedTaskRow {
    id: string;
    task_id: string;
    url: string;
    repo: string;
    number: number;
    kind: string;
    state: string;
    tasks: { id: string; board_id: string; column_id: string; tenant_id: string } | null;
  }

  export async function GET(request: Request): Promise<Response> {
    if (!isAuthorized(request)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getServiceClient();

    const { data: links, error: linksError } = await supabase
      .from("task_github_links")
      .select("id, task_id, url, repo, number, kind, state, tasks:task_id(id, board_id, column_id, tenant_id)")
      .eq("kind", "pull_request")
      .neq("state", "merged");
    if (linksError) {
      return Response.json({ error: linksError.message }, { status: 500 });
    }

    let moved = 0;
    const tokenCache = new Map<string, string | null>();
    const doneColumnCache = new Map<string, string | null>();

    for (const link of (links ?? []) as unknown as LinkedTaskRow[]) {
      const task = link.tasks;
      if (!task) continue;

      let token = tokenCache.get(task.tenant_id);
      if (token === undefined) {
        token = await getGithubToken(task.tenant_id);
        tokenCache.set(task.tenant_id, token);
      }
      if (!token) continue; // Org sin GitHub conectado — nada que revisar.

      let refreshed;
      try {
        refreshed = await fetchGithubIssueOrPr(token, link.url);
      } catch {
        continue; // PR eliminado / repo inaccesible — se reintenta en la próxima corrida.
      }

      if (refreshed.state !== "merged") {
        if (refreshed.state !== link.state) {
          await supabase.from("task_github_links").update({ state: refreshed.state }).eq("id", link.id);
        }
        continue;
      }

      let doneColumnId = doneColumnCache.get(task.board_id);
      if (doneColumnId === undefined) {
        const { data: doneColumns } = await supabase
          .from("board_columns")
          .select("id")
          .eq("board_id", task.board_id)
          .eq("is_done_state", true)
          .order("position", { ascending: true })
          .limit(1);
        doneColumnId = doneColumns?.[0]?.id ?? null;
        doneColumnCache.set(task.board_id, doneColumnId);
      }
      if (!doneColumnId || task.column_id === doneColumnId) {
        await supabase.from("task_github_links").update({ state: "merged" }).eq("id", link.id);
        continue;
      }

      const { data: maxPositionRows } = await supabase
        .from("tasks")
        .select("position")
        .eq("column_id", doneColumnId)
        .order("position", { ascending: false })
        .limit(1);
      const nextPosition = (maxPositionRows?.[0]?.position ?? 0) + 1;

      await supabase.from("tasks").update({ column_id: doneColumnId, position: nextPosition }).eq("id", task.id);
      await supabase.from("task_github_links").update({ state: "merged" }).eq("id", link.id);
      await supabase.from("audit_log").insert({
        tenant_id: task.tenant_id,
        actor_id: null,
        source: "github_sync_cron",
        action: "task_auto_moved_github_merge",
        resource_type: "task",
        resource_id: task.id,
        metadata: { github_url: link.url },
      });
      moved += 1;
    }

    return Response.json({ moved });
  }
  ```

- [ ] **Paso 4: Correr los tests y confirmar que pasan**

  Run: `npm test -- github-sync-merged --silent`
  Expected: PASS (3/3)

- [ ] **Paso 5: Agregar el cron a `vercel.json`**

  ```json
  {
    "crons": [
      { "path": "/api/cron/alert-check", "schedule": "0 8 * * *" },
      { "path": "/api/cron/github-sync-merged", "schedule": "*/15 * * * *" }
    ]
  }
  ```

- [ ] **Paso 6: Verificar tipos y build completo**

  ```bash
  npx tsc --noEmit
  npm run build
  npm test -- --silent
  ```

- [ ] **Paso 7: Commit**

  ```bash
  git add src/app/api/cron/github-sync-merged/route.ts src/app/api/cron/github-sync-merged/__tests__/route.test.ts vercel.json
  git commit -m "$(cat <<'EOF'
  feat: cerrar tarea automáticamente al mergear su PR de GitHub

  Nuevo cron /api/cron/github-sync-merged (cada 15 min) que revisa los
  PRs vinculados vía task_github_links usando el mismo token PAT que ya
  existía para traer título/estado, y mueve la tarea a la columna
  is_done_state del tablero cuando GitHub reporta el PR como mergeado.
  Polling en vez de webhook — ninguna organización tiene hoy una GitHub
  App instalada.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 5: Gráfico de burndown en sprints — backend (migración + job)

**Archivos:**
- Crear: `supabase/migrations/<timestamp>_sprint_burndown_snapshots.sql`
- Modificar: `src/lib/cron-jobs.ts`

**Interfaces:**
- Produce: filas en `metrics_snapshots` con `metric_type = 'sprint_burndown'`
  y `value = {"total": number, "remaining": number}`, consumidas por la
  Tarea 6 (UI).

- [ ] **Paso 1: Crear la migración**

  El constraint único existente en `metrics_snapshots` es
  `(board_id, metric_type, snapshot_date)` — no sirve para burndown porque
  dos sprints activos en el mismo board el mismo día chocarían. Se agrega
  un índice único parcial específico para filas de burndown, y la función
  que las genera:

  ```sql
  -- supabase/migrations/<timestamp>_sprint_burndown_snapshots.sql

  -- metrics_snapshots_board_metric_date_key (board_id, metric_type,
  -- snapshot_date) no alcanza para burndown: un board puede tener más de
  -- un sprint activo el mismo día. Se agrega un índice único parcial
  -- adicional, específico para metric_type = 'sprint_burndown', scopeado
  -- por sprint_id en vez de board_id.
  create unique index metrics_snapshots_sprint_burndown_key
    on metrics_snapshots (sprint_id, snapshot_date)
    where metric_type = 'sprint_burndown';

  create or replace function record_sprint_burndown_snapshot(p_sprint_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_board_id uuid;
    v_total integer;
    v_remaining integer;
  begin
    select board_id into v_board_id from sprints where id = p_sprint_id;
    if v_board_id is null then
      return;
    end if;

    select count(*) into v_total from tasks where sprint_id = p_sprint_id;

    select count(*) into v_remaining
    from tasks t
    join board_columns c on c.id = t.column_id
    where t.sprint_id = p_sprint_id
      and c.is_done_state = false;

    insert into metrics_snapshots (board_id, metric_type, snapshot_date, sprint_id, value)
    values (v_board_id, 'sprint_burndown', current_date, p_sprint_id,
            jsonb_build_object('total', v_total, 'remaining', v_remaining))
    on conflict (sprint_id, snapshot_date) where metric_type = 'sprint_burndown'
    do update set value = excluded.value;
  end;
  $$;

  grant execute on function record_sprint_burndown_snapshot(uuid) to authenticated;

  create or replace function record_sprint_burndown_snapshot_all_active()
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_sprint record;
  begin
    for v_sprint in select id from sprints where status = 'active' loop
      perform record_sprint_burndown_snapshot(v_sprint.id);
    end loop;
  end;
  $$;

  grant execute on function record_sprint_burndown_snapshot_all_active() to authenticated;

  select cron.schedule(
    'record-sprint-burndown-snapshots',
    '0 1 * * *', -- diario 01:00 UTC, después de record-daily-metrics-snapshots
    $$select record_sprint_burndown_snapshot_all_active()$$
  );
  ```

  Verificar el nombre exacto de la función `cron.schedule` usada por el job
  hermano `record-daily-metrics-snapshots` (`grep -rn "cron.schedule"
  supabase/migrations/`) y replicar la misma sintaxis exacta si difiere de
  lo escrito arriba (por ejemplo si el proyecto usa `cron.schedule(job_name,
  schedule, command)` con otro orden de argumentos).

- [ ] **Paso 2: Aplicar la migración**

  Usar la herramienta de migraciones de Supabase (`apply_migration`, no
  `execute_sql`) con el contenido exacto de arriba.

- [ ] **Paso 3: Agregar el job a `MONITORED_JOBS`**

  En `src/lib/cron-jobs.ts`, agregar una entrada a `MONITORED_JOBS`
  (manteniendo el comentario existente sobre por qué esta lista debe
  coincidir con `get_cron_health()`):

  ```ts
  { name: "record-sprint-burndown-snapshots", schedule: "daily" },
  ```

  Y actualizar también la lista `monitored_jobs` dentro de
  `get_cron_health()` (buscar en
  `supabase/migrations/20260903200000_audit_fase_a_security_fixes.sql` cuál
  es la migración más reciente que define esa función, y crear una NUEVA
  migración — no editar una ya aplicada — que haga
  `create or replace function get_cron_health()` con la lista actualizada,
  agregando `'record-sprint-burndown-snapshots'` al arreglo).

- [ ] **Paso 4: Verificar manualmente**

  ```sql
  -- Confirmar que el cron quedó programado
  select * from cron.job where jobname = 'record-sprint-burndown-snapshots';

  -- Ejecutar una vez a mano contra un sprint activo real y confirmar la fila
  select record_sprint_burndown_snapshot_all_active();
  select * from metrics_snapshots where metric_type = 'sprint_burndown' order by snapshot_date desc limit 5;
  ```

- [ ] **Paso 5: Verificar tipos y build completo**

  ```bash
  npx tsc --noEmit
  npm run build
  npm test -- --silent
  ```

- [ ] **Paso 6: Commit**

  ```bash
  git add supabase/migrations/ src/lib/cron-jobs.ts
  git commit -m "$(cat <<'EOF'
  feat: job diario de snapshots de burndown por sprint

  Nueva función record_sprint_burndown_snapshot(), programada vía
  pg_cron diariamente, que inserta {total, remaining} por sprint activo
  en metrics_snapshots (reutilizando la tabla ya existente, sin tabla
  nueva) — un índice único parcial adicional scopea estas filas por
  sprint_id en vez de board_id, ya que un board puede tener más de un
  sprint activo el mismo día.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 6: Gráfico de burndown en sprints — UI

**Archivos:**
- Modificar: `src/components/EpicsSprintsPanel.tsx`
- Crear: `src/lib/supabase/sprint-burndown-repo.ts`

**Interfaces:**
- Consume: filas `metrics_snapshots` con `metric_type = 'sprint_burndown'`
  (producidas por la Tarea 5).

- [ ] **Paso 1: Crear el repo de lectura**

  ```ts
  // src/lib/supabase/sprint-burndown-repo.ts
  import type { SupabaseClient } from "@supabase/supabase-js";
  import type { Database } from "./database.types";

  type TypedClient = SupabaseClient<Database>;

  export interface BurndownPoint {
    date: string; // YYYY-MM-DD
    total: number;
    remaining: number;
  }

  export async function fetchSprintBurndown(supabase: TypedClient, sprintId: string): Promise<BurndownPoint[]> {
    const { data, error } = await supabase
      .from("metrics_snapshots")
      .select("snapshot_date, value")
      .eq("sprint_id", sprintId)
      .eq("metric_type", "sprint_burndown")
      .order("snapshot_date", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => {
      const value = row.value as { total?: number; remaining?: number };
      return {
        date: row.snapshot_date,
        total: value.total ?? 0,
        remaining: value.remaining ?? 0,
      };
    });
  }
  ```

- [ ] **Paso 2: Agregar el bloque de burndown a `EpicsSprintsPanel.tsx`**

  Leer primero el componente completo para ubicar dónde se renderiza cada
  sprint expandido (la sección que ya muestra `taskProgress(...)`), y
  agregar, dentro de ese mismo bloque por sprint:

  ```tsx
  // Import nuevo al inicio del archivo:
  import { fetchSprintBurndown, type BurndownPoint } from "@/lib/supabase/sprint-burndown-repo";

  // Estado nuevo, junto a los demás useState del componente:
  const [burndownBySprintId, setBurndownBySprintId] = useState<Record<string, BurndownPoint[]>>({});

  // Efecto nuevo: cargar el burndown de cada sprint visible cuando cambian los sprints.
  useEffect(() => {
    let cancelled = false;
    sprints.forEach((sprint) => {
      fetchSprintBurndown(supabase, sprint.id).then((points) => {
        if (!cancelled) setBurndownBySprintId((prev) => ({ ...prev, [sprint.id]: points }));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, sprints]);
  ```

  Y, dentro del bloque JSX que renderiza un sprint individual (después de
  la barra de progreso ya existente), agregar el gráfico SVG:

  ```tsx
  {(() => {
    const points = burndownBySprintId[sprint.id] ?? [];
    if (points.length === 0 || !sprint.startDate || !sprint.endDate) {
      return (
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          Sin datos de burndown antes de la fecha de despliegue de esta función.
        </p>
      );
    }
    const total = points[0].total;
    const startMs = new Date(sprint.startDate).getTime();
    const endMs = new Date(sprint.endDate).getTime();
    const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000));
    const width = 280;
    const height = 100;
    const xForDay = (dayOffset: number) => (dayOffset / totalDays) * width;
    const yForCount = (count: number) => height - (count / Math.max(1, total)) * height;

    const idealPath = `M ${xForDay(0)} ${yForCount(total)} L ${xForDay(totalDays)} ${yForCount(0)}`;
    const realPath = points
      .map((p, i) => {
        const dayOffset = Math.round((new Date(p.date).getTime() - startMs) / 86400000);
        return `${i === 0 ? "M" : "L"} ${xForDay(dayOffset)} ${yForCount(p.remaining)}`;
      })
      .join(" ");

    return (
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={`Burndown del sprint ${sprint.name}`}>
        <path d={idealPath} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 3" fill="none" />
        <path d={realPath} stroke="var(--accent, #4f81bd)" strokeWidth="2" fill="none" />
      </svg>
    );
  })()}
  ```

  Ajustar `var(--accent, #4f81bd)` al token de color real que use el resto
  del panel (buscar qué variable CSS usan las barras de progreso ya
  existentes en este mismo archivo y reutilizar la misma).

- [ ] **Paso 3: Verificar tipos y build completo**

  ```bash
  npx tsc --noEmit
  npm run build
  npm test -- --silent
  ```

- [ ] **Paso 4: Verificación manual en navegador**

  1. `preview_start` con el servidor de dev (o directo en producción tras
     desplegar, dado el problema conocido de `.env.local`).
  2. Abrir un tablero con un sprint activo con tareas.
  3. Ejecutar manualmente `select record_sprint_burndown_snapshot_all_active();`
     un par de días distintos (o simular con `snapshot_date` insertado a
     mano para tener al menos 2 puntos) para ver la línea real con más de
     un punto.
  4. Confirmar que la línea ideal y la línea real se dibujan sin errores en
     consola.

- [ ] **Paso 5: Commit**

  ```bash
  git add src/lib/supabase/sprint-burndown-repo.ts src/components/EpicsSprintsPanel.tsx
  git commit -m "$(cat <<'EOF'
  feat: gráfico de burndown en el panel de sprints

  Consume los snapshots diarios de la Tarea 5 (metrics_snapshots,
  metric_type sprint_burndown) y dibuja línea ideal vs. real en SVG,
  sin librería de gráficos nueva. Sprints sin snapshots (anteriores al
  despliegue de esta función) muestran un aviso en vez de un gráfico
  vacío.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 7: Sugerencia de prioridad/responsable por IA

**Archivos:**
- Modificar: `src/lib/ai/completions.ts`
- Crear: `src/app/api/tasks/suggest/route.ts`
- Crear: `src/app/api/tasks/suggest/__tests__/route.test.ts`
- Modificar: `src/components/TaskModal.tsx`

**Interfaces:**
- Consume: `getAiCredential(tenantId)` (ya existe).
- Produce: `POST /api/tasks/suggest` → `{ priority: Priority, assigneeName:
  string | null }` o 501 si no hay credencial IA configurada.

- [ ] **Paso 1: Agregar `suggestTaskFields` a `completions.ts`**

  ```ts
  // Agregar al final de src/lib/ai/completions.ts

  export interface SuggestedTaskFields {
    priority: "low" | "medium" | "high" | "urgent";
    assigneeName: string | null;
  }

  const SUGGEST_SYSTEM_PROMPT = `Basándote en el historial de tareas recientes de este tablero (título, prioridad y responsable de cada una), sugiere la prioridad y el responsable más probable para una tarea nueva con el título dado.
  Responde ÚNICAMENTE con JSON válido, sin markdown, con esta forma exacta:
  {"priority": "low"|"medium"|"high"|"urgent", "assigneeName": "nombre exacto de un responsable visto en el historial"|null}
  Si no hay suficiente historial para sugerir un responsable con confianza, usa null. Nunca inventes un nombre que no aparezca en el historial.`;

  export async function suggestTaskFields(
    credential: AiCredential,
    newTaskTitle: string,
    recentTasks: { title: string; priority: string; assignee: string }[]
  ): Promise<SuggestedTaskFields> {
    const historyText = recentTasks
      .map((t) => `- "${t.title}" | prioridad: ${t.priority} | responsable: ${t.assignee}`)
      .join("\n");
    const userPrompt = `Historial del tablero:\n${historyText}\n\nTítulo de la tarea nueva: "${newTaskTitle}"`;
    const raw = await complete(credential, SUGGEST_SYSTEM_PROMPT, userPrompt);

    let parsed: unknown;
    try {
      const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("La IA no devolvió un JSON válido.");
    }

    const obj = parsed as Record<string, unknown>;
    const priority = ["low", "medium", "high", "urgent"].includes(obj.priority as string)
      ? (obj.priority as SuggestedTaskFields["priority"])
      : "medium";
    const assigneeName = typeof obj.assigneeName === "string" && obj.assigneeName.trim() ? obj.assigneeName.trim() : null;

    return { priority, assigneeName };
  }
  ```

- [ ] **Paso 2: Escribir el test de la ruta que falla primero**

  ```ts
  // src/app/api/tasks/suggest/__tests__/route.test.ts
  import { describe, it, expect, jest, beforeEach } from '@jest/globals';

  jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
  jest.mock('@/lib/ai/client', () => ({ getAiCredential: jest.fn() }));
  jest.mock('@/lib/ai/completions', () => ({ suggestTaskFields: jest.fn() }));
  jest.mock('@/lib/rate-limit', () => ({
    checkRateLimit: jest.fn().mockResolvedValue({ success: true }),
    deriveRateLimitKey: jest.fn((k: string) => k),
  }));

  import { POST as suggest } from '../route';
  import { createClient } from '@/lib/supabase/server';
  import { getAiCredential } from '@/lib/ai/client';
  import { suggestTaskFields } from '@/lib/ai/completions';

  function makeRequest(body: unknown): Request {
    return new Request('http://localhost:3000/api/tasks/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  describe('POST /api/tasks/suggest', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockSupabase: any;

    beforeEach(() => {
      jest.clearAllMocks();
      mockSupabase = {
        auth: { getUser: jest.fn() },
        from: jest.fn(),
      };
      (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    });

    it('returns 401 without a session', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('no') });
      const response = await suggest(makeRequest({ title: 'x', boardId: 'board-1', tenantId: 'org-1' }));
      expect(response.status).toBe(401);
    });

    it('returns 501 when no AI credential is configured', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'organization_members') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: { organization_id: 'org-1' }, error: null }),
          };
        }
        return {};
      });
      (getAiCredential as jest.Mock).mockResolvedValue(null);

      const response = await suggest(makeRequest({ title: 'Arreglar bug', boardId: 'board-1', tenantId: 'org-1' }));
      expect(response.status).toBe(501);
    });

    it('returns a suggestion when a credential is configured', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'organization_members') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: { organization_id: 'org-1' }, error: null }),
          };
        }
        if (table === 'tasks') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue({
              data: [{ title: 'Otra tarea', priority: 'high', assignee: 'Ana' }],
              error: null,
            }),
          };
        }
        return {};
      });
      (getAiCredential as jest.Mock).mockResolvedValue({ provider: 'openai', apiKey: 'x' });
      (suggestTaskFields as jest.Mock).mockResolvedValue({ priority: 'high', assigneeName: 'Ana' });

      const response = await suggest(makeRequest({ title: 'Arreglar bug urgente', boardId: 'board-1', tenantId: 'org-1' }));
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json).toEqual({ priority: 'high', assigneeName: 'Ana' });
    });
  });
  ```

- [ ] **Paso 3: Confirmar que el test falla**

  Run: `npm test -- tasks/suggest --silent`
  Expected: FAIL (el módulo `../route` todavía no existe)

- [ ] **Paso 4: Implementar la ruta**

  ```ts
  // src/app/api/tasks/suggest/route.ts
  import { NextRequest, NextResponse } from "next/server";
  import { createClient as createServerSupabase } from "@/lib/supabase/server";
  import { getAiCredential } from "@/lib/ai/client";
  import { suggestTaskFields } from "@/lib/ai/completions";
  import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

  /**
   * POST /api/tasks/suggest
   * Body: { title: string, boardId: string, tenantId: string }
   * Sugiere prioridad/responsable para una tarea nueva basándose en el
   * historial reciente del tablero. Nunca se aplica sola — el cliente
   * (TaskModal) la muestra como sugerencia descartable. Responde 501 si no
   * hay credencial de IA configurada, mismo contrato que
   * parse-natural-language.
   */
  export async function POST(request: NextRequest): Promise<NextResponse> {
    const supabase = await createServerSupabase();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await checkRateLimit(deriveRateLimitKey(`ai-suggest-task:${authData.user.id}`));
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." }, { status: 429 });
    }

    let body: { title?: string; boardId?: string; tenantId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.title?.trim() || !body.boardId || !body.tenantId) {
      return NextResponse.json({ error: "title, boardId y tenantId son requeridos" }, { status: 400 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", body.tenantId)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (membershipError || !membership) {
      return NextResponse.json({ error: "Sin permiso para esta organización" }, { status: 403 });
    }

    const credential = await getAiCredential(body.tenantId);
    if (!credential) {
      return NextResponse.json(
        { error: "IA no configurada. Agrega una API key de OpenAI o Anthropic en Integraciones." },
        { status: 501 }
      );
    }

    const { data: recentTasks } = await supabase
      .from("tasks")
      .select("title, priority, assignee_name")
      .eq("board_id", body.boardId)
      .order("created_at", { ascending: false })
      .limit(20);

    try {
      const suggestion = await suggestTaskFields(
        credential,
        body.title.trim(),
        (recentTasks ?? []).map((t) => ({
          title: t.title,
          priority: t.priority,
          assignee: t.assignee_name ?? "Sin asignar",
        }))
      );
      return NextResponse.json(suggestion);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo generar la sugerencia.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
  ```

  Confirmar el nombre real de la columna de responsable en `tasks`
  (`assignee_name` se usa aquí por consistencia con el resto del código de
  esta sesión — verificar con
  `grep -n "assignee_name\|assignee" src/lib/supabase/database.types.ts`
  antes de dar este paso por bueno, y ajustar el nombre si difiere).

- [ ] **Paso 5: Correr los tests y confirmar que pasan**

  Run: `npm test -- tasks/suggest --silent`
  Expected: PASS (3/3)

- [ ] **Paso 6: Conectar la UI en `TaskModal.tsx`**

  Agregar estado nuevo junto a los demás `useState` del componente:

  ```tsx
  const [suggestion, setSuggestion] = useState<{ priority: Priority; assigneeName: string | null } | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  ```

  Agregar un `useEffect` con debounce que dispara la sugerencia solo en
  modo creación, cuando el título tiene al menos 3 caracteres y el usuario
  dejó de escribir por 600ms:

  ```tsx
  useEffect(() => {
    if (mode !== "create" || !tenantId || !activeBoardId || title.trim().length < 3) {
      setSuggestion(null);
      return;
    }
    setSuggestionDismissed(false);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/tasks/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim(), boardId: activeBoardId, tenantId }),
        });
        if (!res.ok) return; // 501 (sin IA configurada) u otro error: no mostrar nada.
        const json = await res.json();
        setSuggestion(json);
      } catch {
        // Silencioso — es una sugerencia opcional, no debe interrumpir la creación de la tarea.
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [title, mode, tenantId, activeBoardId]);
  ```

  Y el chip de sugerencia en el JSX, junto a los campos de prioridad/
  asignado ya existentes (después del `<div className="field-row">` que
  contiene `#priority` y `#assignee`):

  ```tsx
  {suggestion && !suggestionDismissed && (
    <div className="field" style={{ background: "var(--surface-2)", padding: 8, borderRadius: 6, fontSize: 12.5 }}>
      <span>
        ✨ Sugerencia: prioridad {PRIORITY_LABEL[suggestion.priority]}
        {suggestion.assigneeName ? `, asignar a ${suggestion.assigneeName}` : ""}
      </span>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setPriority(suggestion.priority);
            if (suggestion.assigneeName) setAssignee(suggestion.assigneeName);
            setSuggestionDismissed(true);
          }}
        >
          Usar
        </button>
        <button type="button" className="btn" onClick={() => setSuggestionDismissed(true)}>
          Descartar
        </button>
      </div>
    </div>
  )}
  ```

  Verificar el nombre real de la constante/objeto que traduce valores de
  `Priority` a etiquetas en español dentro de `TaskModal.tsx` (buscar cómo
  se renderizan las `<option>` del select de prioridad) y usar ese mismo
  objeto en vez de `PRIORITY_LABEL` si se llama distinto.

- [ ] **Paso 7: Verificar tipos y build completo**

  ```bash
  npx tsc --noEmit
  npm run build
  npm test -- --silent
  ```

- [ ] **Paso 8: Verificación manual en navegador**

  1. Con una organización que tenga una API key de IA configurada en
     `/admin/integraciones`, abrir "+ Nueva tarea", escribir un título de
     ≥3 caracteres, esperar ~1s.
  2. Confirmar que aparece el chip de sugerencia, que "Usar" aplica los
     campos, y que "Descartar" lo oculta sin tocar el formulario.
  3. Sin API key configurada: confirmar que no aparece nada (ni error
     visible).

- [ ] **Paso 9: Commit**

  ```bash
  git add src/lib/ai/completions.ts src/app/api/tasks/suggest/route.ts src/app/api/tasks/suggest/__tests__/route.test.ts src/components/TaskModal.tsx
  git commit -m "$(cat <<'EOF'
  feat: sugerencia de prioridad/responsable por IA al crear una tarea

  Nuevo endpoint POST /api/tasks/suggest, mismo patrón de credencial que
  parse-natural-language (501 si no hay IA configurada). La sugerencia
  se muestra como chip descartable en el modal de nueva tarea — nunca
  se aplica automáticamente.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tarea 8: Barras de dependencia conectadas en el Gantt

**Archivos:**
- Modificar: `src/lib/supabase/task-links-repo.ts`
- Modificar: `src/components/GanttView.tsx`

**Interfaces:**
- Produce: `fetchBoardTaskLinks(supabase, taskIds)` en
  `task-links-repo.ts`, usada solo por `GanttView.tsx`.

- [ ] **Paso 1: Agregar `fetchBoardTaskLinks` al repo**

  ```ts
  // Agregar a src/lib/supabase/task-links-repo.ts

  /** Todos los links tipo "blocks" cuyos DOS extremos están en el conjunto
   * de tareas dado (una sola consulta por tablero, no una por tarea —
   * evita N+1 en GanttView). */
  export async function fetchBoardTaskLinks(supabase: TypedClient, allBoardTaskIds: string[]): Promise<TaskLink[]> {
    if (allBoardTaskIds.length === 0) return [];
    const { data, error } = await supabase
      .from("task_links")
      .select("id, source_task_id, target_task_id, link_type")
      .eq("link_type", "blocks")
      .in("source_task_id", allBoardTaskIds);
    if (error) throw error;
    // El target también debe pertenecer al tablero — se filtra en el
    // cliente porque dos .in() encadenados en PostgREST se combinan con
    // AND, no OR, lo que excluiría links válidos donde solo el source
    // está en la lista.
    const idSet = new Set(allBoardTaskIds);
    return (data ?? [])
      .filter((r) => idSet.has(r.target_task_id))
      .map((r) => ({
        id: r.id,
        sourceTaskId: r.source_task_id,
        targetTaskId: r.target_task_id,
        linkType: r.link_type as LinkType,
      }));
  }
  ```

- [ ] **Paso 2: Obtener las posiciones renderizadas de cada barra en `GanttView.tsx`**

  El Gantt hoy posiciona las barras vía CSS grid (`gridColumn`), sin
  coordenadas absolutas — dibujar una flecha SVG entre dos barras requiere
  medir su posición real en pantalla después del render. Agregar refs por
  fila y medir con `getBoundingClientRect()`:

  ```tsx
  // En GanttRow, aceptar y asignar un ref:
  function GanttRow({
    task,
    startCol,
    endCol,
    barClassName,
    windowDays,
    onOpen,
    barRef,
  }: {
    task: Task;
    startCol: number;
    endCol: number;
    barClassName: string;
    windowDays: number;
    onOpen: () => void;
    barRef: (el: HTMLDivElement | null) => void;
  }) {
    const rowProps = useClickableRow(onOpen);
    return (
      <div className="gantt-row" style={{ gridTemplateColumns: `170px repeat(${windowDays}, 1fr)` }}>
        <div className="rowlabel">{task.title}</div>
        <div style={{ gridColumn: `${startCol} / ${endCol}` }}>
          <div className={barClassName} ref={barRef} {...rowProps}>
            <span className="bar-label">{task.title}</span>
          </div>
        </div>
      </div>
    );
  }
  ```

  En `GanttView`, agregar el fetch de links y el cálculo de flechas. Primero
  confirmar cómo obtiene `supabase` este componente hoy (`grep -n "supabase"
  src/components/GanttView.tsx` — probablemente vía `useBoard()`, igual que
  `state`/`addTask`/etc.; si `useBoard()` no expone `supabase` directamente,
  importar `createClient` del mismo módulo que usan otros componentes
  cliente, ej. `@/lib/supabase/client`):

  ```tsx
  // Imports nuevos:
  import { useEffect, useRef } from "react";
  import { fetchBoardTaskLinks, type TaskLink } from "@/lib/supabase/task-links-repo";

  // Dentro de GanttView(), junto a los demás hooks:
  const [taskLinks, setTaskLinks] = useState<TaskLink[]>([]);
  const barRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const bodyRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<{ id: string; x1: number; y1: number; x2: number; y2: number }[]>([]);

  useEffect(() => {
    const allTaskIds = Object.keys(state.tasks);
    if (allTaskIds.length === 0) return;
    fetchBoardTaskLinks(supabase, allTaskIds).then(setTaskLinks);
  }, [supabase, state.tasks]);

  useEffect(() => {
    if (!bodyRef.current) return;
    const containerRect = bodyRef.current.getBoundingClientRect();
    const next: typeof arrows = [];
    for (const link of taskLinks) {
      const sourceEl = barRefs.current.get(link.sourceTaskId);
      const targetEl = barRefs.current.get(link.targetTaskId);
      if (!sourceEl || !targetEl) continue; // Una de las dos tareas no está en la ventana visible.
      const sourceRect = sourceEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      next.push({
        id: link.id,
        x1: sourceRect.right - containerRect.left,
        y1: sourceRect.top + sourceRect.height / 2 - containerRect.top,
        x2: targetRect.left - containerRect.left,
        y2: targetRect.top + targetRect.height / 2 - containerRect.top,
      });
    }
    setArrows(next);
  }, [taskLinks, rows.items]);
  ```

  Y en el JSX, asignar `bodyRef` al contenedor `.gantt-body`, pasar
  `barRef={(el) => { if (el) barRefs.current.set(task.id, el); else barRefs.current.delete(task.id); }}`
  a cada `<GanttRow>`, y agregar la capa SVG superpuesta:

  ```tsx
  <div className="gantt-body" ref={bodyRef} style={{ position: "relative" }}>
    {/* ... contenido existente (today-tag, today-line, GanttRow.map) ... */}
    <svg
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      aria-hidden="true"
    >
      <defs>
        <marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--muted)" />
        </marker>
      </defs>
      {arrows.map((a) => (
        <line
          key={a.id}
          x1={a.x1}
          y1={a.y1}
          x2={a.x2}
          y2={a.y2}
          stroke="var(--muted)"
          strokeWidth="1.5"
          markerEnd="url(#gantt-arrow)"
        />
      ))}
    </svg>
  </div>
  ```

  Actualizar también la llamada a `<GanttRow>` existente para pasar
  `barRef`.

- [ ] **Paso 3: Verificar tipos y build completo**

  ```bash
  npx tsc --noEmit
  npm run build
  npm test -- --silent
  ```

- [ ] **Paso 4: Verificación manual en navegador**

  1. Crear 2 tareas con fecha de vencimiento dentro de la ventana de 14
     días del Gantt.
  2. Desde el modal de una de ellas, crear una dependencia "bloqueada por"
     apuntando a la otra.
  3. Abrir la vista Gantt y confirmar que aparece una flecha conectando el
     final de la barra bloqueadora con el inicio de la barra bloqueada.
  4. Redimensionar la ventana del navegador y confirmar que la flecha se
     recalcula (o al menos no queda visualmente rota — si no se recalcula
     con un listener de `resize`, dejarlo como limitación conocida y
     anotarlo en el reporte, no bloquear la tarea por esto).

- [ ] **Paso 5: Commit**

  ```bash
  git add src/lib/supabase/task-links-repo.ts src/components/GanttView.tsx
  git commit -m "$(cat <<'EOF'
  feat: flechas de dependencia conectadas en la vista Gantt

  task_links (tipo "blocks") ahora se dibujan como flechas SVG entre
  las barras del Gantt cuando ambas tareas están en la ventana visible,
  usando getBoundingClientRect() sobre refs por fila (el Gantt no tenía
  coordenadas absolutas, solo CSS grid). Solo visualización — sin
  cambios de esquema ni backend nuevo.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Autorrevisión

- **Cobertura del spec:** las 3 tareas de deuda técnica y las 4 features
  del diseño 2026-09-13 están cubiertas, una tarea por ítem salvo el
  burndown (dividido en backend/Tarea 5 y UI/Tarea 6 porque cada una tiene
  su propio ciclo de test independiente).
- **Sin placeholders:** cada tarea de código tiene archivos exactos y
  código completo. Las únicas verificaciones manuales explícitas (no
  automatizadas) son D1 (script bash) y las partes de UI donde no existe
  ya un patrón de test de componente en este proyecto (no se inventa uno
  nuevo para este plan).
- **Consistencia de tipos:** `SuggestedTaskFields`/`BurndownPoint`/
  `TaskLink` se definen en la tarea que los produce y se consumen sin
  cambios en la tarea siguiente que los usa.
- **Riesgo de mayor incertidumbre:** Tarea 8 (Paso 2) depende de medir DOM
  con `getBoundingClientRect()` tras el render — es el punto del plan con
  más probabilidad de necesitar ajuste durante la implementación (p. ej.
  si el layout real no coincide exactamente con lo asumido aquí); el
  resto de la tarea (fetch de links, filtrado cliente) no depende de esa
  incertidumbre y puede seguir aunque el ajuste visual tome una ronda
  extra.
