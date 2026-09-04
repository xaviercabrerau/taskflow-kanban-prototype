# Integración CRM vía n8n (Opción 1)

Ver el diseño completo en
[`docs/plans/2026-09-03-crm-integration-design.md`](../../docs/plans/2026-09-03-crm-integration-design.md).

Estos dos workflows son **genéricos** (usan el nodo `HTTP Request` en vez de
un nodo nativo de un CRM concreto) para no atarlos a HubSpot/Salesforce/
Pipedrive/Zoho de entrada. Si tu CRM es uno de esos 4, reemplaza el nodo
`HTTP Request` marcado en cada workflow por su nodo nativo (`HubSpot`,
`Salesforce`, `Pipedrive` o `Zoho CRM`/`Zoho CRM Trigger`) — n8n ya trae
esos nodos con su propio manejo de OAuth/paginación/rate-limits.

## Importar

En n8n: **Workflows → Import from File** → selecciona
`crm-to-taskflow.json` o `taskflow-to-crm.json`.

## `crm-to-taskflow.json` (entrante — Sección 3/4 del diseño)

1. **Webhook** (nodo trigger) — recibe el evento del CRM (o del nodo trigger
   nativo del CRM, si lo reemplazas).
2. **Set** — mapea los campos del CRM al payload que espera TaskFlow:
   `p_external_ticket_id`, `p_title`, `p_description`, `p_priority`.
3. **HTTP Request** — `POST {SUPABASE_URL}/rest/v1/rpc/ingest_webhook_task`
   con header `apikey: <anon key>` y el body mapeado. `p_token` es el token
   del webhook entrante creado en TaskFlow (Automatizaciones → Webhooks
   entrantes).

## `taskflow-to-crm.json` (saliente — Sección 2/6 del diseño)

1. **Webhook** — recibe el POST de la acción `webhook` de una automatización
   de TaskFlow (`{ task_id, task_title, event, ... }`).
2. **IF** — ¿la tarea ya tiene `external_ticket_id`? (se resuelve con un
   **HTTP Request** previo a `GET {SUPABASE_URL}/rest/v1/tasks?id=eq.{{task_id}}`).
3. **Rama "no"**: **HTTP Request** `POST` al endpoint de creación del CRM →
   **HTTP Request** `PATCH {SUPABASE_URL}/rest/v1/tasks?id=eq.{{task_id}}`
   guardando el id devuelto como `external_ticket_id`.
4. **Rama "sí"**: **HTTP Request** al endpoint de actualización del CRM con
   el `external_ticket_id` ya conocido.

## Credenciales necesarias en n8n

- `Supabase anon key` (header `apikey`) y `NEXT_PUBLIC_SUPABASE_URL` — como
  variables de entorno de n8n o credenciales de tipo "Header Auth".
- Credencial del CRM (API key/OAuth) — según el nodo nativo que uses, o un
  header manual si te quedas con `HTTP Request` genérico.
