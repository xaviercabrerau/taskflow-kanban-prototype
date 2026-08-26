import type { NextConfig } from "next";

// Content-Security-Policy ya no vive aquí: se genera por request en
// src/proxy.ts con un nonce único, así script-src no necesita 'unsafe-inline'
// en producción. proxy.ts corre en todas las rutas cubiertas por su matcher
// y setea el header ahí; estos son solo los headers verdaderamente estáticos.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  /* config options here */
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
