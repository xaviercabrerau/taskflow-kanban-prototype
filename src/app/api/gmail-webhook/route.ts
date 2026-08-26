// Endpoint destino para Google Cloud Pub/Sub una vez que haya una cuenta de
// Google Workspace real con OAuth (Domain-Wide Delegation) y una suscripción
// Pub/Sub configurados por un administrador fuera de esta app — ver la nota
// del proveedor "gmail_inbound" en IntegrationsModal. Hasta entonces, este
// endpoint solo confirma que la ruta existe; no procesa nada.
//
// Cuando se conecte la cuenta real, este handler deberá: verificar la firma
// del mensaje Pub/Sub, decodificar el payload base64, extraer el
// Message-ID/thread_token del email entrante, y llamar los RPCs existentes
// (crear comentario / cambiar estado) igual que el resto de integraciones.
export async function POST() {
  return Response.json(
    { error: "gmail_inbound no está configurado todavía. Requiere OAuth + Pub/Sub en un Google Workspace real." },
    { status: 501 }
  );
}
