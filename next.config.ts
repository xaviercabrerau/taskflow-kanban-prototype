import type { NextConfig } from "next";

// Content-Security-Policy ya no vive aquí: se genera por request en
// src/proxy.ts con un nonce único, así script-src no necesita 'unsafe-inline'
// en producción. proxy.ts corre en todas las rutas cubiertas por su matcher
// y setea el header ahí; estos son solo los headers verdaderamente estáticos.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Sin HSTS, la primera visita a http://task.conto.ec (sin https) es
  // vulnerable a downgrade/SSL-stripping antes del redirect de Vercel
  // (hallazgo de la revisión de seguridad avanzada, 2026-09-03).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
];

const nextConfig: NextConfig = {
  // Evita el header X-Powered-By: Next.js (fingerprinting menor, confirmado
  // presente en producción en la revisión de seguridad de 2026-09-04).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
