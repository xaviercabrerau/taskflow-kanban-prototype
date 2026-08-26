"use client";

import React, { useState } from "react";
import type { GetUserResponse } from "../hooks/useUsersData";
import "../styles/dialogs.css";

interface DeleteUserConfirmProps {
  isOpen: boolean;
  user: GetUserResponse | null;
  onClose: () => void;
  onSuccess: () => void;
  onDeleteUser: (id: string) => Promise<void>;
  isLoading: boolean;
  isLastAdmin?: boolean;
}

export default function DeleteUserConfirm({
  isOpen,
  user,
  onClose,
  onSuccess,
  onDeleteUser,
  isLoading,
  isLastAdmin = false,
}: DeleteUserConfirmProps) {
  const [error, setError] = useState("");

  if (!isOpen || !user) return null;

  const handleDelete = async () => {
    setError("");

    if (isLastAdmin) {
      setError("Cannot delete the last admin user");
      return;
    }

    try {
      await onDeleteUser(user.id);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-danger" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Delete User</h2>
          <button
            className="dialog-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <div className="dialog-content">
          {isLastAdmin ? (
            <>
              <p className="warning-text">⚠️ Cannot Delete Last Admin</p>
              <p>
                This is the last admin user in your organization. You must assign
                admin privileges to another user before deleting this account.
              </p>
            </>
          ) : (
            <>
              <p>
                Are you sure you want to delete <strong>{user.email}</strong>?
              </p>
              <div className="warning-box">
                <p className="warning-title">This action will:</p>
                <ul>
                  <li>Remove the user account</li>
                  <li>Clear all assigned clients</li>
                  <li>Delete all audit logs for this user</li>
                </ul>
                <p className="warning-note">
                  ⚠️ This action cannot be undone.
                </p>
              </div>
            </>
          )}

          {error && <p className="error-text">⚠️ {error}</p>}
        </div>

        <div className="dialog-footer">
          <button
            onClick={onClose}
            className="btn"
            disabled={isLoading}
          >
            Cancel
          </button>
          {!isLastAdmin && (
            <button
              onClick={handleDelete}
              className="btn danger"
              disabled={isLoading || isLastAdmin}
            >
              {isLoading ? "Deleting..." : "Delete User"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
