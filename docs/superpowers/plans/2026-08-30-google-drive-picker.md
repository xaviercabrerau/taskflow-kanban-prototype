# Google Drive Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user browse and select one or more files from their connected Google Drive account directly from TaskModal, instead of only being able to paste a share link one file at a time.

**Architecture:** A new client-side module lazy-loads Google's Picker + Identity Services scripts and requests a short-lived browser access token (separate from the server-stored refresh token) to open the native Drive picker with multi-select enabled. Selected file IDs go to an extended version of the existing `/api/tasks/[id]/drive-attachment` endpoint, which now accepts a batch of IDs and attaches each independently (partial success, not all-or-nothing).

**Tech Stack:** Google Picker API + Google Identity Services (`https://apis.google.com/js/api.js`, `https://accounts.google.com/gsi/client`, loaded lazily, no npm package), existing `@/lib/google/drive.ts`/`@/lib/google/client.ts` infra, existing `.field`/`.btn`/`.field-error` CSS classes. No new npm dependencies.

## Global Constraints

- No new npm dependencies — the Picker/Identity Services scripts are loaded via `<script>` tags at runtime, not installed as packages.
- The existing "paste a share link" flow (`driveLink`/`attachingDrive` state, `handleAttachDriveLink`, the `shareLink` request body shape) stays fully intact and unmodified — the picker is an addition, not a replacement.
- `getDriveFileMetadata(tenantId, fileId)`'s existing signature, behavior, and callers must not change — the new batch path is a new function alongside it, not a modification.
- The Drive-picker button and the existing "Adjuntar de Drive" input must only render when the org has an active Google integration (`integrations.some(i => i.provider === "google" && i.hasCredential && i.isActive)`) — reuse the existing `googleConnected` boolean already computed in `TaskModal.tsx` (used by the "Reenviar por email" section), don't recompute it.
- No unit tests exist for any Google network-calling function in this codebase (`getDriveFileMetadata`, `syncTaskDueDate`, `sendViaGmail` are all untested by convention — only pure functions like `extractDriveFileId` are). Do not introduce `.test.ts` coverage for the new batch metadata function or the picker-client module; verification is manual, live-browser only.
- Cancelling the picker (no files selected) must never show an error message — only a real failure (token request denied for a real reason, or the follow-up POST failing) should.

---

### Task 1: Batch Drive metadata lookup in `drive.ts`

**Files:**
- Modify: `src/lib/google/drive.ts`

**Interfaces:**
- Consumes: `getGoogleAccessToken(tenantId: string): Promise<string | null>` from `./client` (already imported, unchanged).
- Produces: `getDriveFilesMetadata(tenantId: string, fileIds: string[]): Promise<Array<{ fileId: string; metadata: DriveFileMetadata } | { fileId: string; error: string }>>` — Task 2 depends on this exact return shape (a discriminated array: each entry either has `metadata` or `error`, keyed by `fileId`, no `metadata`/`error` on the same entry).

- [ ] **Step 1: Extract the per-file fetch-and-parse logic into a private helper that takes a token directly**

In `src/lib/google/drive.ts`, replace the body of `getDriveFileMetadata` so the actual Drive API call/parse logic is reusable with an already-fetched token — this avoids the batch path re-fetching (and re-refreshing) a new Google access token once per file, which would be wasteful and could hit rate limits with several files selected at once.

Replace:

