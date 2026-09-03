import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { BoardProvider } from "@/context/BoardContext";
import { ToastProvider } from "@/context/ToastContext";
import PasswordChangeGate from "@/components/PasswordChangeGate";
import MfaAalGate from "@/components/MfaAalGate";
import MfaGate from "@/components/MfaGate";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "TaskFlow — Kanban",
  description: "Prototipo funcional del tablero Kanban de TaskFlow",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f8f82",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce");
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Corre antes del primer paint para evitar el flash del tema
            equivocado (localStorage puede diferir de prefers-color-scheme).
            nonce requerido por la CSP de src/proxy.ts (script-src ya no
            permite 'unsafe-inline' en producción). */}
        <script
          nonce={nonce ?? undefined}
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();',
          }}
        />
      </head>
      <body>
        {/* PasswordChangeGate va ANTES que todo lo demás: si la cuenta
            arrastra una contraseña temporal (asignada desde el panel de
            administración), debe resolverse antes incluso del paso de MFA.
            MfaAalGate va ANTES de BoardProvider a propósito: bloquea el
            árbol (y por lo tanto el mount/fetch de BoardProvider) hasta
            resolver el paso de verificación en dos pasos, para que los
            datos del board nunca lleguen a memoria del cliente antes de
            que la sesión alcance el nivel de verificación requerido. */}
        <ServiceWorkerRegister />
        {/* ToastProvider envuelve todo lo demás: BoardProvider consume
            useToast() internamente (ver ToastContext.tsx), así que debe ser
            un ancestro suyo. */}
        <ToastProvider>
          <PasswordChangeGate>
            <MfaAalGate>
              <BoardProvider>
                <MfaGate>{children}</MfaGate>
              </BoardProvider>
            </MfaAalGate>
          </PasswordChangeGate>
        </ToastProvider>
      </body>
    </html>
  );
}
