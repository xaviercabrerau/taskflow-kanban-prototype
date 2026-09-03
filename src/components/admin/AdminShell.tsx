"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { useBoard } from "@/context/BoardContext";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  ownerOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Organización",
    items: [
      { href: "/admin/usuarios", label: "Usuarios", icon: "👥" },
      { href: "/admin/workspaces", label: "Workspaces", icon: "📋" },
      { href: "/admin/roles", label: "Roles y permisos", icon: "🛡️", ownerOnly: true },
    ],
  },
  {
    label: "Producto",
    items: [
      { href: "/admin/planificacion", label: "Épicas y Sprints", icon: "🎯" },
      { href: "/admin/automatizaciones", label: "Automatizaciones", icon: "⚡" },
      { href: "/admin/campos-personalizados", label: "Campos personalizados", icon: "🏷️" },
      { href: "/admin/plantillas", label: "Plantillas", icon: "🧩" },
      { href: "/admin/reportes", label: "Reportes", icon: "📊" },
      { href: "/admin/integraciones", label: "Integraciones", icon: "🔌", ownerOnly: true },
    ],
  },
  {
    label: "Seguridad",
    items: [
      { href: "/admin/seguridad", label: "Seguridad y acceso", icon: "🔐" },
      { href: "/admin/auditoria", label: "Auditoría", icon: "📜" },
      { href: "/admin/api-keys", label: "API Keys (MCP)", icon: "🔑" },
    ],
  },
];

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isOwner } = useBoard();

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "dark";
    return () => {
      if (previous) root.dataset.theme = previous;
      else delete root.dataset.theme;
    };
  }, []);

  return (
    <div className="admin-shell">
      <nav className="admin-sidebar" aria-label="Navegación de administración">
        <div className="admin-brand">
          <span className="dot" />
          TaskFlow Admin
        </div>
        <Link href="/" className="admin-back-link">
          ← Volver al tablero
        </Link>
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => !item.ownerOnly || isOwner);
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label}>
              <div className="admin-nav-group">{group.label}</div>
              {visibleItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`admin-nav-item${pathname === item.href ? " active" : ""}`}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="admin-content">{children}</div>
    </div>
  );
}
