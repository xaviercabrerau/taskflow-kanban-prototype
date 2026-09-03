"use client";

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
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { BoardState, Task } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "./ToastContext";
import type { Database } from "@/lib/supabase/database.types";
import {
  ensureBootstrap,
  reseedBoard,
  listWorkspaces,
  type BoardHandle,
  type WorkspaceSummary,
} from "@/lib/supabase/bootstrap";
import {
  createWorkspaceFromTemplate,
  fetchMarketplaceTemplates,
  fetchOwnTemplates,
  publishBoardAsTemplate,
  setTemplatePublished,
  type BoardTemplate,
  type MarketplaceTemplate,
  type OwnTemplate,
} from "@/lib/supabase/templates-repo";
import {
  fetchBoardState,
  insertTask,
  updateTaskFields,
  moveTaskRemote,
  deleteTaskRemote,
  nextPosition,
  insertColumn,
} from "@/lib/supabase/board-repo";
import { fetchMembers, inviteMemberByEmail, type OrgMember } from "@/lib/supabase/members-repo";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
  type AppNotification,
} from "@/lib/supabase/notifications-repo";
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
import {
  fetchMcpSessions,
  createMcpSession,
  revokeMcpSession,
  type McpSession,
} from "@/lib/supabase/mcp-repo";
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
import type { Json } from "@/lib/supabase/database.types";

const EMPTY_STATE: BoardState = { tasks: {}, columns: [] };
const COLUMN_COLOR_CYCLE = ["--low", "--medium", "--accent", "--muted", "--high"];

interface BoardContextValue {
  supabase: SupabaseClient<Database>;
  userId: string | null;
  tenantId: string | null;
  activeBoardId: string | null;
  activeWorkspaceId: string | null;
  state: BoardState;
  loading: boolean;
  isOwner: boolean;
  members: OrgMember[];
  permissions: Set<string>;
  permissionsError: string | null;
  can: (permissionKey: string) => boolean;
  moveTask: (taskId: string, toColumnId: string, toIndex: number) => void;
  addTask: (columnId: string, task: Task) => void;
  addColumn: (label: string) => Promise<{ ok: boolean; message: string }>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  updateTask: (task: Task) => void;
  deleteTask: (taskId: string) => void;
  reset: () => void;
  inviteMember: (email: string) => Promise<{ ok: boolean; message: string }>;
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (notificationId: string) => void;
  markAllRead: () => void;
  automationRules: AutomationRule[];
  createRule: (params: {
    name: string;
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  }) => Promise<{ ok: boolean; message: string }>;
  toggleRule: (ruleId: string, isActive: boolean) => void;
  deleteRule: (ruleId: string) => void;
  workspaces: WorkspaceSummary[];
  switchWorkspace: (target: { boardId: string; workspaceId: string }) => void;
  createWorkspace: (name: string, icon: string, template: BoardTemplate) => Promise<{ ok: boolean; message: string }>;
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

const BoardContext = createContext<BoardContextValue | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState<SupabaseClient<Database>>(() => createClient());
  const router = useRouter();
  const pathname = usePathname();

  const boardRef = useRef<BoardHandle | null>(null);
  const positionsRef = useRef<Record<string, number>>({});
  // Evita recargar el pipeline completo (load()) en cada navegación entre
  // tabs; solo se resetea en una transición real de sesión (sign-in/sign-out).
  const hasLoadedRef = useRef(false);
  // "Latest ref" para leer el pathname actual dentro del efecto de sesión sin
  // que `pathname` sea dependencia del efecto (eso es lo que forzaba recargar
  // load() en cada cambio de ruta).
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const [state, setState] = useState<BoardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
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
  // toasts/dismissToast ya no viven aquí — ver ToastContext.tsx
  // (AUDITORIA_2026-09-03.md, hallazgo 11). pushToast sigue siendo el
  // mecanismo de feedback para fallos que antes solo iban a console.error
  // (un fetch silencioso en loadForBoard, o una acción optimista que se
  // revierte porque la llamada remota falló), solo que ahora viene de un
  // contexto separado para no forzar un re-render de todo useBoard() cada
  // vez que un toast aparece o se auto-descarta.
  const { pushToast } = useToast();

