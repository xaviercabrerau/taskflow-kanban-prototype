# Auditoría completa — TaskFlow Kanban Prototype

**Fecha:** 2026-08-28 / 2026-08-29
**Alcance:** solo `taskflow-kanban-prototype` (no otros proyectos en `~/Claude/`)
**Método:** 5 agentes especializados en paralelo (arquitectura, rendimiento, accesibilidad, cobertura de tests, salud de dependencias) + verificación en vivo de los hallazgos críticos contra producción (`https://task.conto.ec`).

Esta auditoría es adicional a la auditoría de seguridad/base de datos ya realizada antes en la misma sesión (RLS, migraciones, endpoint MCP, webhook de Gmail) — ver el historial de commits para esa parte. Aquí se cubre lo que esa auditoría no tocó: arquitectura, rendimiento, accesibilidad, tests y dependencias.

---

## 🔴 Bugs críticos encontrados y corregidos durante esta auditoría

Estos dos bugs fueron introducidos en la sesión anterior (integración de notificaciones) y **invalidaban la verificación "end-to-end" que se había dado por buena entonces**. Se encontraron gracias al agente de arquitectura y se corrigieron y volvieron a verificar con evidencia real (logs de Vercel, no solo "200 sin error").

### 1. Los triggers nunca activaban un envío de email real (desajuste de nombre de campo)

Los triggers de Postgres enviaban `eventType` en el payload del webhook, pero `validateEvent()` en `notify.ts` exige `type`. Como la ruta interna siempre devuelve `200 {"processed":true}` por diseño (best-effort), la validación fallaba en silencio — sin email, sin fila en `failed_jobs`, sin error visible. La "verificación en vivo" original interpretó "200 + sin fallos registrados" como éxito, cuando en realidad era la señal de este mismo fallo silencioso.

**Fix:** migración `20260828200000` (aplicada en vivo), cambia la clave del payload de `eventType` a `type` en ambos triggers.

### 2. `actorId`/`taskId` nulos se rechazaban como inválidos

Al volver a probar tras el fix #1, apareció un segundo bug: `validateEvent` solo trataba `undefined` como "campo opcional ausente", pero un trigger disparado sin sesión autenticada (`auth.uid()` nulo — el caso de cualquier inserción vía rol de servicio, o un comentario generado por una automatización) envía `actorId: null` explícito, que la validación rechazaba como "no es un UUID válido".

**Fix:** commit `2d4206f` — `validateEvent` ahora trata `null` igual que `undefined` para estos dos campos opcionales. Se agregó un test de regresión.

### Verificación real (no repetir el error anterior)

Tras ambos fixes, se probó de nuevo insertando una mención real y se revisaron los **logs de función de Vercel** (no solo el código HTTP):

- Con destinatario de prueba (`xcabrera.taskflow.qa2@gmail.com`): Resend rechazó el envío con `403 — solo se puede enviar a la dirección del dueño de la cuenta en modo sandbox`, y esta vez **sí quedó registrado correctamente en `failed_jobs`** — el manejo de errores funciona.
- Con destinatario válido para el sandbox (la dirección del dueño de la cuenta, `xaviercabrerau@gmail.com`): el envío se completó sin errores, confirmado por ausencia de nuevas filas en `failed_jobs` y por el log de nivel `info` (no `error`) en Vercel.

**Conclusión:** el pipeline de notificaciones (validación → preferencias → render de plantilla → envío por Resend → registro in-app → registro de fallos) funciona correctamente de punta a punta. El único bloqueo restante es que **la cuenta de Resend no tiene un dominio verificado**, así que solo puede enviar a la dirección del propio dueño de la cuenta hasta que se verifique un dominio en resend.com/domains — no es un bug, es un paso de configuración pendiente.

---

## 🏗️ Arquitectura y calidad de código

### Alto
1. **`BoardContext.tsx` es un god-object** (~1080 líneas, ~20 dominios distintos: tareas, workspaces, miembros, notificaciones, automatizaciones, webhooks, sesiones MCP, roles/permisos, auditoría, plantillas, integraciones) en un único `useMemo` con ~40 campos. Cualquier cambio en cualquiera de esos dominios re-renderiza a todo consumidor del contexto, sin importar qué parte del estado le interese.

