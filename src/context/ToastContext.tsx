"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface Toast {
  id: string;
  message: string;
  tone: "error" | "success";
}

interface ToastContextValue {
  toasts: Toast[];
  pushToast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Extraído de BoardContext.tsx (AUDITORIA_2026-09-03.md, hallazgo 11): el
// timer de auto-descarte de un toast (cada 5s) invalidaba el `value`
// memoizado de BoardContext entero (toasts estaba en su dependency array),
// forzando un re-render de TODO consumidor de useBoard() — incluido el
// tablero completo durante un drag-and-drop — solo porque un toast
// apareció o se cerró. Vive en su propio contexto, montado por fuera de
// BoardProvider en layout.tsx; BoardProvider consume pushToast vía
// useToast() para sus ~24 call sites de feedback de error, sin volver a
// exponer toasts/dismissToast en su propio value.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Rastrea los timers de auto-descarte por id de toast, para poder
  // cancelarlos si el usuario lo cierra a mano o el provider se desmonta
  // antes de que se cumplan los 5s — sin esto, el timer huérfano igual
  // dispara un setToasts sobre un toast que ya no existe.
  const toastTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const pushToast = useCallback((message: string, tone: Toast["tone"] = "error") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, tone }]);
    toastTimersRef.current[id] = setTimeout(() => {
      delete toastTimersRef.current[id];
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current[id];
    if (timer) {
      clearTimeout(timer);
      delete toastTimersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, pushToast, dismissToast }}>{children}</ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