```ts
export async function getDriveFileMetadata(
  tenantId: string,
  fileId: string
): Promise<DriveFileMetadata> {
  const accessToken = await getGoogleAccessToken(tenantId);
  if (!accessToken) {
    throw new Error("Google Drive no está conectado para esta organización.");
  }

  const params = new URLSearchParams({
    fields: "id,name,mimeType,webViewLink,iconLink,size",
  });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 404 || res.status === 403) {
    throw new Error(
      "No se pudo acceder al archivo — verifica que el enlace sea correcto y que la cuenta conectada tenga permiso para verlo."
    );
  }
  if (!res.ok) {
    throw new Error(`Error al consultar Google Drive: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
    iconLink?: string;
    size?: string;
  };

  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    webViewLink: data.webViewLink,
    iconLink: data.iconLink ?? null,
    sizeBytes: data.size ? Number(data.size) : null,
  };
}
```

with:

```ts
async function fetchDriveFileMetadataWithToken(
  accessToken: string,
  fileId: string
): Promise<DriveFileMetadata> {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,webViewLink,iconLink,size",
  });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 404 || res.status === 403) {
    throw new Error(
      "No se pudo acceder al archivo — verifica que el enlace sea correcto y que la cuenta conectada tenga permiso para verlo."
    );
  }
  if (!res.ok) {
    throw new Error(`Error al consultar Google Drive: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
    iconLink?: string;
    size?: string;
  };

  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    webViewLink: data.webViewLink,
    iconLink: data.iconLink ?? null,
    sizeBytes: data.size ? Number(data.size) : null,
  };
}

/**
 * Looks up a Drive file's metadata using the org's connected Google account.
 * Throws (rather than silently returning null) on failure — unlike Calendar
 * sync, this always runs in direct response to a user action ("Adjuntar
 * desde Drive"), so the caller needs a real error to show them.
 */
export async function getDriveFileMetadata(
  tenantId: string,
  fileId: string
): Promise<DriveFileMetadata> {
  const accessToken = await getGoogleAccessToken(tenantId);
  if (!accessToken) {
    throw new Error("Google Drive no está conectado para esta organización.");
  }
  return fetchDriveFileMetadataWithToken(accessToken, fileId);
}
```

(This step is a pure refactor — `getDriveFileMetadata`'s exported signature, thrown errors, and return shape are unchanged. Only its internals now delegate to the new private helper.)

- [ ] **Step 2: Add the batch function**

Add this new export to `src/lib/google/drive.ts`, after `getDriveFileMetadata`:

```ts
/**
 * Looks up metadata for several Drive files in one call, fetching the org's
 * Google access token only once (not once per file — this is the direct
 * consumer of a multi-select Picker result, where "once per file" would
 * mean N token refreshes for one user action). Each file's lookup fails
 * independently: one bad/inaccessible file among several selected doesn't
 * prevent the others from succeeding.
 */
export async function getDriveFilesMetadata(
  tenantId: string,
  fileIds: string[]
): Promise<Array<{ fileId: string; metadata: DriveFileMetadata } | { fileId: string; error: string }>> {
  const accessToken = await getGoogleAccessToken(tenantId);
  if (!accessToken) {
    return fileIds.map((fileId) => ({
      fileId,
      error: "Google Drive no está conectado para esta organización.",
    }));
  }

  return Promise.all(
    fileIds.map(async (fileId) => {
      try {
        const metadata = await fetchDriveFileMetadataWithToken(accessToken, fileId);
        return { fileId, metadata };
      } catch (err) {
        return { fileId, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/lib/google/drive.ts`.

- [ ] **Step 4: Run the existing test suite for this file**

Run: `npx jest drive --forceExit`
Expected: the existing `extractDriveFileId` tests still pass unchanged (this task didn't touch that function).

- [ ] **Step 5: Commit**

```bash
git add src/lib/google/drive.ts
git commit -m "feat: add batch Drive metadata lookup for multi-file picker selections"
```

---

### Task 2: Multi-file support in the drive-attachment endpoint

**Files:**
- Modify: `src/app/api/tasks/[id]/drive-attachment/route.ts`

**Interfaces:**
- Consumes: `getDriveFilesMetadata(tenantId: string, fileIds: string[])` from Task 1 (exact return shape above).
- Produces: `POST /api/tasks/[id]/drive-attachment` now accepts body `{ shareLink: string } | { fileIds: string[] }`. The `fileIds` path responds `200 { attachments: AttachmentRow[]; errors: { fileId: string; error: string }[] }` (both arrays always present, `errors` empty on full success). The existing `shareLink` path's request/response shape is completely unchanged. Task 3's UI code depends on this exact `{ attachments, errors }` shape for the new path.

- [ ] **Step 1: Read the current file to confirm line numbers before editing**

The current implementation (as of this plan's writing) is:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { extractDriveFileId, getDriveFileMetadata } from "@/lib/google/drive";

/**
 * POST /api/tasks/[id]/drive-attachment
 * Body: { shareLink: string }
 * Attaches a Google Drive file to a task by its share link. Runs
 * server-side (not a direct client → Supabase call like most mutations in
 * this app) because it needs the org's Google access token, which never
 * reaches the browser.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: taskId } = await params;

  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { shareLink?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shareLink = body.shareLink?.trim();
  if (!shareLink) {
    return NextResponse.json({ error: "shareLink es requerido" }, { status: 400 });
  }

  // RLS-scoped select: only succeeds if the caller is a member of the
  // task's organization — same authorization boundary every other
  // task-related read/write in this app relies on.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("tenant_id")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const fileId = extractDriveFileId(shareLink);
  if (!fileId) {
    return NextResponse.json(
      { error: "No se reconoce ese enlace como un archivo de Google Drive." },
      { status: 400 }
    );
  }

  try {
    const metadata = await getDriveFileMetadata(task.tenant_id, fileId);

    const { data: attachment, error: insertError } = await supabase
      .from("attachments")
      .insert({
        task_id: taskId,
        file_name: metadata.name,
        file_url: metadata.id,
        external_url: metadata.webViewLink,
        mime_type: metadata.mimeType,
        file_size_bytes: metadata.sizeBytes,
        uploaded_by: authData.user.id,
        source: "google_drive",
      })
      .select("*")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ attachment });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

Verify the file still matches this before proceeding — if it's drifted, adapt the following steps' diffs to the actual current content rather than blindly applying them.

- [ ] **Step 2: Replace the file with the version supporting both request shapes**

Replace the entire file content with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { extractDriveFileId, getDriveFileMetadata, getDriveFilesMetadata } from "@/lib/google/drive";
import type { Database } from "@/lib/supabase/database.types";

type AttachmentRow = Database["public"]["Tables"]["attachments"]["Row"];

/**
 * POST /api/tasks/[id]/drive-attachment
 * Body: { shareLink: string } (single file, paste-a-link flow) or
 *       { fileIds: string[] } (one or more files, from the Drive Picker).
 * Attaches Google Drive file(s) to a task. Runs server-side (not a direct
 * client → Supabase call like most mutations in this app) because it needs
 * the org's Google access token, which never reaches the browser.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: taskId } = await params;

  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { shareLink?: string; fileIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // RLS-scoped select: only succeeds if the caller is a member of the
  // task's organization — same authorization boundary every other
  // task-related read/write in this app relies on. Done once, shared by
  // both request shapes below.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("tenant_id")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  if (Array.isArray(body.fileIds)) {
    const fileIds = body.fileIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (fileIds.length === 0) {
      return NextResponse.json({ error: "fileIds no puede estar vacío" }, { status: 400 });
    }

    const results = await getDriveFilesMetadata(task.tenant_id, fileIds);
    const attachments: AttachmentRow[] = [];
    const errors: { fileId: string; error: string }[] = [];

    for (const result of results) {
      if ("error" in result) {
        errors.push({ fileId: result.fileId, error: result.error });
        continue;
      }
      const { metadata } = result;
      const { data: attachment, error: insertError } = await supabase
        .from("attachments")
        .insert({
          task_id: taskId,
          file_name: metadata.name,
          file_url: metadata.id,
          external_url: metadata.webViewLink,
          mime_type: metadata.mimeType,
          file_size_bytes: metadata.sizeBytes,
          uploaded_by: authData.user.id,
          source: "google_drive",
        })
        .select("*")
        .single();

      if (insertError || !attachment) {
        errors.push({ fileId: result.fileId, error: insertError?.message ?? "No se pudo guardar el adjunto." });
        continue;
      }
      attachments.push(attachment);
    }

    return NextResponse.json({ attachments, errors });
  }

  const shareLink = body.shareLink?.trim();
  if (!shareLink) {
    return NextResponse.json({ error: "shareLink es requerido" }, { status: 400 });
  }

  const fileId = extractDriveFileId(shareLink);
  if (!fileId) {
    return NextResponse.json(
      { error: "No se reconoce ese enlace como un archivo de Google Drive." },
      { status: 400 }
    );
  }

  try {
    const metadata = await getDriveFileMetadata(task.tenant_id, fileId);

    const { data: attachment, error: insertError } = await supabase
      .from("attachments")
      .insert({
        task_id: taskId,
        file_name: metadata.name,
        file_url: metadata.id,
        external_url: metadata.webViewLink,
        mime_type: metadata.mimeType,
        file_size_bytes: metadata.sizeBytes,
        uploaded_by: authData.user.id,
        source: "google_drive",
      })
      .select("*")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ attachment });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing this route file. If `Database["public"]["Tables"]["attachments"]["Row"]` doesn't resolve, confirm the exact type path by checking how `TaskModal.tsx` already imports it (`Database["public"]["Tables"]["attachments"]["Row"]`, per its existing `handleAttachDriveLink`) — use the identical path.

- [ ] **Step 4: Manual verification of the unchanged path**

Run the dev server, confirm the existing "pegar un link" flow in `TaskModal` still attaches a single file successfully (no regression from this refactor) before moving to Task 3, where the new `fileIds` path gets its first real exercise.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tasks/[id]/drive-attachment/route.ts
git commit -m "feat: accept a batch of fileIds in the drive-attachment endpoint"
```

---

### Task 3: Picker client module, TaskModal wiring, and live verification

**Files:**
- Create: `src/lib/google/picker-client.ts`
- Modify: `src/components/TaskModal.tsx`

**Interfaces:**
- Consumes: `POST /api/tasks/[id]/drive-attachment` with `{ fileIds }` from Task 2, response `{ attachments: AttachmentRow[]; errors: { fileId: string; error: string }[] }`.
- Produces: `openDrivePicker(): Promise<{ fileIds: string[] } | null>`, exported from `picker-client.ts` — this task's own only consumer, but exported (not a private module) in case a future feature (e.g. an admin bulk-attach tool) wants it.

- [ ] **Step 1: Create the picker client module**

Create `src/lib/google/picker-client.ts`:

```ts
/**
 * Client-side Google Drive Picker — lets a user browse and select one or
 * more files from their connected Drive account visually, instead of
 * pasting a share link. Distinct from the rest of src/lib/google/*, which
 * is all server-side and uses the org's stored refresh token: the Picker
 * library runs in the browser and needs its own short-lived access token,
 * obtained here via Google Identity Services — never touches the refresh
 * token or Supabase Vault.
 */

declare global {
  interface Window {
    gapi?: {
      load: (api: string, callback: () => void) => void;
    };
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => { requestAccessToken: () => void };
        };
      };
      picker: {
        PickerBuilder: new () => GooglePickerBuilder;
        DocsView: new () => GooglePickerView;
        Feature: { MULTISELECT_ENABLED: string };
        Action: { PICKED: string; CANCEL: string };
      };
    };
  }
}

interface GooglePickerView {
  setIncludeFolders?: (include: boolean) => GooglePickerView;
}

interface GooglePickerDoc {
  id: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDoc[];
}

interface GooglePickerBuilder {
  addView: (view: GooglePickerView) => GooglePickerBuilder;
  enableFeature: (feature: string) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setCallback: (cb: (response: GooglePickerResponse) => void) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}

let scriptsLoadedPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(script);
  });
}

