# Importación masiva de tareas — Diseño

**Fecha:** 2026-09-08
**Estado:** Aprobado

## Objetivo

Permitir a un owner de organización cargar tareas en lote hacia un tablero
específico, subiendo un archivo `.xlsx`, `.xls` o `.csv` con una fila por
tarea, en vez de crearlas una por una desde el modal de "+ Nueva tarea".

## Alcance

- Nueva página de administración: `/admin/importar-tareas`.
- Descarga de una plantilla `.xlsx` con las cabeceras correctas y una fila
  de ejemplo.
- Subida de archivo, parseo, validación fila por fila, creación de las
  tareas válidas, reporte de errores para las filas inválidas (importación
  parcial, no todo-o-nada — decisión ya tomada con el usuario).
- Fuera de alcance (YAGNI para esta iteración): épicas, sprints, tareas
  padre/subtareas, adjuntos, checklist, o cualquier campo que no esté en
  la tabla de columnas de abajo. Actualizar tareas existentes (esto es
  solo creación de tareas nuevas). Importación asíncrona/en background
  (500 filas es lo bastante chico para procesar en una sola request).

## Ubicación en la UI

Sigue el patrón ya establecido por el resto del panel admin de este
proyecto (páginas en español, componente embebido en
`src/components/`, NO el patrón genérico en inglés encontrado roto en
`/admin/usuarios` esta misma sesión):

- `src/app/admin/importar-tareas/page.tsx` — page shell mínimo, mismo
  patrón que `src/app/admin/tareas-recurrentes/page.tsx`.
- `src/components/ImportTasksPanel.tsx` — el panel real, mismo patrón que
  `RecurringTasksPanel.tsx`.
- Entrada en el sidebar de admin, sección "PRODUCTO", junto a "Tareas
  recurrentes" (confirmar ubicación exacta del array de links al
  implementar).

## Plantilla de importación — cabeceras

| Columna | Obligatorio | Tipo/formato | Notas |
|---|---|---|---|
| Título | Sí | texto | No vacío tras `trim()` |
| Estado | Sí | texto | Debe coincidir, sin distinguir mayúsculas/espacios extra, con el `label` de una columna del tablero elegido |
| Prioridad | No (default `Media`) | uno de: Baja, Media, Alta, Urgente | Case-insensitive; mapea a los valores internos `low/medium/high/urgent` |
| Asignado | No | texto libre | Igual semántica que crear una tarea manualmente — no necesita ser un miembro real de la org |
| Etiqueta | No | texto libre | — |
| Fecha inicio | No | `AAAA-MM-DD` | También acepta fechas nativas de Excel (número de serie) — ver Data flow |
| Fecha vencimiento | No | `AAAA-MM-DD` | Igual que Fecha inicio |

La plantilla se genera con la librería `xlsx` (ver Arquitectura), con una
fila de encabezado y una fila de ejemplo:

```
Título: "Enviar propuesta al cliente"
Estado: "To Do"
Prioridad: "Alta"
Asignado: "Ana Torres"
Etiqueta: "ventas"
Fecha inicio: "2026-09-10"
Fecha vencimiento: "2026-09-15"
```

## Arquitectura

**Librería de parseo:** `xlsx` (SheetJS Community Edition), nueva
dependencia. Lee `.xlsx`, `.xls` y `.csv` con la misma API
(`XLSX.read(buffer)` → `XLSX.utils.sheet_to_json`), corriendo
server-side dentro de la API route — no se agrega al bundle del
cliente.

**Endpoints nuevos:**

1. `GET /api/admin/import-tasks/template`
   - Auth: sesión válida (no requiere ser owner — es solo una plantilla
     sin datos de la organización).
   - Genera el `.xlsx` de la tabla de arriba on-the-fly con `xlsx` y lo
     devuelve con `Content-Disposition: attachment`.

2. `POST /api/admin/import-tasks`
   - Auth: mismo patrón que las rutas admin sensibles corregidas esta
     sesión (`/api/admin/users`, `create-user`, `reset-password`) —
     sesión válida + `organization_members.org_role = 'owner'`,
     verificado server-side con el cliente normal (no requiere
     service-role: todo el trabajo de esta ruta son INSERTs en `tasks`
     dentro del propio tenant del caller, que las políticas RLS ya
     permiten a un miembro con permiso `task.create`).
   - Body: `multipart/form-data` con `file` (el archivo subido) y
     `boardId`.
   - Límite: **500 filas** de datos (sin contar el encabezado) — si el
     archivo trae más, se rechaza todo el archivo con un error claro
     ("Máximo 500 filas por archivo") antes de procesar nada.

## Data flow

1. El cliente sube `file` + `boardId` a `POST /api/admin/import-tasks`.
2. El servidor verifica auth + `org_role = owner`, y que `boardId`
   pertenece a la organización del caller.
3. Se leen las columnas reales del board elegido
   (`board_columns.label`, `id`) para construir el mapa
   `label.toLowerCase().trim() → column_id`.
4. Se parsea el archivo con `xlsx`, se toma la primera hoja, se
   convierte a un array de objetos (una entrada por fila, usando la
   fila de encabezado para las llaves).
