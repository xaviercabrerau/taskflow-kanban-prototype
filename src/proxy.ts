import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  generateRequestId,
  setRequestContext,
} from "@/lib/tracing/request-context";

// Refresca la sesión de Supabase Auth en cada request, propaga request IDs
// para debugging, y protege las rutas de la app: sin sesión válida, redirige
// a /login (excepto /login mismo).
export async function proxy(request: NextRequest) {
  // Extraer request ID de headers o generar uno nuevo
  const requestId =
    request.headers.get("x-request-id") || generateRequestId();

  // Almacenar en contexto para disponibilidad global
  setRequestContext(requestId, () => {
    // El contexto estará disponible durante toda la request
  });

  // Nonce por request para permitir scripts inline (theme-flash script en
  // layout.tsx) sin 'unsafe-inline' en script-src — ver next.config.ts para
  // el resto de la CSP (style-src sigue en 'unsafe-inline': los estilos
  // inline vía prop `style` de React no soportan nonce).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${isDev ? " ws://localhost:*" : ""}`,
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Agregar request ID a response headers
  response.headers.set("x-request-id", requestId);
  response.headers.set("Content-Security-Policy", csp);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          // Preservar request ID y CSP (con el mismo nonce) en respuesta actualizada
          response.headers.set("x-request-id", requestId);
          response.headers.set("Content-Security-Policy", csp);
        },
      },
    }
  );

  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    user = data.user;
    // A missing session is the expected, non-error case for a logged-out
    // visitor (Supabase reports it as `AuthSessionMissingError`, not a thrown
    // exception). Anything else — network blips, an invalid/expired refresh
    // token, an upstream 5xx — is a genuine auth-service failure that would
    // otherwise silently look identical to "user is logged out".
    if (error && error.name !== "AuthSessionMissingError") {
      Sentry.captureException(error);
    }
  } catch (error) {
    Sentry.captureException(error);
  }

  const isLoginRoute = request.nextUrl.pathname.startsWith("/login");
  const isPublicAuthRoute =
    isLoginRoute || request.nextUrl.pathname.startsWith("/reset-password");
  if (!user && !isPublicAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    redirectResponse.headers.set("x-request-id", requestId);
    return redirectResponse;
  }
  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    const redirectResponse = NextResponse.redirect(url);
    redirectResponse.headers.set("x-request-id", requestId);
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
