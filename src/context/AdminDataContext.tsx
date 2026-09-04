"use client";

// Separado de BoardContext.tsx (revisión de calidad de código, 2026-09-04,
// hallazgo "contexto monolítico causa re-renders globales"): estos ~13
// campos son datos de paneles de administración (automatizaciones, roles,
// auditoría, integraciones, plantillas, MCP, métricas) que casi ningún
// componente del tablero (Board/Column/TaskCard/TableView/GanttView/
// CalendarView/WorkloadPanel/NotificationBell) necesita — antes vivían en
// el mismo useMemo que tasks/columns/permissions, así que cualquier cambio
// aquí (ej. tocar un toggle en Automatizaciones) forzaba un re-render de
// useBoard() completo, incluido el tablero principal. Debe montarse DENTRO
// de BoardProvider (usa useBoard() para tenantId/activeBoardId/userId).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useBoard } from "./BoardContext";
import { useToast } from "./ToastContext";
import {
  fetchAutomationRules,
  createAutomationRule,
  toggleAutomationRule,
  deleteAutomationRule,
  type AutomationRule,
  type AutomationTrigger,
  type AutomationAction,
  type AutomationCondition,
} from "@/lib/supabase/automations-repo";
import {
  fetchInboundWebhooks,
  createInboundWebhook,
  toggleInboundWebhook,
  type InboundWebhook,
} from "@/lib/supabase/webhooks-repo";
import { fetchMcpSessions, createMcpSession, revokeMcpSession, type McpSession } from "@/lib/supabase/mcp-repo";
import {
  fetchPermissionsCatalog,
  fetchRoles,
  createCustomRole,
  updateRolePermissions,
  deleteCustomRole,
  fetchMemberRoleIds,
  assignRoleToMember,
  type Permission,
  type OrgRole,
} from "@/lib/supabase/roles-repo";
import {
  fetchOrgSettings,
  updateOrgSettings as updateOrgSettingsRemote,
  fetchAuditLog,
  type OrgSecuritySettings,
  type AuditLogRow,
} from "@/lib/supabase/org-settings-repo";
import { fetchMetricsReport, generateTodaySnapshot, type MetricsReport } from "@/lib/supabase/metrics-repo";
import {
  fetchIntegrations,
  upsertIntegration,
  removeIntegration,
  type Integration,
  type IntegrationProvider,
} from "@/lib/supabase/integrations-repo";
import {
  fetchMarketplaceTemplates,
  fetchOwnTemplates,
  publishBoardAsTemplate,
  setTemplatePublished,
  type MarketplaceTemplate,
  type OwnTemplate,
} from "@/lib/supabase/templates-repo";
import type { Json } from "@/lib/supabase/database.types";

interface AdminDataContextValue {
  automationRules: AutomationRule[];
  createRule: (params: {
    name: string;
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  }) => Promise<{ ok: boolean; message: string }>;
  toggleRule: (ruleId: string, isActive: boolean) => void;
  deleteRule: (ruleId: string) => void;
  inboundWebhooks: InboundWebhook[];
  createWebhook: (columnId: string) => Promise<{ ok: boolean; message: string }>;
  toggleWebhook: (id: string, isActive: boolean) => void;
  mcpSessions: McpSession[];
  createMcpToken: (
    client: string,
    name: string,
    scopes: string[]
  ) => Promise<{ ok: true; sessionId: string; token: string } | { ok: false; message: string }>;
  revokeMcpToken: (id: string) => void;
  permissionsCatalog: Permission[];
  roles: OrgRole[];
  memberRoleIds: Record<string, string>;
  createRole: (name: string, permissionIds: string[]) => Promise<{ ok: boolean; message: string }>;
  updateRole: (roleId: string, permissionIds: string[]) => Promise<{ ok: boolean; message: string }>;
  deleteRoleById: (roleId: string) => Promise<{ ok: boolean; message: string }>;
  assignMemberRole: (userId: string, roleId: string) => Promise<{ ok: boolean; message: string }>;
  orgSettings: OrgSecuritySettings | null;
  auditLog: AuditLogRow[];
  updateOrgSettings: (
    patch: Partial<{
      auditRetentionDays: number;
      mfaRequired: boolean;
      ssoEnabled: boolean;
      ssoDomain: string | null;
      mcpTokensEnabled: boolean;
    }>
  ) => Promise<{ ok: boolean; message: string }>;
  exportAuditLog: (from?: string, to?: string) => Promise<AuditLogRow[]>;
  marketplaceTemplates: MarketplaceTemplate[];
  ownTemplates: OwnTemplate[];
  publishTemplate: (name: string, description: string) => Promise<{ ok: boolean; message: string }>;
  setTemplatePublic: (templateId: string, isPublic: boolean) => Promise<{ ok: boolean; message: string }>;
  fetchReport: (from: string, to: string) => Promise<MetricsReport>;
  generateSnapshot: () => Promise<{ ok: boolean; message: string }>;
  integrations: Integration[];
  saveIntegration: (
    provider: IntegrationProvider,
    config: Record<string, Json>,
    secret: string | null,
    isActive: boolean
  ) => Promise<{ ok: boolean; message: string }>;
  deleteIntegration: (integrationId: string) => Promise<{ ok: boolean; message: string }>;
}

