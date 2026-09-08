"use client";

import React, { useState } from "react";
import type { GetUserResponse, UpdateUserRequest } from "../hooks/useUsersData";
import "../styles/dialogs.css";

interface EditUserDialogProps {
  isOpen: boolean;
  user: GetUserResponse | null;
  onClose: () => void;
  onSuccess: () => void;
  onUpdateUser: (id: string, data: UpdateUserRequest) => Promise<GetUserResponse>;
  isLoading: boolean;
}

export default function EditUserDialog({
  isOpen,
  user,
  onClose,
  onSuccess,
  onUpdateUser,
  isLoading,
}: EditUserDialogProps) {
  // This component is remounted (via `key={user?.id}` on the parent's
  // usage in UsersTab.tsx) whenever the target user changes, so these
  // initial values are recomputed fresh instead of being synced in an effect.
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<"admin" | "user" | "viewer">(
    user?.role ?? "user"
  );
  const [status, setStatus] = useState<"active" | "inactive">(
    user?.status ?? "active"
  );
  const [error, setError] = useState("");

  // Restablecer contraseña reutiliza /api/admin/reset-password (ya
  // existente, usado hoy solo desde InviteModal) — genera una contraseña
  // temporal en el cliente, la aplica vía el endpoint, y la muestra para
  // compartirla. Acción independiente del form de nombre/rol/estado de
  // abajo, por eso no pasa por onUpdateUser.
  const [resetting, setResetting] = useState(false);
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen || !user) return null;

  async function handleResetPassword() {
    if (!user) return;
    setResetting(true);
    setResetError(null);
    setResetPassword(null);
    try {
      const tempPassword =
        Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 5).toUpperCase();
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, password: tempPassword, requirePasswordChange: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error ?? "No se pudo restablecer la contraseña.");
        return;
      }
      setResetPassword(tempPassword);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "No se pudo restablecer la contraseña.");
    } finally {
      setResetting(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || name.trim().length < 2) {
      setError("Name is required and must be at least 2 characters");
      return;
    }

    try {
      await onUpdateUser(user.id, {
        name: name.trim(),
        role,
        status,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Edit User</h2>
          <button
            className="dialog-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="dialog-content">
            <div className="form-group">
              <label htmlFor="edit-email">Email (read-only)</label>
              <input
                id="edit-email"
                type="email"
                value={user.email}
                disabled
                title="Email cannot be changed"
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-name">Name *</label>
              <input
                id="edit-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                disabled={isLoading}
                aria-describedby={error ? "name-error" : undefined}
              />
              {error && <p className="error-text" id="name-error">⚠️ {error}</p>}
            </div>

            <div className="form-group">
              <label htmlFor="edit-role">Role</label>
              <select
                id="edit-role"
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "admin" | "user" | "viewer")
                }
                disabled={isLoading}
              >
                <option value="viewer">Viewer</option>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="form-group">
              <label>Status</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    value="active"
                    checked={status === "active"}
                    onChange={(e) =>
                      setStatus(e.target.value as "active" | "inactive")
                    }
                    disabled={isLoading}
                  />
                  Active
                </label>
                <label>
                  <input
                    type="radio"
                    value="inactive"
                    checked={status === "inactive"}
                    onChange={(e) =>
                      setStatus(e.target.value as "active" | "inactive")
                    }
                    disabled={isLoading}
                  />
                  Inactive
                </label>
              </div>
            </div>

            <div className="form-group" style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 4 }}>
              <label>Password</label>
              <button
                type="button"
                className="btn"
                onClick={handleResetPassword}
                disabled={isLoading || resetting}
              >
                {resetting ? "Restableciendo…" : "Restablecer contraseña"}
              </button>
              {resetError && <p className="error-text">⚠️ {resetError}</p>}
              {resetPassword && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>
                    Comparte esta contraseña temporal con {user.name || user.email}. Se le pedirá cambiarla en su
                    próximo inicio de sesión.
                  </p>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <code
                      style={{
                        flex: 1,
                        background: "var(--surface-2)",
                        padding: "6px 10px",
                        borderRadius: 6,
                        fontSize: 13,
                        userSelect: "all",
                      }}
                    >
                      {resetPassword}
                    </code>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        navigator.clipboard.writeText(resetPassword);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? "Copiado ✓" : "Copiar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="dialog-footer">
            <button
              type="button"
              onClick={onClose}
              className="btn"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={isLoading}
            >
              {isLoading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
