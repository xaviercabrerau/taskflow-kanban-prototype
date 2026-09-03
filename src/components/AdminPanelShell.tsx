"use client";

import { useRef } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";

interface AdminPanelShellProps {
  embedded: boolean;
  onClose: () => void;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}

// Wrapper compartido por los paneles de administración embebibles
// (Recurring/Portfolio/Workload...) — antes cada uno repetía el mismo
// `embedded ? <div className="admin-panel"> : <div className="modal-backdrop">`
// y el mismo header, con detalles inconsistentes entre sí (algunos sin
// useDialogA11y). Ver AUDITORIA_2026-09-03.md, hallazgo 13.
export default function AdminPanelShell({ embedded, onClose, title, actions, children, width = 560 }: AdminPanelShellProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const panel = (
    <div
      ref={modalRef}
      className={embedded ? "admin-panel" : "modal"}
      style={embedded ? undefined : { width }}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      tabIndex={embedded ? undefined : -1}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        {!embedded && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        )}
      </div>
      <div className="modal-body">
        {actions && <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>{actions}</div>}
        {children}
      </div>
    </div>
  );

  if (embedded) return panel;
  return <div className="modal-backdrop">{panel}</div>;
}
