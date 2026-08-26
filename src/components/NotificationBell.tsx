"use client";

import { useState } from "react";
import { useBoard } from "@/context/BoardContext";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
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
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setOpen(false)}
          />
          <div
            className="modal"
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
              <h2 style={{ fontSize: 14.5 }}>Notificaciones</h2>
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
      )}
    </div>
  );
}
