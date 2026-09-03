"use client";

import { useEffect } from "react";

// Registro del service worker de public/sw.js — requisito de Chrome/Android
// para que el navegador ofrezca "Instalar app" (junto con manifest.webmanifest
// enlazado en layout.tsx). No hace nada más: sw.js decide qué cachear.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("No se pudo registrar el service worker:", err);
      });
    }
  }, []);

  return null;
}