  // Contador monotónico para descartar respuestas de loadForBoard fuera de
  // orden (p.ej. doble click en switchWorkspace): solo la llamada más
  // reciente puede escribir en el estado.
  const loadRequestIdRef = useRef(0);

  // Carga todo el estado dependiente de un board concreto. Usado tanto en el
  // primer load() (tras ensureBootstrap) como en switchWorkspace() (cambio
  // de área de trabajo sin recrear la sesión/organización).
  const loadForBoard = useCallback(
    async (board: BoardHandle) => {
      const requestId = ++loadRequestIdRef.current;
      const isStale = () => requestId !== loadRequestIdRef.current;

      boardRef.current = board;
      setIsOwner(board.isOwner);
      setUserId(board.userId);
      setBoardId(board.boardId);
      setActiveWorkspaceId(board.workspaceId);
      setTenantId(board.tenantId);
      const { state: fetched, positions } = await fetchBoardState(supabase, board);
      if (isStale()) return;
      positionsRef.current = positions;
      setState(fetched);
      setLoading(false);
      // Cualquier miembro de la organización puede ver la lista completa vía
      // el RPC list_org_members (ver members-repo.ts) — ya no depende de ser
      // owner.
      fetchMembers(supabase, board.tenantId)
        .then((v) => { if (!isStale()) setMembers(v); })
        .catch((err) => {
          console.error("No se pudo cargar la lista de miembros:", err);
          pushToast("No se pudo cargar la lista de miembros.");
        });

      listWorkspaces(supabase, board.tenantId)
        .then((v) => { if (!isStale()) setWorkspaces(v); })
        .catch((err) => {
          console.error("No se pudieron cargar las áreas de trabajo:", err);
          pushToast("No se pudieron cargar las áreas de trabajo.");
        });

      // RBAC granular (Sección 1.4): permisos reales del usuario sobre este
      // board (el owner los recibe todos vía el bypass de has_permission()).
      // Nota: el builder de supabase-js es "thenable" pero no un Promise real
      // (no expone .catch), por eso se resuelve con await + try/catch en vez
      // de encadenar .then().catch().
      try {
        const { data, error } = await supabase.rpc("my_permissions", { bid: board.boardId });
        if (error) throw error;
        if (!isStale()) {
          setPermissions(new Set(data ?? []));
          setPermissionsError(null);
        }
      } catch (err) {
        console.error("No se pudieron cargar los permisos:", err);
        if (!isStale()) {
          setPermissionsError(
            "No se pudieron cargar tus permisos, algunas acciones pueden no estar disponibles. Recarga la página."
          );
        }
      }

      fetchNotifications(supabase, board.userId)
        .then((v) => { if (!isStale()) setNotifications(v); })
        .catch((err) => {
          console.error("No se pudieron cargar las notificaciones:", err);
          pushToast("No se pudieron cargar las notificaciones.");
        });

      fetchAutomationRules(supabase, board.workspaceId)
        .then((v) => { if (!isStale()) setAutomationRules(v); })
        .catch((err) => {
          console.error("No se pudieron cargar las reglas de automatización:", err);
          pushToast("No se pudieron cargar las reglas de automatización.");
        });

      fetchInboundWebhooks(supabase, board.boardId)
        .then((v) => { if (!isStale()) setInboundWebhooks(v); })
        .catch((err) => {
          console.error("No se pudieron cargar los webhooks entrantes:", err);
          pushToast("No se pudieron cargar los webhooks entrantes.");
        });

      fetchMcpSessions(supabase, board.userId)
        .then((v) => { if (!isStale()) setMcpSessions(v); })
        .catch((err) => {
          console.error("No se pudieron cargar los tokens MCP:", err);
          pushToast("No se pudieron cargar los tokens MCP.");
        });

      fetchPermissionsCatalog(supabase)
        .then((v) => { if (!isStale()) setPermissionsCatalog(v); })
        .catch((err) => {
          console.error("No se pudo cargar el catálogo de permisos:", err);
          pushToast("No se pudo cargar el catálogo de permisos.");
        });

      fetchRoles(supabase, board.tenantId)
        .then((v) => { if (!isStale()) setRoles(v); })
        .catch((err) => {
          console.error("No se pudieron cargar los roles:", err);
          pushToast("No se pudieron cargar los roles.");
        });

      fetchMemberRoleIds(supabase, board.tenantId)
        .then((v) => { if (!isStale()) setMemberRoleIds(v); })
        .catch((err) => {
          console.error("No se pudieron cargar los roles de los miembros:", err);
          pushToast("No se pudieron cargar los roles de los miembros.");
        });

      fetchOrgSettings(supabase, board.tenantId)
        .then((v) => { if (!isStale()) setOrgSettings(v); })
        .catch((err) => {
          console.error("No se pudo cargar la configuración de seguridad:", err);
          pushToast("No se pudo cargar la configuración de seguridad.");
        });

      fetchAuditLog(supabase, board.tenantId)
        .then((v) => { if (!isStale()) setAuditLog(v); })
        .catch((err) => {
          console.error("No se pudo cargar el registro de auditoría:", err);
          pushToast("No se pudo cargar el registro de auditoría.");
        });

      fetchMarketplaceTemplates(supabase)
        .then((v) => { if (!isStale()) setMarketplaceTemplates(v); })
        .catch((err) => {
          console.error("No se pudo cargar el marketplace de plantillas:", err);
          pushToast("No se pudo cargar el marketplace de plantillas.");
        });

      fetchOwnTemplates(supabase, board.tenantId)
        .then((v) => { if (!isStale()) setOwnTemplates(v); })
        .catch((err) => {
          console.error("No se pudieron cargar tus plantillas:", err);
          pushToast("No se pudieron cargar tus plantillas.");
        });

      fetchIntegrations(supabase, board.tenantId)
        .then((v) => { if (!isStale()) setIntegrations(v); })
        .catch((err) => {
          console.error("No se pudieron cargar las integraciones:", err);
          pushToast("No se pudieron cargar las integraciones.");
        });
    },
    [supabase, pushToast]
  );

