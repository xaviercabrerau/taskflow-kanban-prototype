// Punto de entrada de instrumentación de cliente de Next.js 16 (reemplaza
// el auto-require implícito de sentry.client.config.ts de versiones
// anteriores).
//
// Difiere la carga del SDK de Sentry (143 KB gzip, medidos en la revisión
// de 2026-09-04) hasta la primera interacción real del usuario — o hasta
// 5s de inactividad tras el primer paint, lo que ocurra primero — así ese
// bundle no compite con el JS crítico del render inicial/TTI. El import()
// dinámico (no un import estático) es lo que realmente saca a Sentry del
// chunk inicial: hace que webpack lo separe en su propio chunk cargado
// bajo demanda.
//
// Tradeoff aceptado (decisión del usuario, Tarea 8 del plan de
// 2026-09-04): un error que ocurra ANTES de esa primera interacción o de
// los 5s de fallback — por ejemplo un crash durante la hidratación
// inicial — no llega a reportarse a Sentry.
const INTERACTION_EVENTS = ["click", "keydown", "scroll", "pointermove"] as const;

let fallbackTimer: ReturnType<typeof setTimeout>;

function loadSentry() {
  INTERACTION_EVENTS.forEach((event) => window.removeEventListener(event, loadSentry));
  clearTimeout(fallbackTimer);
  void import("./sentry.client.config");
}

INTERACTION_EVENTS.forEach((event) => window.addEventListener(event, loadSentry, { once: true, passive: true }));
fallbackTimer = setTimeout(loadSentry, 5000);
