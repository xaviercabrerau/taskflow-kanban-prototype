# Diseño: Google Drive Picker nativo

## Problema

Adjuntar un archivo de Drive a una tarea hoy requiere que el usuario copie manualmente el link de compartir desde Drive y lo pegue en TaskFlow (`handleAttachDriveLink` en `TaskModal.tsx`, endpoint `POST /api/tasks/[id]/drive-attachment`). El usuario pidió poder **navegar visualmente** sus archivos de Drive y seleccionar con clic, como hace cualquier app que integra Drive de verdad (Slack, Notion, etc.).

## Alcance

Agregar el selector nativo de Google (Picker API) como una segunda forma de adjuntar, sin quitar la opción de pegar el link (sigue funcionando, útil si alguien prefiere copiar/pegar o si el picker falla). El picker permite **seleccionar varios archivos a la vez** en una sola apertura. Fuera de alcance: subir archivos nuevos desde el picker (solo seleccionar existentes), cualquier cambio a cómo se sirven/descargan los adjuntos ya guardados.

## Por qué se necesita infraestructura nueva

El flujo OAuth que ya existe (`src/lib/google/oauth.ts`, `connect`/`callback` routes) obtiene un **refresh token** que vive solo en el servidor (Supabase Vault) — nunca llega al navegador, por diseño (es lo correcto para no exponer credenciales). El Picker de Google, en cambio, es una librería que corre **en el navegador** y necesita su propio **access token de corta duración**, obtenido ahí mismo vía Google Identity Services (`google.accounts.oauth2.initTokenClient`). Es un mecanismo aparte, no reutiliza el refresh token del servidor.

Además, el Picker requiere una **API key de navegador** (distinta al Client ID/Secret de OAuth), restringida por Google Cloud a la Picker API y al dominio de la app.

## Diseño

### 1. Configuración nueva en Google Cloud (una sola vez, la hace el usuario)

- Habilitar **Picker API** en Biblioteca de APIs (junto a Calendar/Drive/Gmail, ya habilitadas).
- Crear una **API key** en Credenciales, restringida a:
  - API: Picker API únicamente.
  - Referente HTTP: `https://task.conto.ec/*`.

### 2. Variables de entorno nuevas (ambas públicas, client-side)

- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: copia pública del `GOOGLE_CLIENT_ID` que ya existe server-side. Un Client ID de OAuth no es secreto (solo el Client Secret lo es) — Google Identity Services en el navegador lo necesita directamente.
- `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`: la API key creada en el paso 1.

### 3. Módulo cliente nuevo: `src/lib/google/picker-client.ts`

Carga perezosa (solo cuando el usuario hace clic, no en cada carga de página) de dos scripts de Google:
- `https://apis.google.com/js/api.js` (para `gapi.load('picker', ...)`).
- `https://accounts.google.com/gsi/client` (para `google.accounts.oauth2.initTokenClient`).

Expone una única función:

```ts
export async function openDrivePicker(): Promise<{ fileIds: string[] } | null>
```

Internamente:
1. Carga los dos scripts si no están ya cargados (idempotente).
2. Pide un access token efímero vía `initTokenClient({ client_id: NEXT_PUBLIC_GOOGLE_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.readonly', callback })` + `.requestAccessToken()`. La primera vez en una sesión del navegador puede mostrar un consentimiento de Google; luego lo recuerda.
3. Con el token, abre `new google.picker.PickerBuilder().addView(new google.picker.DocsView()).enableFeature(google.picker.Feature.MULTISELECT_ENABLED).setOAuthToken(token).setDeveloperKey(NEXT_PUBLIC_GOOGLE_PICKER_API_KEY).setCallback(cb).build().setVisible(true)` — `MULTISELECT_ENABLED` es lo que habilita elegir varios archivos con Cmd/Ctrl+clic o checkboxes en la misma apertura del picker.
4. Resuelve `{ fileIds: string[] }` (uno o más ids) si el usuario selecciona y confirma, o `null` si cancela (cancelar no es un error).

### 4. Cambio en `TaskModal.tsx`

Junto al input de "pegar link" ya existente (sección "Adjuntos"), un botón nuevo **"📁 Elegir de Google Drive"**, visible solo si `googleConnected` (mismo gate que "Reenviar por email"). Al hacer clic:
1. Llama `openDrivePicker()`.
2. Si devuelve `{ fileIds }` (uno o varios), hace un único `POST /api/tasks/[id]/drive-attachment` con `{ fileIds }` (en vez de `{ shareLink }`).
3. Si devuelve `null` (cancelado), no hace nada — sin mensaje de error.
4. La respuesta puede traer éxito parcial (ver sección 5) — los adjuntos exitosos se agregan a la lista igual que hoy; si algún archivo falló, se muestra un mensaje con cuántos fallaron sin descartar los que sí se adjuntaron.

### 5. Cambio en `POST /api/tasks/[id]/drive-attachment`

El body pasa a aceptar `{ shareLink: string } | { fileIds: string[] }`. Si viene `shareLink`, sigue el comportamiento actual (un solo adjunto, `extractDriveFileId`) sin cambios. Si viene `fileIds`, el endpoint:
1. Hace el lookup RLS-scoped de la tarea **una sola vez** (no por archivo).
2. Para cada `fileId`, intenta `getDriveFileMetadata` + insert en `attachments` de forma independiente — el fallo de un archivo no cancela los demás.
3. Responde `{ attachments: Attachment[], errors: { fileId: string; error: string }[] }` — éxito parcial explícito en vez de todo-o-nada, ya que con varios archivos es razonable que uno falle (p. ej. permisos de Drive en ese archivo específico) sin que eso bloquee los demás.

## Testing

No hay test unitario posible para el módulo del picker (depende de scripts externos de Google inyectados en el navegador real) — se valida con verificación manual en vivo: conectar Google, hacer clic en "Elegir de Google Drive", seleccionar un archivo real, confirmar que se adjunta correctamente a la tarea. El cambio en el endpoint (`{fileId}` vs `{shareLink}`) sí es testeable con un test unitario simple si el plan lo considera necesario.

## Fuera de alcance (explícito)

- Subir archivos nuevos desde el picker.
- Cualquier cambio al flujo de "pegar link" ya existente, salvo dejarlo intacto como alternativa.
- Reintentar automáticamente los archivos que fallaron en un lote — el usuario los vuelve a seleccionar si quiere reintentar.
