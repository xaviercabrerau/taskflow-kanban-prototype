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
