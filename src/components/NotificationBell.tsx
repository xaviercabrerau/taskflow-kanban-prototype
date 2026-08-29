"use client";

import { useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { AppNotification } from "@/lib/supabase/notifications-repo";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

// Subcomponente separado a propósito: useDialogA11y arma su listener de
// Escape/foco una sola vez, al montar (ver el propio hook). NotificationBell
// nunca se desmonta — solo alterna `open` — así que si el hook viviera ahí
// directamente jamás vería `enabled=true` en un montaje real y el panel
// quedaría sin Escape ni trampa de foco. Este componente sí monta/desmonta
// junto con `open`, igual que el resto de modales de la app.
function NotificationPanel({
  notifications,
  unreadCount,
  markRead,
  markAllRead,
  onClose,
}: {
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(panelRef, onClose);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={onClose} />
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-bell-title"
        tabIndex={-1}
        style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          width: 340,
          maxHeight: 420,
          overflowY: "auto",
          zIndex: 50,
        }}
      >
        <div className="modal-head">
          <h2 id="notification-bell-title" style={{ fontSize: 14.5 }}>Notificaciones</h2>
          {unreadCount > 0 && (
            <button
              type="button"
              className="icon-btn"
              title="Marcar todas como leídas"
              aria-label="Marcar todas como leídas"
              onClick={markAllRead}
            >
              ✓✓
            </button>
          )}
        </div>
        <div className="modal-body" style={{ padding: "6px 0" }}>
          {notifications.length === 0 && (
            <p style={{ color: "var(--muted)", fontSize: 13.5, padding: "12px 20px" }}>
              Sin notificaciones todavía.
            </p>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.readAt && markRead(n.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  if (!n.readAt) markRead(n.id);
                }
              }}
              style={{
                padding: "10px 20px",
                borderBottom: "1px solid var(--border)",
                cursor: n.readAt ? "default" : "pointer",
                background: n.readAt ? "transparent" : "var(--accent-soft, rgba(110,86,207,0.08))",
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{n.body}</div>}
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useBoard();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        className="icon-btn"
        style={{ marginLeft: 12, position: "relative" }}
        onClick={() => setOpen((v) => !v)}
        title="Notificaciones"
        aria-label="Notificaciones"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        🔔
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "var(--high)",
              color: "#fff",
              borderRadius: 999,
              fontSize: 10.5,
              lineHeight: 1,
              padding: "2px 5px",
              minWidth: 14,
              textAlign: "center",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          markRead={markRead}
          markAllRead={markAllRead}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
