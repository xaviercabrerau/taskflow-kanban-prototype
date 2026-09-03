// Sirve el service worker como una ruta dinámica (en vez de un archivo
// estático en public/) para poder embeber un CACHE_NAME distinto por
// deploy — antes era el string fijo "taskflow-shell-v1", que nunca
// cambiaba entre despliegues y por lo tanto nunca disparaba la purga del
// cache viejo en `activate` (AUDITORIA_2026-09-03.md, hallazgo 15).
// VERCEL_GIT_COMMIT_SHA lo puebla Vercel automáticamente en cada deploy,
// sin configuración adicional; en local cae a un valor fijo.
//
// Cache-Control: no-cache fuerza al navegador a revalidar el script en
// cada verificación de actualización del service worker (el algoritmo de
// actualización del spec compara bytes, así que sin esto un CDN/browser
// cache podría servir una versión vieja del propio sw.js y nunca detectar
// el cambio de CACHE_NAME).

export const dynamic = "force-dynamic";

export async function GET() {
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
  const script = `// Service worker mínimo para hacer TaskFlow instalable (PWA) — network-first,
// sin cache agresivo de datos. Nunca cachea /api/*: los datos del tablero
// deben ser siempre en vivo, no servidos desde una copia local potencialmente
// vieja (tareas, comentarios, permisos, etc. son sensibles a estar al día).
const CACHE_NAME = "taskflow-shell-${buildId}";
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nunca interceptar la API ni nada fuera del mismo origen — solo el shell
  // estático (HTML de navegación, manifest, íconos) se sirve vía cache.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && (event.request.mode === "navigate" || SHELL_URLS.includes(url.pathname))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
  );
});
`;

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
}
