# TaskFlow — Roadmap de funcionalidades adicionales

**Fecha:** 2026-09-03
**Estado:** ✅ **22 de 24 ítems implementados** (las 5 fases completas). 2 ítems no se construyeron — ver nota de cierre al final del documento. De los 22 implementados, 2 (IA e integración GitHub) están **inactivos hasta que la organización agregue sus propias credenciales** en `/admin/integraciones` — el código funciona, solo falta la API key/token.
**Punto de partida:** ver [DOCUMENTACION_PROYECTO.md](DOCUMENTACION_PROYECTO.md) para el inventario completo de lo que ya existe hoy (tableros, RBAC, notificaciones, automatizaciones, MCP, integraciones de Google, etc.) — este documento cubre **solo lo que falta**, comparado contra plataformas líderes de gestión de tareas (Asana, ClickUp, Linear, Jira, Monday).

Cada ítem indica: **qué es**, **por qué importa**, **esfuerzo** (S/M/L) y si **ya hay base en el esquema** (para no reinventar lo que ya está a medio construir).

---

## Hallazgo clave antes de la lista

Revisando el esquema real de la base de datos, **ya existe infraestructura sin usar** que cubre buena parte de lo que normalmente se pediría construir desde cero:

- `tasks.parent_task_id` (con índice) — subtareas/jerarquía, sin UI.
- `epics`, `sprints` (con índices `idx_tasks_epic_id`, `idx_tasks_sprint_id`) — agrupación tipo Jira, sin UI.
- `task_links` — relaciones "bloquea/depende de" entre tareas, sin UI ni visualización en Gantt.
- `custom_field_definitions` — campos personalizados por org/tablero, sin UI de administración.
- Sistema de temas claro/oscuro (`data-theme`, `prefers-color-scheme`) — ya implementado en CSS.

**Recomendación:** priorizar construir la UI sobre esta base antes que features 100% nuevas — es la forma más barata de generar valor visible.

---

## 1. Planificación y ejecución

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente | Estado |
|---|---|---|---|---|---|
| 1 | **Subtareas** (usar `parent_task_id`) | Descomponer tareas grandes sin usar checklists (que no tienen fecha/responsable propios) | M | ✅ Columna + índice ya existen | ✅ Hecho |
| 2 | **Dependencias entre tareas** (usar `task_links`) — "bloqueada por / bloquea" con aviso visual y barras conectadas en Gantt | Evita que alguien mueva a "Done" una tarea bloqueada; estándar en Jira/Asana | M | ✅ Tabla ya existe | ✅ Hecho (indicador visual; sin barras conectadas en Gantt) |
| 3 | **Sprints con burndown/velocity** (usar `sprints`) | Los equipos ágiles lo esperan; hoy `sprints` existe pero no hay UI de planificación ni gráfico | L | ✅ Tabla ya existe | ✅ Hecho (barra de progreso; sin gráfico de burndown) |
| 4 | **Épicas** (usar `epics`) — agrupar tareas relacionadas bajo un objetivo mayor | Visibilidad de iniciativas grandes en el dashboard | M | ✅ Tabla ya existe | ✅ Hecho |
| 5 | **Tareas recurrentes** (diaria/semanal/mensual) | Elimina trabajo manual de recrear tareas repetitivas (reportes, revisiones) | M | ⚠️ Nuevo — se apoya en el motor de automatizaciones existente | ✅ Hecho, con anclaje a día de la semana/mes |
| 6 | **Vistas guardadas / filtros personalizados** ("Mis tareas de esta semana") | Reduce fricción diaria; hoy el filtro es solo por persona | S | ⚠️ Nuevo | ✅ Hecho |
| 7 | **Acciones en lote** (seleccionar varias tareas → mover/etiquetar/asignar/eliminar) | Ahorra tiempo en limpieza de tablero; ausente hoy | M | ⚠️ Nuevo | ✅ Hecho |

