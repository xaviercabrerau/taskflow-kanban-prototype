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
