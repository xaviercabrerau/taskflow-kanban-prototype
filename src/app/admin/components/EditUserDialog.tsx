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

  if (!isOpen || !user) return null;

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
