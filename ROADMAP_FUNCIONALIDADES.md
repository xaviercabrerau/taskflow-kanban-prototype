# TaskFlow — Roadmap de funcionalidades adicionales

**Fecha:** 2026-09-03
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

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente |
|---|---|---|---|---|
| 1 | **Subtareas** (usar `parent_task_id`) | Descomponer tareas grandes sin usar checklists (que no tienen fecha/responsable propios) | M | ✅ Columna + índice ya existen |
| 2 | **Dependencias entre tareas** (usar `task_links`) — "bloqueada por / bloquea" con aviso visual y barras conectadas en Gantt | Evita que alguien mueva a "Done" una tarea bloqueada; estándar en Jira/Asana | M | ✅ Tabla ya existe |
| 3 | **Sprints con burndown/velocity** (usar `sprints`) | Los equipos ágiles lo esperan; hoy `sprints` existe pero no hay UI de planificación ni gráfico | L | ✅ Tabla ya existe |
| 4 | **Épicas** (usar `epics`) — agrupar tareas relacionadas bajo un objetivo mayor | Visibilidad de iniciativas grandes en el dashboard | M | ✅ Tabla ya existe |
| 5 | **Tareas recurrentes** (diaria/semanal/mensual) | Elimina trabajo manual de recrear tareas repetitivas (reportes, revisiones) | M | ⚠️ Nuevo — se apoya en el motor de automatizaciones existente |
| 6 | **Vistas guardadas / filtros personalizados** ("Mis tareas de esta semana") | Reduce fricción diaria; hoy el filtro es solo por persona | S | ⚠️ Nuevo |
| 7 | **Acciones en lote** (seleccionar varias tareas → mover/etiquetar/asignar/eliminar) | Ahorra tiempo en limpieza de tablero; ausente hoy | M | ⚠️ Nuevo |

## 2. Seguimiento de tiempo y capacidad

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente |
|---|---|---|---|---|
| 8 | **Time tracking** (iniciar/parar cronómetro por tarea, o registro manual de horas) | Habilita reportes de horas por cliente/proyecto — muy pedido en agencias/consultoras | M | ⚠️ Nuevo |
| 9 | **Vista de carga de trabajo** (horas/tareas asignadas por persona vs. capacidad) | Evita sobrecargar a un miembro del equipo; usa datos de `task_assignees` + time tracking | M | ⚠️ Nuevo (parcial: `task_assignees` ya existe) |

## 3. Colaboración externa (cliente-facing)

Dado que hoy ya invitas clientes a reuniones de Meet, el paso natural es extender esa idea:

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente |
|---|---|---|---|---|
| 10 | **Acceso de invitado/cliente** (rol limitado, ve/comenta solo tareas específicas, sin cuenta completa en la org) | Vender TaskFlow como herramienta orientada a agencias/freelancers con clientes | L | ⚠️ Nuevo — se apoya en RBAC existente |
| 11 | **Links públicos de solo lectura** para un tablero o tarea (compartir estado sin dar acceso a todo) | Reportar avance a un stakeholder externo sin invitarlo formalmente | M | ⚠️ Nuevo |
| 12 | **Integración bidireccional real con Slack/Teams** (hoy solo guarda configuración) | Completar lo que la UI de Integraciones ya promete pero no cumple | M | ⚠️ Config existe, falta el código que publique/reciba |

## 4. Productividad y UX

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente |
|---|---|---|---|---|
| 13 | **Command palette (⌘K)** — buscar/crear/navegar sin mouse | Estándar en Linear/Notion; percepción de producto "pro" | M | ⚠️ Nuevo |
| 14 | **Búsqueda global** (tareas, comentarios, adjuntos, no solo título) | El buscador actual solo filtra por título del tablero abierto | M | ⚠️ Nuevo |
| 15 | **PWA instalable** (o app nativa más adelante) | Uso desde celular sin depender del navegador | S–M | ⚠️ Nuevo |