function ensureScriptsLoaded(): Promise<void> {
  if (!scriptsLoadedPromise) {
    scriptsLoadedPromise = Promise.all([
      loadScript("https://apis.google.com/js/api.js"),
      loadScript("https://accounts.google.com/gsi/client"),
    ]).then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (!window.gapi) {
            reject(new Error("No se pudo cargar la librería de Google."));
            return;
          }
          window.gapi.load("picker", () => resolve());
        })
    );
  }
  return scriptsLoadedPromise;
}

function requestAccessToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID no está configurado."));
  }
  return new Promise((resolve, reject) => {
    if (!window.google) {
      reject(new Error("No se pudo cargar Google Identity Services."));
      return;
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error || "No se pudo obtener acceso a Google Drive."));
          return;
        }
        resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

/**
 * Opens the native Google Drive picker with multi-select enabled. Resolves
 * with the selected file IDs, or null if the user closed the picker without
 * selecting anything (not an error — the caller should silently no-op).
 */
export async function openDrivePicker(): Promise<{ fileIds: string[] } | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_GOOGLE_PICKER_API_KEY no está configurado.");
  }

  await ensureScriptsLoaded();
  const accessToken = await requestAccessToken();

  return new Promise((resolve, reject) => {
    if (!window.google) {
      reject(new Error("No se pudo cargar Google Picker."));
      return;
    }
    const picker = new window.google.picker.PickerBuilder()
      .addView(new window.google.picker.DocsView())
      .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setCallback((response) => {
        if (response.action === window.google!.picker.Action.PICKED) {
          resolve({ fileIds: (response.docs ?? []).map((doc) => doc.id) });
        } else if (response.action === window.google!.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/lib/google/picker-client.ts`.

- [ ] **Step 3: Add state and a handler to TaskModal**

In `src/components/TaskModal.tsx`, near the existing `driveLink`/`attachingDrive` state (currently around line 106-107), add:

```tsx
  const [pickerAttaching, setPickerAttaching] = useState(false);
```

Add this import at the top of the file, alongside the other `@/lib/google/*`-style or local imports (match the file's existing import grouping):

```tsx
import { openDrivePicker } from "@/lib/google/picker-client";
```

Add a new handler near `handleAttachDriveLink` (after it):

```tsx
  async function handlePickFromDrive() {
    if (!taskId || pickerAttaching) return;
    setPickerAttaching(true);
    setAttachmentsError(null);
    try {
      const picked = await openDrivePicker();
      if (!picked) return; // cancelled — not an error
      const res = await fetch(`/api/tasks/${taskId}/drive-attachment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: picked.fileIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudieron adjuntar los archivos.");
      }
      const rows = json.attachments as Database["public"]["Tables"]["attachments"]["Row"][];
      const errors = json.errors as { fileId: string; error: string }[];
      if (rows.length > 0) {
        setAttachments((prev) => [
          ...rows.map((row) => ({
            id: row.id,
            taskId: row.task_id,
            fileName: row.file_name,
            storagePath: row.file_url,
            externalUrl: row.external_url,
            source: row.source === "google_drive" ? ("google_drive" as const) : ("upload" as const),
            fileSizeBytes: row.file_size_bytes,
            mimeType: row.mime_type,
            uploadedBy: row.uploaded_by,
            createdAt: row.created_at,
          })),
          ...prev,
        ]);
      }
      if (errors.length > 0) {
        setAttachmentsError(
          errors.length === picked.fileIds.length
            ? "No se pudo adjuntar ningún archivo."
            : `${errors.length} de ${picked.fileIds.length} archivo(s) no se pudieron adjuntar.`
        );
      }
    } catch (err) {
      setAttachmentsError(err instanceof Error ? err.message : "No se pudieron adjuntar los archivos.");
    } finally {
      setPickerAttaching(false);
    }
  }
```

Note: match this attachment-object-mapping shape exactly against `handleAttachDriveLink`'s existing single-file mapping a few lines above it in the same file — if that mapping has drifted from what's shown in this plan (e.g. an added field), mirror whatever it actually does rather than this snippet verbatim.

- [ ] **Step 4: Add the button to the Adjuntos section UI**

In the same file, find the existing Drive-attach inline form (the `<div className="comment-input-wrap">` containing the `driveLink` input and "Adjuntar de Drive" button, currently around line 866-882). Add a new button immediately after that `</div>`, gated on `googleConnected` (the paste-link input itself doesn't need Google connected in principle, but the picker button specifically must):

```tsx
                {googleConnected && (
                  <button
                    type="button"
                    className="btn"
                    style={{ marginTop: 8 }}
                    onClick={handlePickFromDrive}
                    disabled={pickerAttaching}
                  >
                    {pickerAttaching ? "Abriendo Drive…" : "📁 Elegir de Google Drive"}
                  </button>
                )}
```

(Confirm `googleConnected` is already in scope at this point in the file — it's computed once near the top of the component, per the earlier forward-email task, and should already cover this section.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/components/TaskModal.tsx`.

- [ ] **Step 6: Tell the user to complete the one-time Google Cloud setup**

Before live verification can work, the user must:
1. Enable the **Picker API** in Google Cloud Console → APIs & Services → Library (project used for the existing OAuth client).
2. Create an API key (Credentials → Create Credentials → API key), restricted to:
   - API restriction: Picker API only.
   - Application restriction: HTTP referrers, `https://task.conto.ec/*`.
3. Provide the new API key value.

Do not proceed to Step 7 until this is done and the key is in hand.

- [ ] **Step 7: Set the two new environment variables in Vercel**

```bash
vercel env add NEXT_PUBLIC_GOOGLE_CLIENT_ID production
# paste the same value already used for GOOGLE_CLIENT_ID (not secret — this is the public client id)
vercel env add NEXT_PUBLIC_GOOGLE_PICKER_API_KEY production
# paste the new Picker-restricted API key from Step 6
```

Repeat for the `preview`/`development` Vercel environments if this app's other `NEXT_PUBLIC_*` vars are set there too (check with `vercel env ls`).

- [ ] **Step 8: Build, deploy, and verify live**

```bash
npm run build
```
Expected: clean build, `/` (and every other route) still compiles.

Deploy (`vercel deploy --prod` or via git push, whichever this session has been using), then in a real browser with an org that has Google connected:
1. Open a task, confirm "📁 Elegir de Google Drive" appears next to the existing paste-link input.
2. Click it, confirm Google's picker opens (first time may prompt an additional consent screen for Drive read access).
3. Select two or more files (multi-select — Cmd/Ctrl+click or the picker's own multi-select UI) and confirm.
4. Confirm all selected files appear in the Adjuntos list.
5. Repeat, this time cancelling the picker without selecting anything — confirm no error message appears and nothing changes.
6. If possible, test one failure case: select a file the connected account doesn't actually have access to (or temporarily revoke Drive scope) and confirm the partial-failure message ("N de M archivo(s) no se pudieron adjuntar.") renders correctly rather than crashing.

- [ ] **Step 9: Update documentation**

Add a short note to `OBSERVABILITY.md`'s existing Google Workspace integration section (added earlier this session) describing the Drive Picker: what it does, the two new env vars, and the one-time Google Cloud Picker API + API key setup from Step 6.

- [ ] **Step 10: Commit**

```bash
git add src/lib/google/picker-client.ts src/components/TaskModal.tsx OBSERVABILITY.md
git commit -m "feat: add native Google Drive picker with multi-file selection to TaskModal"
```
