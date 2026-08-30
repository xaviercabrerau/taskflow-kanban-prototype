# Diseño: "Reenviar por email" (envío vía Gmail conectado)

## Problema

`src/lib/google/gmail.ts` (`sendViaGmail`) ya existe con este propósito documentado en su propio comentario de cabecera: enviar un email visiblemente desde la cuenta real de Gmail de un usuario (no un remitente genérico `notificaciones@`), para el caso "reenviar esta tarea a un cliente". No está conectado a ningún flujo de la UI — el código existe pero es letra muerta hasta hoy.

## Alcance

Un botón self-service en `TaskModal` para reenviar una tarea por email a un destinatario externo, usando el Gmail conectado de la organización. Fuera de alcance: editar el asunto/cuerpo antes de enviar, adjuntar archivos al email, historial de reenvíos, soporte para organizaciones sin Google conectado (el botón simplemente no aparece).

## Diseño

### 1. Botón condicional en `TaskModal`

`TaskModal` ya consume `useBoard()` (línea 71) y `BoardContext` ya expone `integrations: Integration[]` en su estado. Se agrega:

```ts
const googleConnected = integrations.some(
  (i) => i.provider === "google" && i.hasCredential && i.isActive
);
```

Si `googleConnected` es `false`, no se renderiza nada relacionado a esta feature — sin mensajes de "conecta Google primero", para no ensuciar la UI de organizaciones que no usan esta integración.

Cuando `googleConnected` es `true`, se muestra un botón "📧 Reenviar por email" (mismo estilo `.btn` ya usado). Al hacer clic, se despliega inline (mismo patrón que la sección "Adjuntar de Drive" ya existente en el archivo):

- Input de email destinatario (`type="email"`, requerido).
- Textarea opcional "Nota (opcional)".
- Botón "Enviar" (deshabilitado mientras está en curso).
- Área de feedback: mensaje de éxito o el error tal cual lo devuelve la API.

### 2. Endpoint `POST /api/tasks/[id]/forward-email`

Nuevo archivo `src/app/api/tasks/[id]/forward-email/route.ts`, siguiendo el mismo patrón exacto que `src/app/api/tasks/[id]/drive-attachment/route.ts`:

- Autenticación vía `createServerSupabase()` + `auth.getUser()` → 401 si no hay sesión.
- Body: `{ to: string; note?: string }`. 400 si `to` falta o no es un email con forma válida (chequeo simple, ej. contiene `@`).
- Lookup RLS-scoped de la tarea: `select("id, tenant_id, title, description, priority, due_date")` — si no existe o no pertenece a la organización del caller, 404 (RLS ya lo garantiza, igual que en `drive-attachment`).
- Se arma el cuerpo del email en texto plano:
  ```
  {title}

  {description || "(sin descripción)"}

  Prioridad: {priority}
  Vencimiento: {due_date ? formatted : "sin fecha"}

  {note ? `Nota: ${note}\n\n` : ""}Ver tarea completa: {taskUrl(task.id, task.tenant_id)}
  ```
  Reutiliza `taskUrl` de `src/lib/emails/utils.ts` (ya existe, no se modifica) y `formatDate` del mismo archivo para la fecha.
- Llama `sendViaGmail({ tenantId: task.tenant_id, to, subject: task.title, bodyText })` (ya existe, sin cambios).
- Si `sendViaGmail` lanza (Google no conectado, o Gmail rechaza el envío), se devuelve `502` con el mensaje del error — el mismo patrón de manejo de errores que `drive-attachment/route.ts` usa para `getDriveFileMetadata`.
- Éxito: `200` con `{ ok: true }`.

## Testing

- Unitario: no aplica de forma aislada para el endpoint completo (llama a Gmail API real vía `sendViaGmail`, que ya no tiene test unitario tampoco — es la misma naturaleza que `calendar.ts`/`drive.ts`'s funciones de red). Se valida con verificación manual en vivo: con Google conectado, reenviar una tarea real y confirmar que el email llega con el formato esperado.
- Si se agrega alguna función pura extraíble (ej. una función `buildForwardEmailBody(task, note)` separada de la llamada de red), esa sí se puede cubrir con un test unitario simple — se decide en el plan de implementación si vale la pena extraerla.

## Fuera de alcance (explícito)

- Editar el asunto/cuerpo del email antes de enviar.
- Adjuntar archivos.
- Historial de a quién se reenvió una tarea.
- Mostrar el botón (con mensaje de error) cuando Google no está conectado — se oculta en su lugar.