## 5. Reportes e insights

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente |
|---|---|---|---|---|
| 16 | **Dashboard cross-tablero/portafolio** | Hoy `metrics_snapshots` es por tablero; un owner con varios tableros no tiene vista consolidada | M | ✅ Snapshots ya existen, falta agregación |
| 17 | **Exportar reportes a PDF/Excel** | Pedido típico para presentar a clientes o dirección | S | ⚠️ Nuevo |
| 18 | **SLA y escalamiento automático** (avisar a un manager si una tarea urgente lleva X horas sin moverse) | Se construye 100% sobre el motor de automatizaciones ya existente | S | ✅ Motor de automatizaciones ya existe |

## 6. IA (aprovechando que ya pagas por las keys)

`integrations` ya tiene filas para OpenAI/Anthropic con el campo de API key, pero **ningún código las usa hoy**:

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente |
|---|---|---|---|---|
| 19 | **Crear tareas por lenguaje natural** ("recuérdame llamar a Juan mañana a las 3pm" → tarea con fecha/responsable) | Reduce fricción de captura; diferenciador visible | M | ⚠️ Nuevo, pero las API keys ya están guardadas sin usar |
| 20 | **Resumen automático de hilos de comentarios largos** | Ahorra tiempo en tareas con mucha discusión | S | ⚠️ Nuevo |
| 21 | **Sugerencia de prioridad/responsable** basada en el historial del tablero | Reduce decisiones manuales repetitivas | M | ⚠️ Nuevo |

## 7. Extensibilidad / enterprise

| # | Funcionalidad | Por qué importa | Esfuerzo | Base existente |
|---|---|---|---|---|
| 22 | **API pública documentada** (más allá de MCP, que es específico para LLMs) | Permite que clientes técnicos integren TaskFlow con sus propios sistemas | M | ⚠️ Nuevo |
| 23 | **Integración GitHub/GitLab** (vincular commits/PRs a tareas, cerrar tarea al mergear) | Muy valorado por equipos de desarrollo — encaja con el público actual (uso interno de dev) | M | ⚠️ Nuevo |
| 24 | **UI de administración de campos personalizados** (usar `custom_field_definitions`) | La tabla ya existe pero no hay dónde crearlos/editarlos desde la UI | M | ✅ Tabla ya existe |

---

## Plan de implementación sugerido (por fases)

### Fase 1 — Quick wins sobre infraestructura ya existente (2-3 semanas)
Prioridad: máximo valor visible con menor esfuerzo, porque el esquema ya soporta esto.
1. Subtareas (`parent_task_id`) — UI en el modal de tarea.
2. Dependencias entre tareas (`task_links`) — UI básica + indicador visual, sin Gantt avanzado todavía.
3. SLA/escalamiento automático — nueva acción de automatización, reutiliza el motor actual.
4. UI de administración de campos personalizados (`custom_field_definitions`).

### Fase 2 — Planificación ágil y productividad (4-6 semanas)
5. Épicas + Sprints con burndown/velocity.
6. Vistas guardadas / filtros personalizados.
7. Acciones en lote.
8. Command palette (⌘K) + búsqueda global.

### Fase 3 — Tiempo, capacidad y reportes (4-6 semanas)
9. Time tracking + reportes de horas.
10. Vista de carga de trabajo por persona.
11. Dashboard cross-tablero/portafolio.
12. Exportar reportes a PDF/Excel.

### Fase 4 — Colaboración externa (4-6 semanas)
13. Acceso de invitado/cliente (rol limitado).
14. Links públicos de solo lectura.
15. Integración bidireccional real con Slack/Teams.

### Fase 5 — IA y extensibilidad (continuo, según demanda)
16. Crear tareas por lenguaje natural.
17. Resumen de hilos de comentarios.
18. API pública documentada.
19. Integración GitHub/GitLab.
20. Tareas recurrentes.
21. PWA instalable.

---

## Nota sobre priorización

Este orden asume que el objetivo es **maximizar valor por esfuerzo** aprovechando lo que ya está a medio construir en el esquema. Si el objetivo estratégico es distinto (por ejemplo, vender específicamente a agencias con clientes externos, o a equipos de desarrollo), la Fase 4 (colaboración externa) o la Fase 5 (integración con GitHub) deberían adelantarse — avísame si quieres que reordene el roadmap según un caso de uso objetivo específico.