### Medio
2. **Sin paginación en la carga de tareas del tablero** — `fetchBoardState` trae todas las tareas/columnas sin `.limit()`. Bien para el volumen actual, se vuelve un problema con más tenants/tareas.
3. **Refetch completo del tablero en cada evento de tiempo real** — cualquier cambio de cualquier usuario dispara un refetch completo (sin merge fino), ya reconocido como simplificación deliberada en el propio código, pero es el techo de escalabilidad más concreto del proyecto.
4. **Código muerto que arrastra dependencias pesadas**: `src/lib/notifications/gmail.ts` (con su propia implementación de envío de email) no se usa en ningún lado excepto su propio test — el envío real va por `resend-client.ts`. `googleapis`/`google-auth-library` (dependencias grandes) solo existen en `package.json` por este archivo muerto.
5. **El patrón "mutaciones desde el cliente + efectos secundarios vía triggers en el servidor" no está documentado** — es una decisión de arquitectura sólida (mantiene RLS como única frontera de autorización) pero nada impide que un futuro colaborador llame a `sendNotification`/la ruta interna directamente desde el cliente al conectar los 6 tipos de evento que faltan.

### Bajo / fortalezas confirmadas
6. Manejo de errores con un patrón consistente por categoría (mutaciones optimistas vs. formularios discretos) — no es inconsistencia real, parece intencional.
7. **Buena base de type-safety**: prácticamente cero `any` fuera de archivos de test; los pocos `as unknown as X` están bien justificados.
8. **La capa de repos (`src/lib/supabase/*-repo.ts`) está limpia** — mapeo de filas y llamadas delgadas a Supabase, sin lógica de negocio filtrada. Mantener esta disciplina al crecer.

---

## ⚡ Rendimiento

### Alto
1. **~13 fetches en paralelo en cada carga de sesión**, la mayoría de datos solo para pantallas `/admin/*` (roles, permisos, auditoría, sesiones MCP, webhooks, automatizaciones, integraciones, plantillas) que la mayoría de usuarios nunca ve. Recomendación: cargar estos datos de forma perezosa cuando se monte la sección admin, no en el `BoardProvider` global.
2. **Sin memoización en el árbol de renderizado** — escribir en el buscador re-renderiza cada columna y cada tarjeta del tablero (100+ re-renders por tecla en un tablero con 100+ tareas), porque `Board.tsx` recalcula arrays nuevos por columna en cada render y ni `Column` ni `TaskCard` están envueltos en `React.memo`.