const AdminDataContext = createContext<AdminDataContextValue | null>(null);

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const { supabase, tenantId, activeBoardId, activeWorkspaceId, userId } = useBoard();
  const { pushToast } = useToast();

  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [inboundWebhooks, setInboundWebhooks] = useState<InboundWebhook[]>([]);
  const [mcpSessions, setMcpSessions] = useState<McpSession[]>([]);
  const [permissionsCatalog, setPermissionsCatalog] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [memberRoleIds, setMemberRoleIds] = useState<Record<string, string>>({});
  const [orgSettings, setOrgSettings] = useState<OrgSecuritySettings | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogRow[]>([]);
  const [marketplaceTemplates, setMarketplaceTemplates] = useState<MarketplaceTemplate[]>([]);
  const [ownTemplates, setOwnTemplates] = useState<OwnTemplate[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  // Se dispara una vez por combinación tenant/board/workspace, igual que
  // loadForBoard en BoardContext (incluido el re-disparo en switchWorkspace).
  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tenantId || !activeBoardId || !activeWorkspaceId) return;
    const key = `${tenantId}:${activeBoardId}:${activeWorkspaceId}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;

    fetchAutomationRules(supabase, activeWorkspaceId)
      .then(setAutomationRules)
      .catch((err) => {
        console.error("No se pudieron cargar las reglas de automatización:", err);
        pushToast("No se pudieron cargar las reglas de automatización.");
      });

    fetchInboundWebhooks(supabase, activeBoardId)
      .then(setInboundWebhooks)
      .catch((err) => {
        console.error("No se pudieron cargar los webhooks entrantes:", err);
        pushToast("No se pudieron cargar los webhooks entrantes.");
      });

    if (userId) {
      fetchMcpSessions(supabase, userId)
        .then(setMcpSessions)
        .catch((err) => {
          console.error("No se pudieron cargar los tokens MCP:", err);
          pushToast("No se pudieron cargar los tokens MCP.");
        });
    }

    fetchPermissionsCatalog(supabase)
      .then(setPermissionsCatalog)
      .catch((err) => {
        console.error("No se pudo cargar el catálogo de permisos:", err);
        pushToast("No se pudo cargar el catálogo de permisos.");
      });

    fetchRoles(supabase, tenantId)
      .then(setRoles)
      .catch((err) => {
        console.error("No se pudieron cargar los roles:", err);
        pushToast("No se pudieron cargar los roles.");
      });

    fetchMemberRoleIds(supabase, tenantId)
      .then(setMemberRoleIds)
      .catch((err) => {
        console.error("No se pudieron cargar los roles de los miembros:", err);
        pushToast("No se pudieron cargar los roles de los miembros.");
      });

    fetchOrgSettings(supabase, tenantId)
      .then(setOrgSettings)
      .catch((err) => {
        console.error("No se pudo cargar la configuración de seguridad:", err);
        pushToast("No se pudo cargar la configuración de seguridad.");
      });

    fetchAuditLog(supabase, tenantId)
      .then(setAuditLog)
      .catch((err) => {
        console.error("No se pudo cargar el registro de auditoría:", err);
        pushToast("No se pudo cargar el registro de auditoría.");
      });

    fetchMarketplaceTemplates(supabase)
      .then(setMarketplaceTemplates)
      .catch((err) => {
        console.error("No se pudo cargar el marketplace de plantillas:", err);
        pushToast("No se pudo cargar el marketplace de plantillas.");
      });

    fetchOwnTemplates(supabase, tenantId)
      .then(setOwnTemplates)
      .catch((err) => {
        console.error("No se pudieron cargar tus plantillas:", err);
        pushToast("No se pudieron cargar tus plantillas.");
      });

    fetchIntegrations(supabase, tenantId)
      .then(setIntegrations)
      .catch((err) => {
        console.error("No se pudieron cargar las integraciones:", err);
        pushToast("No se pudieron cargar las integraciones.");
      });
  }, [tenantId, activeBoardId, activeWorkspaceId, userId, supabase, pushToast]);

  const createRule = useCallback(
    async (params: {
      name: string;
      trigger: AutomationTrigger;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
    }): Promise<{ ok: boolean; message: string }> => {
      if (!tenantId || !activeWorkspaceId) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        const rule = await createAutomationRule(supabase, {
          tenantId,
          workspaceId: activeWorkspaceId,
          name: params.name,
          trigger: params.trigger,
          conditions: params.conditions,
          actions: params.actions,
        });
        setAutomationRules((prev) => [rule, ...prev]);
        return { ok: true, message: `Regla "${rule.name}" creada.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo crear la regla." };
      }
    },
    [supabase, tenantId, activeWorkspaceId]
  );

  const toggleRule = useCallback(
    (ruleId: string, isActive: boolean) => {
      setAutomationRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, isActive } : r)));
      toggleAutomationRule(supabase, ruleId, isActive).catch((err) => {
        console.error("No se pudo actualizar la regla de automatización:", err);
        pushToast("No se pudo actualizar la regla de automatización, se revirtió.");
        if (activeWorkspaceId) fetchAutomationRules(supabase, activeWorkspaceId).then(setAutomationRules).catch(() => {});
      });
    },
    [supabase, activeWorkspaceId, pushToast]
  );

  const deleteRule = useCallback(
    (ruleId: string) => {
      setAutomationRules((prev) => prev.filter((r) => r.id !== ruleId));
      deleteAutomationRule(supabase, ruleId).catch((err) => {
        console.error("No se pudo eliminar la regla de automatización:", err);
        pushToast("No se pudo eliminar la regla, se restauró.");
        if (activeWorkspaceId) fetchAutomationRules(supabase, activeWorkspaceId).then(setAutomationRules).catch(() => {});
      });
    },
    [supabase, activeWorkspaceId, pushToast]
  );

  const createWebhook = useCallback(
    async (columnId: string): Promise<{ ok: boolean; message: string }> => {
      if (!tenantId || !activeBoardId) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        const hook = await createInboundWebhook(supabase, tenantId, activeBoardId, columnId);
        setInboundWebhooks((prev) => [hook, ...prev]);
        return { ok: true, message: "Webhook entrante creado." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo crear el webhook." };
      }
    },
    [supabase, tenantId, activeBoardId]
  );

  const toggleWebhook = useCallback(
    (id: string, isActive: boolean) => {
      setInboundWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, isActive } : w)));
      toggleInboundWebhook(supabase, id, isActive).catch((err) => {
        console.error("No se pudo actualizar el webhook entrante:", err);
        pushToast("No se pudo actualizar el webhook, se revirtió.");
        if (activeBoardId) fetchInboundWebhooks(supabase, activeBoardId).then(setInboundWebhooks).catch(() => {});
      });
    },
    [supabase, activeBoardId, pushToast]
  );

  const createMcpToken = useCallback(
    async (
      client: string,
      name: string,
      scopes: string[]
    ): Promise<{ ok: true; sessionId: string; token: string } | { ok: false; message: string }> => {
      try {
        const created = await createMcpSession(supabase, client, name, scopes);
        if (userId) fetchMcpSessions(supabase, userId).then(setMcpSessions).catch(() => {});
        return { ok: true, sessionId: created.sessionId, token: created.token };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo crear el token." };
      }
    },
    [supabase, userId]
  );

  const revokeMcpToken = useCallback(
    (id: string) => {
      setMcpSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, revokedAt: new Date().toISOString() } : s))
      );
      revokeMcpSession(supabase, id).catch((err) => {
        console.error("No se pudo revocar el token MCP:", err);
        pushToast("No se pudo revocar el token, se restauró.");
        if (userId) fetchMcpSessions(supabase, userId).then(setMcpSessions).catch(() => {});
      });
    },
    [supabase, userId, pushToast]
  );

  const createRole = useCallback(
    async (name: string, permissionIds: string[]): Promise<{ ok: boolean; message: string }> => {
      if (!tenantId) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        const role = await createCustomRole(supabase, tenantId, name, permissionIds);
        setRoles((prev) => [...prev, role]);
        return { ok: true, message: "Rol creado." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo crear el rol." };
      }
    },
    [supabase, tenantId]
  );

  const updateRole = useCallback(
    async (roleId: string, permissionIds: string[]): Promise<{ ok: boolean; message: string }> => {
      try {
        await updateRolePermissions(supabase, roleId, permissionIds);
        setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, permissionIds } : r)));
        return { ok: true, message: "Rol actualizado." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo actualizar el rol." };
      }
    },
    [supabase]
  );

  const deleteRoleById = useCallback(
    async (roleId: string): Promise<{ ok: boolean; message: string }> => {
      try {
        await deleteCustomRole(supabase, roleId);
        setRoles((prev) => prev.filter((r) => r.id !== roleId));
        return { ok: true, message: "Rol eliminado." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo eliminar el rol." };
      }
    },
    [supabase]
  );

  const assignMemberRole = useCallback(
    async (memberUserId: string, roleId: string): Promise<{ ok: boolean; message: string }> => {
      if (!tenantId) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        await assignRoleToMember(supabase, tenantId, memberUserId, roleId);
        setMemberRoleIds((prev) => ({ ...prev, [memberUserId]: roleId }));
        return { ok: true, message: "Rol asignado." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo asignar el rol." };
      }
    },
    [supabase, tenantId]
  );

  const updateOrgSettings = useCallback(
    async (
      patch: Partial<{
        auditRetentionDays: number;
        mfaRequired: boolean;
        ssoEnabled: boolean;
        ssoDomain: string | null;
        mcpTokensEnabled: boolean;
      }>
    ): Promise<{ ok: boolean; message: string }> => {
      if (!tenantId) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        await updateOrgSettingsRemote(supabase, tenantId, patch);
        setOrgSettings((prev) => (prev ? { ...prev, ...patch } : prev));
        return { ok: true, message: "Configuración guardada." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo guardar la configuración." };
      }
    },
    [supabase, tenantId]
  );

  const exportAuditLog = useCallback(
    async (from?: string, to?: string): Promise<AuditLogRow[]> => {
      if (!tenantId) return [];
      return fetchAuditLog(supabase, tenantId, { from, to, limit: 5000 });
    },
    [supabase, tenantId]
  );

  const publishTemplate = useCallback(
    async (name: string, description: string): Promise<{ ok: boolean; message: string }> => {
      if (!tenantId || !activeBoardId || !userId) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        await publishBoardAsTemplate(supabase, tenantId, activeBoardId, name, description, userId);
        const [own, marketplace] = await Promise.all([
          fetchOwnTemplates(supabase, tenantId),
          fetchMarketplaceTemplates(supabase),
        ]);
        setOwnTemplates(own);
        setMarketplaceTemplates(marketplace);
        return { ok: true, message: "Plantilla publicada en el marketplace." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo publicar la plantilla." };
      }
    },
    [supabase, tenantId, activeBoardId, userId]
  );

  const setTemplatePublic = useCallback(
    async (templateId: string, isPublic: boolean): Promise<{ ok: boolean; message: string }> => {
      if (!tenantId) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        await setTemplatePublished(supabase, templateId, isPublic);
        setOwnTemplates((prev) => prev.map((t) => (t.id === templateId ? { ...t, isPublic } : t)));
        const marketplace = await fetchMarketplaceTemplates(supabase);
        setMarketplaceTemplates(marketplace);
        return { ok: true, message: isPublic ? "Plantilla publicada." : "Plantilla despublicada." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo actualizar la plantilla." };
      }
    },
    [supabase, tenantId]
  );

  const fetchReport = useCallback(
    async (from: string, to: string): Promise<MetricsReport> => {
      if (!activeBoardId) return { throughput: [], cycleTime: [] };
      return fetchMetricsReport(supabase, activeBoardId, from, to);
    },
    [supabase, activeBoardId]
  );

  const generateSnapshot = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    if (!activeBoardId) return { ok: false, message: "El tablero todavía no está listo." };
    try {
      await generateTodaySnapshot(supabase, activeBoardId);
      return { ok: true, message: "Snapshot de hoy generado." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "No se pudo generar el snapshot." };
    }
  }, [supabase, activeBoardId]);

  const saveIntegration = useCallback(
    async (
      provider: IntegrationProvider,
      config: Record<string, Json>,
      secret: string | null,
      isActive: boolean
    ): Promise<{ ok: boolean; message: string }> => {
      if (!tenantId) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        await upsertIntegration(supabase, tenantId, provider, config, secret, isActive);
        const updated = await fetchIntegrations(supabase, tenantId);
        setIntegrations(updated);
        return { ok: true, message: "Integración guardada." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo guardar la integración." };
      }
    },
    [supabase, tenantId]
  );

  const deleteIntegration = useCallback(
    async (integrationId: string): Promise<{ ok: boolean; message: string }> => {
      try {
        await removeIntegration(supabase, integrationId);
        setIntegrations((prev) => prev.filter((i) => i.id !== integrationId));
        return { ok: true, message: "Integración eliminada." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo eliminar la integración." };
      }
    },
    [supabase]
  );

  const value = useMemo<AdminDataContextValue>(
    () => ({
      automationRules,
      createRule,
      toggleRule,
      deleteRule,
      inboundWebhooks,
      createWebhook,
      toggleWebhook,
      mcpSessions,
      createMcpToken,
      revokeMcpToken,
      permissionsCatalog,
      roles,
      memberRoleIds,
      createRole,
      updateRole,
      deleteRoleById,
      assignMemberRole,
      orgSettings,
      auditLog,
      updateOrgSettings,
      exportAuditLog,
      marketplaceTemplates,
      ownTemplates,
      publishTemplate,
      setTemplatePublic,
      fetchReport,
      generateSnapshot,
      integrations,
      saveIntegration,
      deleteIntegration,
    }),
    [
      automationRules,
      createRule,
      toggleRule,
      deleteRule,
      inboundWebhooks,
      createWebhook,
      toggleWebhook,
      mcpSessions,
      createMcpToken,
      revokeMcpToken,
      permissionsCatalog,
      roles,
      memberRoleIds,
      createRole,
      updateRole,
      deleteRoleById,
      assignMemberRole,
      orgSettings,
      auditLog,
      updateOrgSettings,
      exportAuditLog,
      marketplaceTemplates,
      ownTemplates,
      publishTemplate,
      setTemplatePublic,
      fetchReport,
      generateSnapshot,
      integrations,
      saveIntegration,
      deleteIntegration,
    ]
  );

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

export function useAdminData(): AdminDataContextValue {
  const ctx = useContext(AdminDataContext);
  if (!ctx) throw new Error("useAdminData must be used within an AdminDataProvider");
  return ctx;
}
