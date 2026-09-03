"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useToast } from "@/context/ToastContext";
import { assigneeColor, assigneeInitial } from "@/lib/types";
import InviteModal from "./InviteModal";
import AutomationsModal from "./AutomationsModal";
import WorkspaceModal from "./WorkspaceModal";
import McpTokensModal from "./McpTokensModal";
import RolesModal from "./RolesModal";
import AuditExportModal from "./AuditExportModal";
import MfaSettingsModal from "./MfaSettingsModal";
import SsoSettingsModal from "./SsoSettingsModal";
import TemplateMarketplaceModal from "./TemplateMarketplaceModal";
import ReportsModal from "./ReportsModal";
import IntegrationsModal from "./IntegrationsModal";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";

const TABS = [
  { href: "/", label: "Kanban" },
  { href: "/tabla", label: "Tabla" },
  { href: "/gantt", label: "Gantt" },
  { href: "/calendario", label: "Calendario" },
  { href: "/dashboard", label: "Dashboard" },
];

interface ShellProps {
  children: ReactNode;
  onNewTask?: () => void;
}

export default function Shell({ children, onNewTask }: ShellProps) {
  const pathname = usePathname();
  const {
    reset,
    can,
    permissionsError,
    workspaces,
    activeWorkspaceId,
    isOwner,
    searchQuery,
    setSearchQuery,
    supabase,
    members,
    userId,
  } = useBoard();
  const { toasts, dismissToast } = useToast();
  const currentMember = members.find((m) => m.userId === userId);
  const currentUserLabel = currentMember?.fullName || currentMember?.email || "Sesión activa";
  const [showInvite, setShowInvite] = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [showMcpTokens, setShowMcpTokens] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showMfa, setShowMfa] = useState(false);
  const [showSso, setShowSso] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const currentWorkspace = workspaces.find((w) => w.workspaceId === activeWorkspaceId) ?? workspaces[0];

  // Recarga completa en vez de router.push: limpia de un golpe todo el
  // estado en memoria de BoardContext (board, permisos, notificaciones…)
  // en vez de dejarlo "colgando" hasta que algo lo revalide.
  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = window.location.origin + "/login";
  }

  return (
    <>
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          TaskFlow
        </div>
        <button
          type="button"
          className="switcher"
          onClick={() => setShowWorkspaceModal(true)}
          title="Cambiar área de trabajo"
          aria-label="Cambiar área de trabajo"
        >
          {currentWorkspace ? (
            <>
              {currentWorkspace.icon ?? "📋"} <b>{currentWorkspace.name}</b>
            </>
          ) : (
            "Workspace"
          )}
        </button>
        <div className="search">
          🔍
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar tareas…"
            aria-label="Buscar tareas"
          />
        </div>
        <div className="spacer" />
        <div className="current-user" title={currentUserLabel}>
          <div className="av" style={{ background: assigneeColor(currentUserLabel) }}>
            {assigneeInitial(currentUserLabel)}
          </div>
          <span className="current-user-label">{currentUserLabel}</span>
        </div>
        <NotificationBell />
        <ThemeToggle />
        <div role="toolbar" aria-label="Acciones de la organización" style={{ display: "contents" }}>
        <button
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={() => setShowInvite(true)}
          title="Miembros de la organización"
          aria-label="Miembros de la organización"
        >
          👥
        </button>
        <button
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={() => setShowAutomations(true)}
          title="Automatizaciones"
          aria-label="Automatizaciones"
        >
          ⚡
        </button>
        <button
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={() => setShowMcpTokens(true)}
          title="Tokens de acceso (MCP)"
          aria-label="Tokens de acceso (MCP)"
        >
          🔑
        </button>
        {isOwner && (
          <button
            className="icon-btn"
            style={{ marginLeft: 12 }}
            onClick={() => setShowRoles(true)}
            title="Roles y permisos"
            aria-label="Roles y permisos"
          >
            🛡️
          </button>
        )}
        <button
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={() => setShowAudit(true)}
          title="Registro de auditoría"
          aria-label="Registro de auditoría"
        >
          📋
        </button>
        <button
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={() => setShowMfa(true)}
          title="Verificación en dos pasos"
          aria-label="Verificación en dos pasos"
        >
          🔐
        </button>
        {isOwner && (
          <button
            className="icon-btn"
            style={{ marginLeft: 12 }}
            onClick={() => setShowSso(true)}
            title="Inicio de sesión SSO"
            aria-label="Inicio de sesión SSO"
          >
            🌐
          </button>
        )}
        <button
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={() => setShowMarketplace(true)}
          title="Marketplace de plantillas"
          aria-label="Marketplace de plantillas"
        >
          🧩
        </button>
        <button
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={() => setShowReports(true)}
          title="Reportes BI avanzados"
          aria-label="Reportes BI avanzados"
        >
          📊
        </button>
        <button
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={() => setShowIntegrations(true)}
          title="Integraciones de terceros"
          aria-label="Integraciones de terceros"
        >
          🔌
        </button>
        <button
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={reset}
          title="Restaurar datos de ejemplo"
          aria-label="Restaurar datos de ejemplo"
        >
          ↺
        </button>
        <Link
          href="/admin"
          className="icon-btn"
          style={{ marginLeft: 12 }}
          title="Consola de administración"
          aria-label="Consola de administración"
        >
          ⚙️
        </Link>
        <button
          type="button"
          className="icon-btn"
          style={{ marginLeft: 12 }}
          onClick={handleLogout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          🚪
        </button>
        </div>
      </div>

      {permissionsError && (
        <div
          role="alert"
          style={{
            background: "#7A2E2E",
            color: "#fff",
            padding: "8px 16px",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          ⚠️ {permissionsError}
        </div>
      )}

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {showAutomations && <AutomationsModal onClose={() => setShowAutomations(false)} />}
      {showWorkspaceModal && <WorkspaceModal onClose={() => setShowWorkspaceModal(false)} />}
      {showMcpTokens && <McpTokensModal onClose={() => setShowMcpTokens(false)} />}
      {showRoles && <RolesModal onClose={() => setShowRoles(false)} />}
      {showAudit && <AuditExportModal onClose={() => setShowAudit(false)} />}
      {showMfa && <MfaSettingsModal onClose={() => setShowMfa(false)} />}
      {showSso && <SsoSettingsModal onClose={() => setShowSso(false)} />}
      {showMarketplace && <TemplateMarketplaceModal onClose={() => setShowMarketplace(false)} />}
      {showReports && <ReportsModal onClose={() => setShowReports(false)} />}
      {showIntegrations && <IntegrationsModal onClose={() => setShowIntegrations(false)} />}

      <div className="viewbar">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tab${pathname === tab.href ? " active" : ""}`}
          >
            {tab.label}
          </Link>
        ))}
        <div className="spacer" />
        {onNewTask && can("task.create") && (
          <button className="toolbtn primary" onClick={onNewTask}>
            ＋ Nueva tarea
          </button>
        )}
      </div>

      <main id="main-content">{children}</main>

      {toasts.length > 0 && (
        <div className="toast-stack" role="region" aria-label="Notificaciones">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast-${toast.tone}`}
              role={toast.tone === "error" ? "alert" : "status"}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Cerrar notificación"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
