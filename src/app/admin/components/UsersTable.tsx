"use client";

import React, { useMemo, useState } from "react";
import type { GetUserResponse } from "../hooks/useUsersData";
import "../styles/users-table.css";

interface UsersTableProps {
  users: GetUserResponse[];
  isLoading: boolean;
  onEdit: (user: GetUserResponse) => void;
  onDelete: (user: GetUserResponse) => void;
  onRefresh: () => Promise<void>;
}

const ITEMS_PER_PAGE = 10;

export default function UsersTable({
  users,
  isLoading,
  onEdit,
  onDelete,
  onRefresh,
}: UsersTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredUsers = useMemo(() => {
    return users.filter(
      (user) =>
        user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [users, searchQuery]);

  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedUsers = filteredUsers.slice(
    startIndex,
    startIndex + ITEMS_PER_PAGE
  );

  const getRoleStyle = (role: string) => {
    switch (role) {
      case "admin":
        return { background: "#fee2e2", color: "#991b1b" };
      case "user":
        return { background: "#dbeafe", color: "#1e40af" };
      case "viewer":
        return { background: "#ede9fe", color: "#5b21b6" };
      default:
        return {};
    }
  };

  const getStatusStyle = (status: string) => {
    if (status === "active") {
      return { color: "#16a34a" };
    }
    return { color: "#9ca3af" };
  };

  const formatDate = (date: string | null) => {
    if (!date) return "Never";
    try {
      return new Date(date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  };

  const truncateId = (id: string) => {
    return id.substring(0, 8) + "...";
  };

  if (isLoading && users.length === 0) {
    return (
      <div className="users-table-container">
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading users...</p>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="users-table-container">
        <div className="empty-state">
          <p>No users found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="users-table-container">
      <div className="users-table-toolbar">
        <input
          type="text"
          placeholder="Search by email or name..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentPage(1);
          }}
          className="users-search-input"
          aria-label="Search users"
        />
        <button
          onClick={onRefresh}
          className="btn-refresh"
          aria-label="Refresh users list"
          disabled={isLoading}
        >
          🔄
        </button>
      </div>

      {paginatedUsers.length === 0 ? (
        <div className="empty-state">
          <p>No users match your search</p>
        </div>
      ) : (
        <>
          <div className="users-table-wrapper">
            <table className="users-table" role="grid">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Email</th>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last Login</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((user) => (
                  <tr key={user.id}>
                    <td title={user.id}>{truncateId(user.id)}</td>
                    <td>{user.email}</td>
                    <td>{user.name}</td>
                    <td>
                      <span
                        className="badge"
                        style={getRoleStyle(user.role)}
                        role="status"
                      >
                        {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </span>
                    </td>
                    <td>
                      <span
                        className="status-indicator"
                        style={getStatusStyle(user.status)}
                      >
                        ● {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
                      </span>
                    </td>
                    <td>{formatDate(user.lastLogin)}</td>
                    <td>
                      <div className="actions">
                        <button
                          onClick={() => onEdit(user)}
                          className="btn-action edit"
                          aria-label={`Edit ${user.email}`}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => onDelete(user)}
                          className="btn-action delete"
                          aria-label={`Delete ${user.email}`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                ← Previous
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