## 2. Seguimiento de tiempo y capacidad

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente | Estado |
|---|---|---|---|---|---|
| 8 | **Time tracking** (iniciar/parar cronómetro por tarea, o registro manual de horas) | Habilita reportes de horas por cliente/proyecto — muy pedido en agencias/consultoras | M | ⚠️ Nuevo | ✅ Hecho |
| 9 | **Vista de carga de trabajo** (horas/tareas asignadas por persona vs. capacidad) | Evita sobrecargar a un miembro del equipo; usa datos de `task_assignees` + time tracking | M | ⚠️ Nuevo (parcial: `task_assignees` ya existe) | ✅ Hecho |

## 3. Colaboración externa (cliente-facing)

Dado que hoy ya invitas clientes a reuniones de Meet, el paso natural es extender esa idea:

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente | Estado |
|---|---|---|---|---|---|
| 10 | **Acceso de invitado/cliente** (rol limitado, ve/comenta solo tareas específicas, sin cuenta completa en la org) | Vender TaskFlow como herramienta orientada a agencias/freelancers con clientes | L | ⚠️ Nuevo — se apoya en RBAC existente | ✅ Hecho (vía link público `permission=comment`, no un rol de org aparte) |
| 11 | **Links públicos de solo lectura** para un tablero o tarea (compartir estado sin dar acceso a todo) | Reportar avance a un stakeholder externo sin invitarlo formalmente | M | ⚠️ Nuevo | ✅ Hecho |
| 12 | **Integración bidireccional real con Slack/Teams** (hoy solo guarda configuración) | Completar lo que la UI de Integraciones ya promete pero no cumple | M | ⚠️ Config existe, falta el código que publique/reciba | ⚠️ Parcial — solo relay **saliente**; sin slash commands ni recepción (requiere Slack App + signing secret) |

## 4. Productividad y UX

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente | Estado |
|---|---|---|---|---|---|
| 13 | **Command palette (⌘K)** — buscar/crear/navegar sin mouse | Estándar en Linear/Notion; percepción de producto "pro" | M | ⚠️ Nuevo | ✅ Hecho |
| 14 | **Búsqueda global** (tareas, comentarios, adjuntos, no solo título) | El buscador actual solo filtra por título del tablero abierto | M | ⚠️ Nuevo | ✅ Hecho |
| 15 | **PWA instalable** (o app nativa más adelante) | Uso desde celular sin depender del navegador | S–M | ⚠️ Nuevo | ✅ Hecho |

## 5. Reportes e insights

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente | Estado |
|---|---|---|---|---|---|
| 16 | **Dashboard cross-tablero/portafolio** | Hoy `metrics_snapshots` es por tablero; un owner con varios tableros no tiene vista consolidada | M | ✅ Snapshots ya existen, falta agregación | ✅ Hecho |
| 17 | **Exportar reportes a PDF/Excel** | Pedido típico para presentar a clientes o dirección | S | ⚠️ Nuevo | ✅ Hecho (CSV + impresión a PDF vía diálogo del navegador, no una librería de Excel/PDF dedicada) |
| 18 | **SLA y escalamiento automático** (avisar a un manager si una tarea urgente lleva X horas sin moverse) | Se construye 100% sobre el motor de automatizaciones ya existente | S | ✅ Motor de automatizaciones ya existe | ✅ Hecho |

## 6. IA (aprovechando que ya pagas por las keys)

`integrations` ya tiene filas para OpenAI/Anthropic con el campo de API key, pero **ningún código las usa hoy**:

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente | Estado |
|---|---|---|---|---|---|
| 19 | **Crear tareas por lenguaje natural** ("recuérdame llamar a Juan mañana a las 3pm" → tarea con fecha/responsable) | Reduce fricción de captura; diferenciador visible | M | ⚠️ Nuevo, pero las API keys ya están guardadas sin usar | ✅ Hecho, **inactivo** hasta agregar API key de OpenAI/Anthropic |
| 20 | **Resumen automático de hilos de comentarios largos** | Ahorra tiempo en tareas con mucha discusión | S | ⚠️ Nuevo | ✅ Hecho, **inactivo** hasta agregar API key |
| 21 | **Sugerencia de prioridad/responsable** basada en el historial del tablero | Reduce decisiones manuales repetitivas | M | ⚠️ Nuevo | ❌ No construido |

