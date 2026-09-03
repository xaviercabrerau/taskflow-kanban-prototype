# Diseño: Integración bidireccional con CRM (Tarea ↔ Ticket/Caso)

Fecha: 2026-09-03
Estado: Diseño validado — pendiente de implementación

## Contexto y objetivo

TaskFlow necesita conectarse con un CRM externo (genérico, no uno específico
como HubSpot/Salesforce de entrada) para sincronizar **tareas de soporte con
tickets/casos del CRM**, en ambas direcciones, evitando loops de
sincronización.

## Modelo de datos: Tarea ↔ Ticket/Caso

Una tarea de TaskFlow representa (o está vinculada a) un ticket/caso del CRM.
El vínculo es el campo `external_ticket_id` en la tarea.

## Base común (necesaria sin importar la opción de implementación elegida)

1. **Migración:** `tasks.external_ticket_id` (nullable, índice único por
   `tenant_id`) — el vínculo tarea↔ticket.
2. **Migración:** `tasks.synced_from_crm_at` (timestamp nullable) — marcador
   anti-loop: se setea cuando una actualización de la tarea vino de un
   webhook entrante del CRM, para que la automatización saliente no la
   reenvíe de vuelta al CRM.
3. **Extender `webhooks_inbound`:** hoy solo crea tareas en un board/columna
   fijo. Se le agrega lógica: si el payload trae `external_ticket_id` y ya
   existe una tarea con ese id en el tenant del token → actualizar en vez de
   crear.
4. **Anti-loop:** la automatización saliente comprueba, antes de disparar,
   si el cambio ocurrió dentro de una ventana corta (~5s) de un
   `synced_from_crm_at` reciente — si es así, omite ese disparo puntual (no
   desactiva la automatización, solo salta el eco).
5. **Confirmar que `/api/v1/tasks` (API pública REST, ya existente) soporta
   filtrar/actualizar por `external_ticket_id`** — necesario para que
   n8n/Zapier (o el adaptador propio) puedan hacer upsert sin buscar la
   tarea por título.

Esta base es compartida por las 3 opciones evaluadas — permite empezar con
una y migrar a otra después sin tocar el resto del sistema.

## Opciones evaluadas

### Opción 1 — n8n como capa intermedia (recomendada)

n8n ya tiene nodos nativos maduros para HubSpot, Salesforce, Pipedrive y
Zoho CRM (trigger + acción), con su propio manejo de OAuth, paginación y
rate-limits — trabajo que de otro modo habría que escribir a mano por cada
CRM. No requiere código nuevo en TaskFlow más allá de la base común.

**Workflow "CRM → TaskFlow" (entrante):**
```
[Trigger: HubSpot Trigger (ticket.creation / ticket.propertyChange)]
        ↓
[Set: mapear campos HubSpot → payload TaskFlow]
        ↓
[HTTP Request: POST https://task.conto.ec/api/webhooks/crm/{token}]
```

**Workflow "TaskFlow → CRM" (saliente):**
```
[Trigger: Webhook (recibe el POST de la acción `webhook` de TaskFlow)]
        ↓
[IF: ¿ya tiene external_ticket_id?]
   → Sí: [HubSpot: Update Ticket]
   → No: [HubSpot: Create Ticket] → [HTTP Request: PATCH /api/v1/tasks/{id}
          guardando external_ticket_id devuelto]
```

**Configuración necesaria en TaskFlow:** una automatización existente con
acción `webhook` apuntando a la URL del segundo workflow, y el webhook
entrante de la base común para el primero.

**Ventaja:** cambiar de CRM = reemplazar 2 nodos en n8n, cero despliegue de
TaskFlow. **Costo:** una pieza de infraestructura más que operar/monitorear.

### Opción 2 — Zapier/Make.com

Mismo principio y mismos dos flujos que la Opción 1, mismo lado de TaskFlow
sin cambios — solo cambia el lienzo donde vive la lógica de traducción. Tiene
sentido si no se quiere operar n8n self-hosted y ya se paga por una de estas
plataformas. No se desarrolla en detalle por ser funcionalmente idéntica a
la Opción 1 del lado de TaskFlow.

### Opción 3 — Adaptador propio (`crm_generic`)

Sin dependencias externas — todo el flujo vive y es auditable en el código
de TaskFlow. Tiene sentido si no se quiere depender de n8n/Zapier como pieza
de infraestructura adicional.

**Configuración por tenant** (nueva fila en `integrations`, provider
`crm_generic`, secreto cifrado en Vault como el resto de integraciones):
```json
{
  "base_url": "https://api.micrm.com",
  "auth_header": "Authorization",
  "create_endpoint": "/tickets",
  "update_endpoint": "/tickets/{external_id}",
  "method_update": "PATCH",
  "response_id_field": "id",
  "field_mapping": {
    "title": "subject",
    "description": "body",
    "priority": "priority",
    "column_title": "status"
  }
}
```

**Archivos nuevos:**
- `supabase/migrations/<ts>_crm_generic_integration.sql` — agrega
  `"crm_generic"` a `INTEGRATION_PROVIDERS`.
- `src/lib/crm/adapter.ts` — `syncTaskToCrm(task, integrationConfig)`: arma
  la URL (`create_endpoint`/`update_endpoint` con `{external_id}`
  sustituido), aplica `field_mapping`, hace el `fetch` con el header de auth
  desde Vault, parsea la respuesta con `response_id_field`.
- `src/app/api/webhooks/crm/[token]/route.ts` — el webhook entrante
  extendido de la base común.
- Extensión de `src/lib/supabase/automations-repo.ts`: nuevo valor en
  `ACTION_TYPES`, `"crm_sync"`, y su ejecución en el motor de
  automatizaciones existente.
- UI: una pestaña más en el panel de integraciones para configurar
  `base_url`/`endpoints`/`field_mapping`/secreto.

**Ejecución saliente:**
1. Tarea nueva vinculada a "sincronizar con CRM" sin `external_ticket_id` →
   POST a `create_endpoint` con los campos mapeados → se guarda el id de
   respuesta como `external_ticket_id`.
2. Tarea ya vinculada, cambia un campo mapeado → PATCH/PUT a
   `update_endpoint` con el `external_id` sustituido en la URL.
3. Reintentos: mismo patrón de backoff/log de fallos visible en `/admin`
   que el resto de webhooks salientes del sistema — fire-and-forget, no
   bloquea la UI.

**Ventaja:** cero dependencias externas. **Costo:** mantener a mano el
parseo de cada CRM nuevo (paginación, rate-limits, formatos de error).

## Decisión

Se desarrollan las opciones 1 y 3 (n8n y adaptador propio); la opción 2
queda documentada pero no se implementa en el corto plazo por ser
funcionalmente redundante con la 1 del lado de TaskFlow.

## Próximo paso

Implementar la base común (sección "Base común") — es requisito para
ambas opciones elegidas — y luego decidir si se arma primero el workflow de
n8n (sin código nuevo en TaskFlow) o el adaptador `crm_generic` (Opción 3).
