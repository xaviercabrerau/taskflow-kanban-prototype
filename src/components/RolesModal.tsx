"use client";

import { useMemo, useRef, useState } from "react";
import { useBoard } from "@/context/BoardContext";
import { useAdminData } from "@/context/AdminDataContext";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { Permission } from "@/lib/supabase/roles-repo";

interface RolesModalProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function RolesModal({ onClose, embedded = false }: RolesModalProps) {
  const { isOwner } = useBoard();
  const { permissionsCatalog, roles, createRole, updateRole, deleteRoleById } = useAdminData();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, onClose, !embedded);

  const [name, setName] = useState("");
  const [newRolePermissions, setNewRolePermissions] = useState<Set<string>>(new Set());
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const byCategory = useMemo(() => {
    const groups: Record<string, Permission[]> = {};
    for (const perm of permissionsCatalog) {
      groups[perm.category] = groups[perm.category] ?? [];
      groups[perm.category].push(perm);
    }
    return groups;
  }, [permissionsCatalog]);

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const result = await createRole(name.trim(), Array.from(newRolePermissions));
    setSaving(false);
    setFeedback(result);
    if (result.ok) {
      setName("");
      setNewRolePermissions(new Set());
    }
  }

  function startEditing(roleId: string, currentPermissionIds: string[]) {
    setEditingRoleId(roleId);
    setEditingPermissions(new Set(currentPermissionIds));
  }

  async function handleSaveEdit() {
    if (!editingRoleId) return;
    setSaving(true);
    const result = await updateRole(editingRoleId, Array.from(editingPermissions));
    setSaving(false);
    setFeedback(result);
    if (result.ok) setEditingRoleId(null);
  }

  async function handleDelete(roleId: string, roleName: string) {
    const confirmed = window.confirm(`¿Eliminar el rol "${roleName}"? Los miembros que lo tengan asignado quedarán sin ese rol.`);
    if (!confirmed) return;
    const result = await deleteRoleById(roleId);
    setFeedback(result);
  }

  function permissionCheckboxes(selected: Set<string>, onToggle: (id: string) => void) {
    return Object.entries(byCategory).map(([category, perms]) => (
      <div key={category} style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{category}</div>
        {perms.map((perm) => (
          <label key={perm.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "2px 0" }}>
            <input type="checkbox" checked={selected.has(perm.id)} onChange={() => onToggle(perm.id)} />
            <span>{perm.description ?? perm.key}</span>
          </label>
        ))}
      </div>
    ));
  }

  const panel = (
      <div
        className={embedded ? "admin-panel" : "modal"}
        style={embedded ? undefined : { width: 520 }}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        ref={modalRef}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="roles-modal-title"
      >
        <div className="modal-head">
          <h2 id="roles-modal-title">Roles y permisos</h2>
          {!embedded && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">
          <div className="field" style={{ marginBottom: 16 }}>
            {roles.map((role) => (
              <div
                key={role.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {role.name} {role.isSystem && <span style={{ color: "var(--muted)", fontWeight: 400 }}>(sistema)</span>}
                  </span>
                  {!role.isSystem && isOwner && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {editingRoleId === role.id ? (
                        <button type="button" className="btn primary" disabled={saving} onClick={handleSaveEdit}>
                          Guardar
                        </button>
                      ) : (
                        <button type="button" className="btn" onClick={() => startEditing(role.id, role.permissionIds)}>
                          Editar
                        </button>
                      )}
                      <button type="button" className="btn" onClick={() => handleDelete(role.id, role.name)}>
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
                {editingRoleId === role.id ? (
                  <div style={{ marginTop: 10 }}>
                    {permissionCheckboxes(editingPermissions, (id) => toggle(editingPermissions, setEditingPermissions, id))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    {role.permissionIds.length} permiso{role.permissionIds.length === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            ))}
          </div>

          {isOwner ? (
            <form onSubmit={handleCreate}>
              <div className="field">
                <label htmlFor="role-name">Nuevo rol personalizado</label>
                <input
                  id="role-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Revisor de QA"
                  required
                />
              </div>
              <div style={{ marginTop: 12 }}>{permissionCheckboxes(newRolePermissions, (id) => toggle(newRolePermissions, setNewRolePermissions, id))}</div>

              {feedback && (
                <p style={{ color: feedback.ok ? "var(--accent)" : "var(--high)", fontSize: 13.5, marginTop: 8 }}>{feedback.message}</p>
              )}

              <div className="modal-foot" style={{ padding: "16px 0 0", borderTop: "none" }}>
                <span />
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Creando…" : "+ Crear rol"}
                </button>
              </div>
            </form>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Solo el propietario puede crear, editar o eliminar roles.</p>
          )}
        </div>
      </div>
  );

  if (embedded) return panel;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      {panel}
    </div>
  );
}
