import * as Sentry from "@sentry/nextjs";

// NEXT_PUBLIC_SENTRY_DSN sin configurar => dsn: undefined => Sentry.init
// no-opea silenciosamente. No hace falta ningún guard propio.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
