/**
 * Google Drive file metadata lookup, for attaching a Drive file to a task
 * by pasting its share link — not a full Drive browser/picker. Keeps the
 * client bundle light (no Google Picker script to load) while still letting
 * users link a real Drive file with a name/type/preview, not just a raw URL.
 */

import { getGoogleAccessToken } from "./client";

const DRIVE_FILE_ID_PATTERNS = [
  /\/file\/d\/([a-zA-Z0-9_-]{10,})/, // https://drive.google.com/file/d/<id>/view
  /[?&]id=([a-zA-Z0-9_-]{10,})/, // https://drive.google.com/open?id=<id>
  /\/document\/d\/([a-zA-Z0-9_-]{10,})/, // Docs/Sheets/Slides share links
  /\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/,
  /\/presentation\/d\/([a-zA-Z0-9_-]{10,})/,
];

export function extractDriveFileId(shareLink: string): string | null {
  for (const pattern of DRIVE_FILE_ID_PATTERNS) {
    const match = pattern.exec(shareLink);
    if (match) return match[1];
  }
  return null;
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  iconLink: string | null;
  sizeBytes: number | null;
}

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
