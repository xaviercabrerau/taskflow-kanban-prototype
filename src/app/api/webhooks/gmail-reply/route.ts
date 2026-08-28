// Endpoint destino para las respuestas por email a notificaciones de tareas,
// vía Google Cloud Pub/Sub — ver la nota del proveedor "gmail_inbound" en
// IntegrationsModal y el endpoint hermano en /api/gmail-webhook/route.ts.
//
// Deshabilitado hasta que existan, a la vez: (1) verificación real de la
// firma del mensaje Pub/Sub (el JWT del header Authorization debe validarse
// contra las claves públicas de Google, no aceptarse sin más), y (2) un
// esquema de `email_threads`/`failed_jobs` reconciliado con las tablas reales
// del proyecto — las migraciones que estas tablas requerían chocaban con el
// esquema de `notifications`/`notification_preferences` ya en producción y
// nunca llegaron a aplicarse, por lo que este handler no era funcional de
// todos modos. Sin (1), el endpoint permitía mover cualquier tarea o inyectar
// comentarios arbitrarios sin autenticación con solo conocer/adivinar un
// message_id.
export async function POST() {
  return Response.json(
    { error: "gmail_inbound no está configurado todavía. Requiere verificación de firma Pub/Sub y reconciliar el esquema de email_threads/failed_jobs." },
    { status: 501 }
  );
}