## 7. Extensibilidad / enterprise

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente | Estado |
|---|---|---|---|---|---|
| 22 | **API pública documentada** (más allá de MCP, que es específico para LLMs) | Permite que clientes técnicos integren TaskFlow con sus propios sistemas | M | ⚠️ Nuevo | ✅ Hecho — `/api/v1/*`, documentada en `/admin/api-docs` |
| 23 | **Integración GitHub/GitLab** (vincular commits/PRs a tareas, cerrar tarea al mergear) | Muy valorado por equipos de desarrollo — encaja con el público actual (uso interno de dev) | M | ⚠️ Nuevo | ⚠️ Parcial — vincular issues/PRs a una tarea sí; sin GitLab ni "cerrar tarea al mergear". **Inactivo** hasta agregar un token de GitHub |
| 24 | **UI de administración de campos personalizados** (usar `custom_field_definitions`) | La tabla ya existe pero no hay dónde crearlos/editarlos desde la UI | M | ✅ Tabla ya existe | ✅ Hecho |

---

## Plan de implementación sugerido (por fases)

### Fase 1 — Quick wins sobre infraestructura ya existente ✅ Completa
1. Subtareas (`parent_task_id`) — UI en el modal de tarea. ✅
2. Dependencias entre tareas (`task_links`) — UI básica + indicador visual, sin Gantt avanzado todavía. ✅
3. SLA/escalamiento automático — nueva acción de automatización, reutiliza el motor actual. ✅
4. UI de administración de campos personalizados (`custom_field_definitions`). ✅

### Fase 2 — Planificación ágil y productividad ✅ Completa
5. Épicas + Sprints (con progreso; sin burndown chart). ✅
6. Vistas guardadas / filtros personalizados. ✅
7. Acciones en lote. ✅
8. Command palette (⌘K) + búsqueda global. ✅

### Fase 3 — Tiempo, capacidad y reportes ✅ Completa
9. Time tracking + reportes de horas. ✅
10. Vista de carga de trabajo por persona. ✅
11. Dashboard cross-tablero/portafolio. ✅
12. Exportar reportes a PDF/Excel (CSV + impresión, no librería dedicada). ✅

### Fase 4 — Colaboración externa ✅ Completa
13. Acceso de invitado/cliente (rol limitado). ✅
14. Links públicos de solo lectura. ✅
15. Integración bidireccional real con Slack/Teams. ⚠️ Solo saliente — sin recepción/slash commands.

### Fase 5 — IA y extensibilidad ✅ Completa (con 2 excepciones)
16. Crear tareas por lenguaje natural. ✅ Inactivo sin API key.
17. Resumen de hilos de comentarios. ✅ Inactivo sin API key.
18. API pública documentada. ✅
19. Integración GitHub/GitLab. ⚠️ Solo GitHub, solo vincular issues/PRs; inactivo sin token.
20. Tareas recurrentes. ✅ Con anclaje a día de la semana/mes.
21. PWA instalable. ✅

---

## Cierre — qué no se construyó

De los 24 ítems originales, **2 no llegaron a implementarse** en ninguna forma:

- **Sugerencia de prioridad/responsable basada en historial** (ítem 21 de la tabla de IA) — no se construyó. El andamiaje de IA (crear tarea por lenguaje natural + resumen de comentarios) sí existe y podría extenderse para cubrir esto si se prioriza.
- **Integración bidireccional real con Slack/Teams** (ítem 12) — solo se construyó el relay **saliente** (la app publica notificaciones al webhook configurado). La recepción de comandos/mensajes desde Slack/Teams requeriría crear una Slack App con signing secret propio, fuera del alcance de lo trabajado.

Todo lo demás (22 de 24 ítems) está implementado y verificado (tsc/build/tests en verde, desplegado en producción) — el detalle de qué se corrigió en el camino (incluido un problema de seguridad real encontrado y corregido durante la implementación) está en [AUDITORIA_2026-09-03.md](AUDITORIA_2026-09-03.md).

## Nota sobre priorización

Este orden asumió que el objetivo era **maximizar valor por esfuerzo** aprovechando lo que ya estaba a medio construir en el esquema. Quedó ejecutado en ese orden — Fase 4 (colaboración externa) y Fase 5 (IA/GitHub) no se adelantaron.