### Medio
3. Reconciliación de tiempo real vía refetch completo (ver arquitectura #3) — no urgente hoy, sí un techo de escalabilidad.
4. Falta un índice compuesto `(user_id, created_at desc)` en `notifications` — el único índice existente cubre `read_at`, no el orden usado por `fetchNotifications`.

### Verificado como correcto (no son problemas)
- `googleapis`/`google-auth-library` **no** se filtran al bundle de cliente (confirmado inspeccionando el build real).
- Sin patrones O(n²) en el drag-and-drop; usa indexación fraccional, correcto.
- Sin fugas de suscripciones de Realtime — limpieza correcta en ambos hooks.
- Sin oportunidad de optimización de imágenes (la UI no usa imágenes, solo iniciales de texto).
- Cobertura de índices en la ruta de lectura principal del tablero: buena.

---

## ♿ Accesibilidad (WCAG 2.2)

### Crítico
1. **El panel de notificaciones no tiene semántica de diálogo** — sin `role="dialog"`, sin manejo de foco, sin cierre con Escape, sin `aria-expanded` en el botón que lo abre.
2. **Los chips de prioridad fallan el contraste AA en tema claro** — alta ≈3.6:1, media ≈3.0:1, baja ≈4.3:1 (el mínimo es 4.5:1). Afecta tarjetas, tabla y calendario.

### Alto
3. Mensajes de error de formularios no se anuncian ni se asocian a los campos (`TaskModal.tsx`, `MfaAalGate.tsx`).
4. El resultado de arrastrar una tarea no se anuncia de forma útil — dnd-kit usa sus anuncios por defecto en inglés en una app en español, sin mencionar la columna destino.
5. El dropdown de menciones (@nombre) en comentarios es **solo con mouse** — no se puede navegar ni seleccionar con teclado.

### Medio
6. Las pantallas de bloqueo por MFA obligatorio no usan el hook de accesibilidad de diálogos que sí usa el resto de modales — son las menos accesibles de toda la app, justo las que bloquean el acceso completo.
7. Texto secundario silenciado (`--muted`) falla contraste sobre `--surface-2` (≈4.2:1).
8. Sin landmark `<main>` ni encabezado de página ni skip-link — hay que tabular por toda la barra superior en cada ruta.

### Bajo
9. El estado "vencida" se transmite solo por color en tarjetas/tabla (sí tiene etiqueta de texto en el modal, pero no ahí).
10. Los 14 botones de la barra superior no están agrupados bajo ningún landmark/`role="toolbar"`.

### Verificado como correcto
- El fix del handle de arrastre en `TaskCard.tsx` sigue funcionando correctamente, sin regresión.
- `useDialogA11y` es sólido y se usa consistentemente en casi todos los modales (la excepción son los hallazgos #1 y #6 arriba).
- Tabla/Gantt/Calendario usan `useClickableRow` correctamente.

---

## 🧪 Cobertura y calidad de tests

- **234 tests, 11 suites, todos pasan** — pero la cobertura real es de solo **22.8% de sentencias**.
- **Cero tests** para cualquier componente de React (`Board.tsx`, `TaskCard.tsx`, modales), para `BoardContext.tsx`, y para los 19 archivos de `src/lib/supabase/*-repo.ts`.
- `testing/3-integration-tests-enhanced.test.ts` (que dice tener "20+ tests de integración" incluyendo aislamiento por RLS y concurrencia) **nunca se ejecuta** — vive fuera de `src/`, fuera del `roots` configurado en `jest.config.ts`. Da una falsa sensación de cobertura.

### Hallazgos priorizados
1. **(Crítico)** `notifications-repo.ts` no tiene tests — el mismo tipo de bug que ya mordió a este proyecto (`read` vs `read_at`) no habría sido detectado por nada.
2. **(Crítico)** El archivo de tests de integración no está conectado a Jest — o se mueve a `src/**/__tests__/` o se elimina/reetiqueta como documentación.
3. **(Crítico)** La lógica anti-condición-de-carrera de `BoardContext.tsx` (`loadRequestIdRef`) no tiene ningún test.
4. **(Alto)** `nextPosition` (cálculo de posición para drag-and-drop) es una función pura, trivial de testear, con cero tests — la más barata y valiosa de agregar.
5. **(Alto)** Los 19 archivos de repos de Supabase no tienen tests de "forma" que detecten un cambio de nombre de columna/tabla.
6. **(Medio)** El patrón de mocking (`jest.fn().mockReturnThis()` genérico, sin tipar contra `Database`) hace que el desajuste de esquema sea estructuralmente invisible en toda la suite — exactamente la causa raíz por la que el bug de `read`/`read_at` no se detectó antes.
7. **(Medio)** Dos tests en `admin/users/route.test.ts` están vacíos (sin `expect()`) pese a inflar el conteo de tests.
8. **(Bajo, positivo)** `jwt.test.ts` y `templates.test.ts` son ejemplos de buena cobertura real (no solo "no truena") — buen modelo a replicar en repos/contexto.

---

## 📦 Dependencias y salud del build

- `npx tsc --noEmit`, `npx eslint`, `npx jest` — **los tres limpios**.
- `npm audit --production`: **4 vulnerabilidades moderadas** (`uuid`, vía `googleapis`→`gaxios`), sin fix no disruptivo disponible — requeriría saltar `googleapis` de 140 a 176 (36 versiones mayores). No urgente, sí a programar.
- **Sin dependencias no utilizadas** más allá de las ya removidas esta sesión (`bullmq`, `@vercel/kv`, `ioredis`).
- Actualizaciones menores seguras disponibles: `next`, `@sentry/nextjs`, `@supabase/*`, `eslint-config-next`.
- Actualizaciones mayores pendientes de revisión: `googleapis`, `google-auth-library`, `jest` 29→30, `typescript` 5→7, `resend` 4→6, `eslint` 9→10.
- **Sin `.nvmrc` ni campo `engines` en `package.json`** — nada garantiza consistencia entre el Node local (v25), el runtime de Vercel (24.x) y `@types/node` (todavía en `^20`). Recomendado: fijar `engines.node` y actualizar `@types/node`.
- Sin conflictos de versiones duplicadas que lleguen al bundle de producción.

---

## Resumen ejecutivo — qué priorizar después

1. ~~Los dos bugs críticos de notificaciones~~ — **ya corregidos y verificados en esta misma auditoría.**
2. **Verificar un dominio en Resend** para poder enviar a destinatarios reales (bloqueante para que las notificaciones sirvan de algo en producción).
3. Memoización de `TaskCard`/`Column` + diferir los fetches solo-admin de `BoardContext` (rendimiento, alto impacto, bajo esfuerzo).
4. Tests para `notifications-repo.ts`, `nextPosition`, y la lógica de condición de carrera de `BoardContext` (cobertura, previene regresiones del mismo tipo que ya ocurrieron).
5. Panel de notificaciones y contraste de chips de prioridad (accesibilidad, alto impacto, esfuerzo moderado).
6. Documentar la convención "efectos secundarios van en triggers/servidor, no en el cliente" antes de conectar los 6 tipos de evento de notificación restantes.

---
---

# Actualización — Auditoría de seguridad, infraestructura y esquema

**Fecha:** 2026-08-30 / 2026-08-31
**Alcance:** producción (`https://task.conto.ec`, Supabase `txdyijyswpsalqnwfopc`) — seguridad de código, seguridad de base de datos (RLS/advisors en vivo), infraestructura de despliegue (Vercel/DNS/env vars/cron), y esquema.
**Método:** 4 agentes especializados en paralelo (seguridad, calidad de código, base de datos, infraestructura/devops) + verificación en vivo directa (Supabase `get_advisors`, `vercel inspect`, `curl` contra producción) para cada hallazgo antes de reportarlo.

**Contexto ya cubierto en la misma sesión, antes de esta auditoría:** un bug real de producción (`mcp_list_tasks` con columna `id` ambigua — RETURNS TABLE colisionaba con un nombre de columna real, rompiendo esa herramienta de MCP en el 100% de las llamadas) fue descubierto probando en vivo un token MCP real, diagnosticado, corregido (migración `20260830210000`) y re-verificado en vivo.

## 🔴 Hallazgos corregidos durante esta auditoría (ya en producción)

1. **`forward-email` sin rate limiting (Importante).** Cualquier miembro autenticado de la org podía llamar este endpoint repetidamente para enviar correos arbitrarios desde el Gmail conectado de la org — riesgo real de que Google marque/limite la cuenta de la org por abuso. **Fix:** ahora usa el mismo limitador (Upstash) que ya protegía `/api/mcp`, con clave por usuario (`forward-email:{userId}`).
2. **`drive-attachment` sin rate limiting, y sin límite de tamaño en el batch de `fileIds` (Importante).** El endpoint podía recibir un array de cualquier tamaño, disparando un `Promise.all` sin límite de llamadas a la API de Drive más un insert por archivo. **Fix:** mismo rate limiting por usuario, más un tope explícito de 25 archivos por request (acorde al uso real del selector múltiple de Drive).
3. Ambos fixes verificados: `tsc --noEmit` limpio, `npm run build` limpio, **199/199 tests pasan**, commit `813a35f`, empujado a `origin/main` y desplegado a producción (`vercel deploy --prod`), `curl https://task.conto.ec/api/health` confirma `200 {"status":"ok"}` post-deploy.

## 🗄️ Base de datos — hallazgo de más alto valor: la clase de bug de `mcp_list_tasks` no se repite

Se inventariaron **todas** las funciones `RETURNS TABLE` del esquema (13 en migraciones) buscando específicamente la misma colisión (un nombre de parámetro OUT que choca con una columna real referenciada sin calificar dentro de la misma función). **Confirmado: ninguna otra función tiene este bug.** `mcp_list_tasks` ya está corregida y re-verificada en vivo. Recomendación de proceso (Menor, no bloqueante): agregar un checklist de revisión que marque esta clase de bug en cualquier función `plpgsql` nueva con `RETURNS TABLE`.

### Hallazgos en vivo vía Supabase Advisors (ejecutado directamente, no solo análisis estático)

- **Auth (Importante):** protección contra contraseñas filtradas (HaveIBeenPwned) está **deshabilitada** — activar en Supabase Auth settings.
- **RLS sin política (Menor):** `failed_jobs` y `template_installs` tienen RLS habilitado pero **sin ninguna política** — en la práctica esto las bloquea por completo salvo acceso `service_role`, lo cual puede ser intencional (son tablas internas), pero vale confirmarlo explícitamente en vez de dejarlo implícito.
- **Funciones `SECURITY DEFINER` invocables por `anon`/`authenticated` (Informativo, ya revisado):** ~25 funciones (`mcp_*`, `create_inbound_webhook`, `ingest_webhook_task`, `has_permission*`, etc.) aparecen en el linter como "cualquiera puede invocarlas". Todas están diseñadas así a propósito — validan su propio token/secreto internamente (MCP PAT, secreto de webhook) en vez de depender de la sesión de Postgres — no son un hallazgo nuevo, solo ruido esperado del linter para este patrón de arquitectura.
- **Rendimiento (Menor, no urgente):** 4 foreign keys sin índice de cobertura (`email_threads.user_id`, `notification_preferences.organization_id`, `notifications.actor_id`, `template_installs.user_id`); ~30 índices sin uso registrado (candidatos a revisión, no necesariamente a eliminar — el tráfico real aún es bajo); una política RLS en `profiles` que re-evalúa `auth.<function>()` por fila en vez de usar `(select auth.<function>())`.

## 🚀 Infraestructura y despliegue

### Confirmado sano (verificado en vivo, no solo "está configurado")
- El despliegue automático GitHub→Vercel **sí funciona** — se correlacionaron timestamps de commits vs. despliegues (diferencia de 4-10 segundos). El drift que existía durante esta sesión era simplemente **10 commits locales sin `git push`**, no una falla del pipeline — ya resuelto (push + `vercel deploy --prod` verificado, `task.conto.ec` sirve el código actual).
- `Root Directory` de Vercel confirmado en `.` (el bug que rompió despliegues 10+ días está genuinamente resuelto).
- DNS/alias de `task.conto.ec` correcto, headers de seguridad y CSP con nonce por request confirmados vía `curl -I` en vivo.
- Rate limiting (Upstash) genuinamente conectado — no solo declarado en código.
- **Los 4 cron jobs de Postgres (pg_cron) confirmados corriendo y exitosos en vivo** vía `/api/health/cron`: `taskflow_check_due_soon_tasks`, `taskflow_execute_due_date_automations`, `purge-expired-audit-logs`, `record-daily-metrics-snapshots` — todos `succeeded`, ninguno `stale`.
- Sin banderas riesgosas en `next.config.ts` (sin `ignoreBuildErrors`, sin `images.unoptimized`, sin CORS permisivo).

### Pendiente de acción (requiere decisión/credencial del usuario, no código)
1. **(Importante) Sentry configurado en código pero inactivo en producción** — `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_DSN` no están seteados en Vercel. Hoy, cero errores llegan a Sentry pese a que `instrumentation.ts` está correctamente conectado. Acción: crear un proyecto en Sentry y setear ambos DSN en producción.
2. **(Importante) El cron diario de alertas (`/api/cron/alert-check`, 08:00) no tiene a quién avisar** — `ALERT_WEBHOOK_URL` no está seteado, así que un fallo de salud solo genera un `console.error` que nadie ve. Acción: crear un webhook de Slack/Discord y setear la variable.
3. **(Importante) Variables del Google Drive Picker aún no están en producción** — `NEXT_PUBLIC_GOOGLE_CLIENT_ID` y `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`. El código ya está desplegado (recién empujado); hasta que se configuren, el botón "Elegir de Google Drive" fallará con un error claro al hacer clic (el flujo de pegar un link de Drive sigue funcionando normalmente mientras tanto — no es una regresión, es una función nueva a medio activar). Pendiente: habilitar Picker API + crear API key restringida por referrer en Google Cloud Console (pasos 6-10 del plan `docs/superpowers/plans/2026-08-30-google-drive-picker.md`).
4. **(Menor) `NOTIFICATION_FROM_EMAIL` no está seteada** — cae en el dominio compartido de pruebas de Resend (`onboarding@resend.dev`), pensado solo para testing. Acción: verificar un dominio propio en Resend y setear la variable.
5. **(Menor) `NEXT_PUBLIC_SITE_URL` está seteada en Vercel pero no la usa ningún código** (el código real usa `NEXT_PUBLIC_APP_URL`) — candidata a limpieza.

## 🔒 Deuda de seguridad ya conocida, aún sin resolver

- **`ForwardTaskTemplate`** (correo HTML con marca TaskFlow) sigue sin conectarse — `forward-email` todavía envía solo texto plano. Decisión pendiente: terminar de conectarlo o eliminar el código muerto.
- `.env.example` no documenta las nuevas variables `NEXT_PUBLIC_GOOGLE_CLIENT_ID`/`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`.

## Resumen ejecutivo de esta actualización

- **Críticos:** ninguno.
- **Importantes corregidos hoy:** rate limiting + límite de batch en `drive-attachment`/`forward-email` (código, ya en producción); drift de despliegue de 10 commits (ya empujado y desplegado).
- **Importantes pendientes de configuración (no código):** activar Sentry, activar `ALERT_WEBHOOK_URL`, completar la config de Google Cloud para el Drive Picker.
- **Confirmado sano:** ningún otro bug de columna ambigua en `RETURNS TABLE`; ningún secreto expuesto al cliente; el deep-link `?task=` no filtra tareas entre organizaciones; el pipeline de despliegue automático funciona correctamente; los 4 cron jobs de Postgres corren exitosamente.