  const load = useCallback(async () => {
    const board = await ensureBootstrap(supabase);
    await loadForBoard(board);
  }, [supabase, loadForBoard]);

  const switchWorkspace = useCallback(
    (target: { boardId: string; workspaceId: string }) => {
      const current = boardRef.current;
      if (!current) return;
      setLoading(true);
      setSearchQuery("");
      const promise = loadForBoard({ ...current, boardId: target.boardId, workspaceId: target.workspaceId });
      // loadForBoard incrementa loadRequestIdRef de forma síncrona antes de su
      // primer await, así que ya refleja el id de esta llamada en este punto.
      const requestId = loadRequestIdRef.current;
      promise.catch((err) => {
        console.error("No se pudo cambiar de área de trabajo:", err);
        if (requestId === loadRequestIdRef.current) setLoading(false);
      });
    },
    [loadForBoard]
  );

  const createWorkspace = useCallback(
    async (name: string, icon: string, template: BoardTemplate): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      if (!board.isOwner) return { ok: false, message: "Solo el propietario puede crear áreas de trabajo." };
      try {
        const created = await createWorkspaceFromTemplate(supabase, board.tenantId, name, icon, template);
        switchWorkspace({ boardId: created.boardId, workspaceId: created.workspaceId });
        return { ok: true, message: `Área de trabajo "${name}" creada.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo crear el área de trabajo." };
      }
    },
    [supabase, switchWorkspace]
  );

  useEffect(() => {
    let cancelled = false;

    // BoardProvider envuelve toda la app, incluida /login y /reset-password —
    // un visitante sin sesión (p.ej. viendo la pantalla de login, o abriendo
    // el enlace de recuperación de contraseña antes de que el cliente procese
    // el token de la URL) llega aquí antes de autenticarse. Eso no es una
    // falla real: así que si no hay sesión, salimos en silencio sin loguear
    // un error esperado como si fuera un bug.
    // No había ningún guard que mandara a /login en este caso — sin
    // middleware, un visitante sin sesión veía el shell completo de la
    // app (topbar, tabs, iconos) con un tablero vacío y ningún mensaje.
    // /reset-password se excluye del mismo modo que /login: si no, este
    // efecto redirige a /login antes de que la página pueda procesar el
    // enlace de recuperación, anulando la excepción hecha para esa ruta en
    // src/proxy.ts.
    const applySession = async (session: Session | null) => {
      if (cancelled) return;
      if (!session) {
        setLoading(false);
        hasLoadedRef.current = false;
        const isPublicAuthRoute =
          pathnameRef.current === "/login" ||
          pathnameRef.current?.startsWith("/reset-password") ||
          pathnameRef.current?.startsWith("/share/");
        if (!isPublicAuthRoute) {
          router.replace("/login");
        }
        return;
      }
      // load() trae ~13 fetches en paralelo; con BoardProvider envolviendo
      // todas las rutas (Kanban/Tabla/Gantt/Calendario/Dashboard), este efecto
      // no debe dispararlo de nuevo en cada navegación entre tabs — solo una
      // vez por sesión autenticada.
      if (hasLoadedRef.current) return;
      hasLoadedRef.current = true;
      try {
        await load();
      } catch (err) {
        console.error("No se pudo cargar el tablero desde Supabase:", err);
        setLoading(false);
        hasLoadedRef.current = false; // permite reintentar en el próximo chequeo de sesión
      }
    };

    supabase.auth.getSession().then(
      ({ data }) => applySession(data.session),
      (err) => {
        console.error("No se pudo obtener la sesión de Supabase:", err);
        setLoading(false);
      }
    );

    // Reacciona a cambios reales de sesión (sign-in/sign-out/expiración) sin
    // depender de `pathname` en el arreglo de dependencias del efecto.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return; // ya cubierto por getSession() arriba
      applySession(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [load, supabase, router]);

  // Push en tiempo real: cuando un trigger del backend inserta una
  // notificación nueva (task movida, vencimiento próximo), aparece sin
  // recargar. Se resuscribe si cambia el usuario (p.ej. tras cerrar sesión).
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeToNotifications(supabase, userId, (n) => {
      setNotifications((prev) => [n, ...prev]);
    });
    return unsubscribe;
  }, [supabase, userId]);

  // Reconciliación en tiempo real (mínima, sin merge fino): si otro usuario
  // inserta/actualiza/borra una tarea o una columna de este board, volvemos a
  // pedir el estado completo con fetchBoardState y reemplazamos el state local.
  // Debounce corto para no re-fetchear en cascada si llegan varios eventos
  // juntos (p.ej. un drag que dispara varios UPDATE). No intenta resolver
  // conflictos con una edición optimista propia en curso; el debounce de
  // 400ms es suficiente para este prototipo.
  useEffect(() => {
    if (!boardId) return;
    const board = boardRef.current;
    if (!board) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchBoardState(supabase, board)
          .then(({ state: fetched, positions }) => {
            positionsRef.current = positions;
            setState(fetched);
          })
          .catch((err) => console.error("No se pudo resincronizar el tablero en tiempo real:", err));
      }, 400);
    };

    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `board_id=eq.${boardId}` },
        scheduleRefetch
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "board_columns", filter: `board_id=eq.${boardId}` },
        scheduleRefetch
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [supabase, boardId]);

  const moveTask = useCallback(
    (taskId: string, toColumnId: string, toIndex: number) => {
      // El cálculo vive dentro del updater para leer `prev` (estado real al
      // aplicar el update), no el `state` cerrado en este callback; la
      // llamada remota se hace fuera para no disparar el side effect dos
      // veces si React invoca el updater más de una vez (p.ej. StrictMode).
      let newPosition: number | undefined;
      setState((prev) => {
        const columns = prev.columns.map((col) => ({
          ...col,
          taskIds: col.taskIds.filter((id) => id !== taskId),
        }));
        const target = columns.find((c) => c.id === toColumnId);
        if (!target) return prev;
        const clampedIndex = Math.max(0, Math.min(toIndex, target.taskIds.length));
        target.taskIds.splice(clampedIndex, 0, taskId);

        const prevId = target.taskIds[clampedIndex - 1];
        const nextId = target.taskIds[clampedIndex + 1];
        newPosition = nextPosition(
          prevId ? positionsRef.current[prevId] : undefined,
          nextId ? positionsRef.current[nextId] : undefined
        );

        return { ...prev, columns };
      });

      if (newPosition === undefined) return;
      positionsRef.current[taskId] = newPosition;
      moveTaskRemote(supabase, taskId, toColumnId, newPosition).catch((err) => {
        console.error("No se pudo mover la tarea en Supabase (¿falta el permiso task.update?):", err);
        pushToast("No se pudo mover la tarea, se revirtió el cambio.");
        load(); // revierte el movimiento optimista resincronizando desde la BD
      });
    },
    [supabase, load, pushToast]
  );

  const addTask = useCallback(
    (columnId: string, task: Task) => {
      const board = boardRef.current;
      if (!board) return;
      const firstIdInColumn = state.columns.find((c) => c.id === columnId)?.taskIds[0];
      const newPosition = nextPosition(
        undefined,
        firstIdInColumn ? positionsRef.current[firstIdInColumn] : undefined
      );
      insertTask(supabase, board, columnId, task, newPosition)
        .then((realId) => {
          positionsRef.current[realId] = newPosition;
          setState((prev) => ({
            columns: prev.columns.map((col) =>
              col.id === columnId ? { ...col, taskIds: [realId, ...col.taskIds] } : col
            ),
            tasks: { ...prev.tasks, [realId]: { ...task, id: realId } },
          }));
        })
        .catch((err) => {
          console.error("No se pudo crear la tarea en Supabase (¿falta el permiso task.create?):", err);
          pushToast("No se pudo crear la tarea.");
          load();
        });
    },
    [supabase, state.columns, load, pushToast]
  );

  const addColumn = useCallback(
    async (label: string): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      const trimmed = label.trim();
      if (!trimmed) return { ok: false, message: "El nombre de la columna no puede estar vacío." };
      const colorVar = COLUMN_COLOR_CYCLE[state.columns.length % COLUMN_COLOR_CYCLE.length];
      try {
        const newColumn = await insertColumn(supabase, board.boardId, trimmed, colorVar, state.columns.length);
        setState((prev) => ({ ...prev, columns: [...prev.columns, newColumn] }));
        return { ok: true, message: `Columna "${trimmed}" creada.` };
      } catch (err) {
        console.error("No se pudo crear la columna (¿falta el permiso board.manage?):", err);
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo crear la columna." };
      }
    },
    [supabase, state.columns]
  );

  const updateTask = useCallback(
    (task: Task) => {
      setState((prev) => ({ ...prev, tasks: { ...prev.tasks, [task.id]: task } }));
      updateTaskFields(supabase, task).catch((err) => {
        console.error("No se pudo actualizar la tarea en Supabase (¿falta el permiso task.update?):", err);
        pushToast("No se pudo guardar el cambio, se revirtió.");
        load();
      });
    },
    [supabase, load, pushToast]
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      setState((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [taskId]: _removed, ...rest } = prev.tasks;
        const columns = prev.columns.map((col) => ({
          ...col,
          taskIds: col.taskIds.filter((id) => id !== taskId),
        }));
        return { tasks: rest, columns };
      });
      delete positionsRef.current[taskId];
      deleteTaskRemote(supabase, taskId).catch((err) => {
        console.error("No se pudo eliminar la tarea en Supabase (¿falta el permiso task.delete?):", err);
        pushToast("No se pudo eliminar la tarea, se restauró.");
        load();
      });
    },
    [supabase, load, pushToast]
  );

  const reset = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    setLoading(true);
    setSearchQuery("");
    reseedBoard(supabase, board)
      .then(() => fetchBoardState(supabase, board))
      .then(({ state: fetched, positions }) => {
        positionsRef.current = positions;
        setState(fetched);
        setLoading(false);
      })
      .catch((err) => {
        console.error("No se pudo reiniciar el tablero en Supabase:", err);
        setLoading(false);
      });
  }, [supabase]);

  const inviteMember = useCallback(
    async (email: string): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        const member = await inviteMemberByEmail(supabase, board.tenantId, email);
        setMembers((prev) => [...prev, member]);
        return {
          ok: true,
          message: member.roleWarning ?? `${member.email ?? "Usuario"} agregado a la organización.`,
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo invitar al usuario." };
      }
    },
    [supabase]
  );

  const markRead = useCallback(
    (notificationId: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n))
      );
      markNotificationRead(supabase, notificationId).catch((err) => {
        console.error("No se pudo marcar la notificación como leída:", err);
        pushToast("No se pudo marcar la notificación como leída.");
      });
    },
    [supabase, pushToast]
  );

  const markAllRead = useCallback(() => {
    if (!userId) return;
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    markAllNotificationsRead(supabase, userId).catch((err) => {
      console.error("No se pudieron marcar todas las notificaciones como leídas:", err);
      pushToast("No se pudieron marcar todas las notificaciones como leídas.");
    });
  }, [supabase, userId, pushToast]);

  const createRule = useCallback(
    async (params: {
      name: string;
      trigger: AutomationTrigger;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
    }): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        const rule = await createAutomationRule(supabase, {
          tenantId: board.tenantId,
          workspaceId: board.workspaceId,
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
    [supabase]
  );

  const toggleRule = useCallback(
    (ruleId: string, isActive: boolean) => {
      setAutomationRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, isActive } : r)));
      toggleAutomationRule(supabase, ruleId, isActive).catch((err) => {
        console.error("No se pudo actualizar la regla de automatización:", err);
        pushToast("No se pudo actualizar la regla de automatización, se revirtió.");
        load();
      });
    },
    [supabase, load, pushToast]
  );

  const deleteRule = useCallback(
    (ruleId: string) => {
      setAutomationRules((prev) => prev.filter((r) => r.id !== ruleId));
      deleteAutomationRule(supabase, ruleId).catch((err) => {
        console.error("No se pudo eliminar la regla de automatización:", err);
        pushToast("No se pudo eliminar la regla, se restauró.");
        load();
      });
    },
    [supabase, load, pushToast]
  );

  const createWebhook = useCallback(
    async (columnId: string): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        const hook = await createInboundWebhook(supabase, board.tenantId, board.boardId, columnId);
        setInboundWebhooks((prev) => [hook, ...prev]);
        return { ok: true, message: "Webhook entrante creado." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo crear el webhook." };
      }
    },
    [supabase]
  );

  const toggleWebhook = useCallback(
    (id: string, isActive: boolean) => {
      setInboundWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, isActive } : w)));
      toggleInboundWebhook(supabase, id, isActive).catch((err) => {
        console.error("No se pudo actualizar el webhook entrante:", err);
        pushToast("No se pudo actualizar el webhook, se revirtió.");
        load();
      });
    },
    [supabase, load, pushToast]
  );

  const createMcpToken = useCallback(
    async (
      client: string,
      name: string,
      scopes: string[]
    ): Promise<{ ok: true; sessionId: string; token: string } | { ok: false; message: string }> => {
      try {
        const created = await createMcpSession(supabase, client, name, scopes);
        load();
        return { ok: true, sessionId: created.sessionId, token: created.token };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo crear el token." };
      }
    },
    [supabase, load]
  );

  const revokeMcpToken = useCallback(
    (id: string) => {
      setMcpSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, revokedAt: new Date().toISOString() } : s))
      );
      revokeMcpSession(supabase, id).catch((err) => {
        console.error("No se pudo revocar el token MCP:", err);
        pushToast("No se pudo revocar el token, se restauró.");
        load();
      });
    },
    [supabase, load, pushToast]
  );

  const createRole = useCallback(
    async (name: string, permissionIds: string[]): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        const role = await createCustomRole(supabase, board.tenantId, name, permissionIds);
        setRoles((prev) => [...prev, role]);
        return { ok: true, message: "Rol creado." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo crear el rol." };
      }
    },
    [supabase]
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
    async (userId: string, roleId: string): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        await assignRoleToMember(supabase, board.tenantId, userId, roleId);
        setMemberRoleIds((prev) => ({ ...prev, [userId]: roleId }));
        return { ok: true, message: "Rol asignado." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo asignar el rol." };
      }
    },
    [supabase]
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
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        await updateOrgSettingsRemote(supabase, board.tenantId, patch);
        setOrgSettings((prev) => (prev ? { ...prev, ...patch } : prev));
        return { ok: true, message: "Configuración guardada." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo guardar la configuración." };
      }
    },
    [supabase]
  );

  const exportAuditLog = useCallback(
    async (from?: string, to?: string): Promise<AuditLogRow[]> => {
      const board = boardRef.current;
      if (!board) return [];
      return fetchAuditLog(supabase, board.tenantId, { from, to, limit: 5000 });
    },
    [supabase]
  );

  const publishTemplate = useCallback(
    async (name: string, description: string): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        await publishBoardAsTemplate(supabase, board.tenantId, board.boardId, name, description, board.userId);
        const [own, marketplace] = await Promise.all([
          fetchOwnTemplates(supabase, board.tenantId),
          fetchMarketplaceTemplates(supabase),
        ]);
        setOwnTemplates(own);
        setMarketplaceTemplates(marketplace);
        return { ok: true, message: "Plantilla publicada en el marketplace." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo publicar la plantilla." };
      }
    },
    [supabase]
  );

  const setTemplatePublic = useCallback(
    async (templateId: string, isPublic: boolean): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
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
    [supabase]
  );

  const fetchReport = useCallback(
    async (from: string, to: string): Promise<MetricsReport> => {
      const board = boardRef.current;
      if (!board) return { throughput: [], cycleTime: [] };
      return fetchMetricsReport(supabase, board.boardId, from, to);
    },
    [supabase]
  );

  const generateSnapshot = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const board = boardRef.current;
    if (!board) return { ok: false, message: "El tablero todavía no está listo." };
    try {
      await generateTodaySnapshot(supabase, board.boardId);
      return { ok: true, message: "Snapshot de hoy generado." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "No se pudo generar el snapshot." };
    }
  }, [supabase]);

  const saveIntegration = useCallback(
    async (
      provider: IntegrationProvider,
      config: Record<string, Json>,
      secret: string | null,
      isActive: boolean
    ): Promise<{ ok: boolean; message: string }> => {
      const board = boardRef.current;
      if (!board) return { ok: false, message: "El tablero todavía no está listo." };
      try {
        await upsertIntegration(supabase, board.tenantId, provider, config, secret, isActive);
        const updated = await fetchIntegrations(supabase, board.tenantId);
        setIntegrations(updated);
        return { ok: true, message: "Integración guardada." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo guardar la integración." };
      }
    },
    [supabase]
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

  const unreadCount = useMemo(() => notifications.filter((n) => !n.readAt).length, [notifications]);

  const can = useCallback((permissionKey: string) => permissions.has(permissionKey), [permissions]);

  const value = useMemo<BoardContextValue>(
    () => ({
      supabase,
      userId,
      tenantId,
      activeBoardId: boardId,
      activeWorkspaceId,
      state,
      loading,
      isOwner,
      members,
      permissions,
      permissionsError,
      can,
      moveTask,
      addTask,
      addColumn,
      searchQuery,
      setSearchQuery,
      updateTask,
      deleteTask,
      reset,
      inviteMember,
      notifications,
      unreadCount,
      markRead,
      markAllRead,
      automationRules,
      createRule,
      toggleRule,
      deleteRule,
      workspaces,
      switchWorkspace,
      createWorkspace,
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
      supabase,
      userId,
      tenantId,
      boardId,
      activeWorkspaceId,
      state,
      loading,
      isOwner,
      members,
      permissions,
      permissionsError,
      can,
      moveTask,
      addTask,
      addColumn,
      searchQuery,
      setSearchQuery,
      updateTask,
      deleteTask,
      reset,
      inviteMember,
      notifications,
      unreadCount,
      markRead,
      markAllRead,
      automationRules,
      createRule,
      toggleRule,
      deleteRule,
      workspaces,
      switchWorkspace,
      createWorkspace,
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

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard must be used within a BoardProvider");
  return ctx;
}
