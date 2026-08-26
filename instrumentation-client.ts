// Punto de entrada de instrumentación de cliente de Next.js 16 (reemplaza
// el auto-require implícito de sentry.client.config.ts de versiones
// anteriores). Solo importa por su efecto secundario (el Sentry.init real).
import "./sentry.client.config";
