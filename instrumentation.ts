import * as Sentry from "@sentry/nextjs";

// Next.js 16 App Router: register() corre una vez por instancia de servidor
// (Node.js y Edge). onRequestError reporta errores no capturados de Server
// Components, Route Handlers y Server Actions.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