5. Por cada fila (1-indexada, sin contar el encabezado, para que el
   número de fila reportado en errores coincida con lo que el usuario
   ve en Excel):
   - `Título`: `trim()`; si queda vacío → error "Título es obligatorio".
   - `Estado`: `trim().toLowerCase()`, buscar en el mapa de columnas; si
     no hay coincidencia → error `Estado "X" no coincide con ninguna
     columna del tablero`.
   - `Prioridad`: si está vacía → `medium`; si no, normalizar
     (`trim().toLowerCase()`) contra el mapa `{baja:low, media:medium,
     alta:high, urgente:urgent}`; si no coincide → error `Prioridad "X"
     no reconocida (usa Baja/Media/Alta/Urgente)`.
   - `Asignado`/`Etiqueta`: `trim()` o `undefined` si vacío, sin
     validación adicional (texto libre).
   - `Fecha inicio`/`Fecha vencimiento`: si viene como número (Excel
     serial date), convertir con `XLSX.SSF.parse_date_code` (o
     equivalente de la librería) a `YYYY-MM-DD`; si viene como string,
     validar con una regex `^\d{4}-\d{2}-\d{2}$`; si no matchea ninguno
     de los dos casos y el campo no está vacío → error `Fecha "X" no
     tiene un formato válido (usa AAAA-MM-DD)`.
   - Filas sin ningún error se acumulan en un array `validRows`; filas
     con error se acumulan en `errors: {row: number, reason: string}[]`
     (una fila puede tener más de un error — reason concatena todos con
     `"; "`).
6. Se calcula la posición de inserción por columna: para cada
   `column_id` que reciba al menos una fila válida, se consulta la
   posición máxima actual de esa columna
   (`select max(position) from tasks where column_id = ...`) una sola
   vez, y luego se asigna posición incremental (`+1, +2, ...`) a las
   filas de `validRows` en el orden en que aparecen en el archivo,
   agrupadas por columna — mismo patrón conceptual que
   `nextPosition()` en `board-repo.ts`, adaptado para insertar varias
   filas de una vez en vez de una entre dos vecinas.
7. Insert en lote (`supabase.from("tasks").insert([...])`, un solo
   INSERT con todas las filas válidas) — todo o nada a nivel de ese
   INSERT (si Postgres rechaza el batch completo por alguna razón no
   prevista arriba, se reporta como error 500 genérico; el caso normal
   es que todas las filas que llegaron a este paso ya pasaron
   validación y el INSERT tiene éxito).
8. Respuesta: `{ created: number, errors: {row: number, reason: string}[] }`.

## UI del panel (`ImportTasksPanel.tsx`)

- Selector de tablero (dropdown, tableros de la organización).
- Botón "Descargar plantilla" (link a `GET
  /api/admin/import-tasks/template`).
- Input de archivo (`accept=".xlsx,.xls,.csv"`).
- Botón "Importar" (deshabilitado sin tablero + archivo elegidos;
  muestra estado "Importando…" mientras espera la respuesta).
- Resultado tras la respuesta:
  - `"${created} tareas creadas correctamente."` si `created > 0`.
  - Si `errors.length > 0`: lista `"Fila ${row}: ${reason}"` por cada
    entrada, en una tabla o lista simple.
  - Si `created === 0 && errors.length === 0`: `"El archivo no tenía
    filas de datos."`

## Manejo de errores (resumen)

- Archivo con formato no reconocido (no es xlsx/xls/csv válido) → error
  claro antes de intentar leer filas: `"No se pudo leer el archivo.
  Verifica que sea .xlsx, .xls o .csv."`.
- Más de 500 filas → rechaza todo el archivo, no procesa nada.
- Fila individual inválida → no bloquea el resto (importación
  parcial), se reporta en la lista de errores.
- `boardId` ausente o no perteneciente a la organización del caller →
  403.
- Caller no es owner → 403 (mismo mensaje que las demás rutas admin:
  "Solo el propietario de la organización puede...").

## Testing

- Tests de la ruta `POST /api/admin/import-tasks` (Jest, mockeando el
  cliente Supabase igual que el resto de rutas admin de esta sesión):
  - 401 sin sesión.
  - 403 si no es owner.
  - 403 si `boardId` no pertenece a la organización.
  - Fila válida se crea correctamente (mock de insert).
  - Fila con título vacío se reporta como error, no bloquea las demás.
  - Fila con "Estado" que no coincide con ninguna columna se reporta
    como error.
  - Fila con prioridad no reconocida se reporta como error.
  - Fila con fecha mal formateada se reporta como error.
  - Archivo con más de 500 filas se rechaza completo.
- Verificación manual en navegador (dev + producción): descargar
  plantilla real, llenarla con 2-3 filas válidas + 1 fila con error a
  propósito, subirla, confirmar que las tareas válidas aparecen en el
  tablero en la columna correcta y que el error se reporta
  correctamente — luego eliminar las tareas de prueba creadas.

## Decisiones ya tomadas con el usuario

- Ubicación: página nueva en Administración (no un botón en el
  tablero).
- Campos: solo los esenciales (sin épicas/sprints/subtareas).
- Manejo de errores: importación parcial (válidas se crean, inválidas
  se reportan) — no todo-o-nada.
