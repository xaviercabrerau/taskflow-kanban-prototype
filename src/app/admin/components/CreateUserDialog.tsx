"use client";

import React, { useState } from "react";
import type { CreateUserRequest } from "../hooks/useUsersData";
import "../styles/dialogs.css";

interface CreateUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onCreateUser: (data: CreateUserRequest) => Promise<{ password: string }>;
  isLoading: boolean;
}

type Step = "info" | "review" | "success";

export default function CreateUserDialog({
  isOpen,
  onClose,
  onSuccess,
  onCreateUser,
  isLoading,
}: CreateUserDialogProps) {
  const [step, setStep] = useState<Step>("info");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "user" | "viewer">("user");
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [tempPassword, setTempPassword] = useState("");
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleBack = () => {
    if (step === "review") setStep("info");
    if (step === "success") {
      resetForm();
      onClose();
      onSuccess();
    }
  };

  const handleNext = async () => {
    setError("");

    if (step === "info") {
      // Validate Step 1
      if (!email.trim()) {
        setError("Email is required");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError("Please enter a valid email address");
        return;
      }
      if (!name.trim() || name.trim().length < 2) {
        setError("Name is required and must be at least 2 characters");
        return;
      }
      setStep("review");
    } else if (step === "review") {
      // Create user
      try {
        const result = await onCreateUser({
          email: email.trim(),
          name: name.trim(),
          role,
          clientIds,
        });
        setTempPassword(result.password);
        setStep("success");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create user");
      }
    }
  };

  const resetForm = () => {
    setStep("info");
    setEmail("");
    setName("");
    setRole("user");
    setClientIds([]);
    setTempPassword("");
    setError("");
  };

  const handleCopyPassword = () => {
    navigator.clipboard.writeText(tempPassword);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Create User</h2>
          <button
            className="dialog-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Step Indicator */}
        <div className="step-indicator">
          <div className={`step ${step === "info" ? "active" : step !== "success" ? "done" : "done"}`}>
            1
          </div>
          <div className="step-line" />
          <div
            className={`step ${step === "review" ? "active" : step === "success" ? "done" : ""}`}
          >
            2
          </div>
          <div className="step-line" />
          <div className={`step ${step === "success" ? "active" : ""}`}>
            3
          </div>
        </div>

        <div className="dialog-content">
          {step === "info" && (
            <form onSubmit={(e) => e.preventDefault()}>
              <div className="form-group">
                <label htmlFor="create-email">Email *</label>
                <input
                  id="create-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  disabled={isLoading}
                  aria-describedby={error ? "email-error" : undefined}
                />
                {error && <p className="error-text">⚠️ {error}</p>}
              </div>

              <div className="form-group">
                <label htmlFor="create-name">Name *</label>
                <input
                  id="create-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  disabled={isLoading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="create-role">Role</label>
                <select
                  id="create-role"
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
            </form>
          )}

          {step === "review" && (
            <div className="review-section">
              <h3>Review Information</h3>
              <div className="review-item">
                <span className="label">Email:</span>
                <span className="value">{email}</span>
              </div>
              <div className="review-item">
                <span className="label">Name:</span>
                <span className="value">{name}</span>
              </div>
              <div className="review-item">
                <span className="label">Role:</span>
                <span className="value">
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </span>
              </div>
              <p className="review-note">
                Click &quot;Create&quot; to send the temporary password to this user.
              </p>
            </div>
          )}

          {step === "success" && (
            <div className="success-section">
              <div className="success-icon">✓</div>
              <h3>User Created Successfully!</h3>
              <p>Share this temporary password with the user:</p>
              <div className="password-display">
                <code>{tempPassword}</code>
                <button
                  onClick={handleCopyPassword}
                  className="btn-copy"
                  title="Copy to clipboard"
                >
                  📋 Copy
                </button>
              </div>
              <p className="password-note">
                The user will be prompted to change this password on first login.
              </p>
            </div>
          )}

          {error && step !== "info" && (
            <p className="error-text">⚠️ {error}</p>
          )}
        </div>

        <div className="dialog-footer">
          {step !== "success" && (
            <button
              onClick={handleBack}
              className="btn secondary"
              disabled={isLoading || step === "info"}
            >
              ← Back
            </button>
          )}
          <button
            onClick={handleBack}
            className="btn"
            disabled={isLoading}
            style={{ visibility: step !== "success" ? "hidden" : "visible" }}
          >
            Done
          </button>
          {step !== "success" && (
            <button
              onClick={handleNext}
              className="btn primary"
              disabled={isLoading}
            >
              {isLoading ? "Creating..." : step === "review" ? "Create" : "Next →"}
            </button>
          )}
          {step === "success" && (
            <button
              onClick={handleBack}
              className="btn primary"
              disabled={isLoading}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
