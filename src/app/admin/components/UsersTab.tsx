"use client";

import React, { useEffect, useState } from "react";
import { useUsersData } from "../hooks/useUsersData";
import type {
  GetUserResponse,
  CreateUserRequest,
  UpdateUserRequest,
} from "../hooks/useUsersData";
import UsersTable from "./UsersTable";
import CreateUserDialog from "./CreateUserDialog";
import EditUserDialog from "./EditUserDialog";
import DeleteUserConfirm from "./DeleteUserConfirm";
import "../styles/users-tab.css";

export default function UsersTab() {
  const {
    users,
    isLoading,
    error,
    fetchUsers,
    createUser,
    updateUser,
    deleteUser,
  } = useUsersData();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<GetUserResponse | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreateUser = async (data: CreateUserRequest) => {
    setIsOperating(true);
    setGlobalError(null);
    try {
      const result = await createUser(data);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create user";
      setGlobalError(message);
      throw err;
    } finally {
      setIsOperating(false);
    }
  };

  const handleEditUser = (user: GetUserResponse) => {
    setSelectedUser(user);
    setIsEditDialogOpen(true);
  };

  const handleDeleteUser = (user: GetUserResponse) => {
    setSelectedUser(user);
    setIsDeleteDialogOpen(true);
  };

  const handleUpdateUser = async (id: string, data: UpdateUserRequest) => {
    setIsOperating(true);
    setGlobalError(null);
    try {
      const result = await updateUser(id, data);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update user";
      setGlobalError(message);
      throw err;
    } finally {
      setIsOperating(false);
    }
  };

  const handleDeleteConfirmed = async (id: string) => {
    setIsOperating(true);
    setGlobalError(null);
    try {
      await deleteUser(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete user";
      setGlobalError(message);
      throw err;
    } finally {
      setIsOperating(false);
    }
  };

  const isLastAdmin = () => {
    const admins = users.filter((u) => u.role === "admin");
    return admins.length === 1 && admins[0].id === selectedUser?.id;
  };

  return (
    <div className="users-tab">
      <div className="users-header">
        <h1>Usuarios</h1>
        <button
          onClick={() => setIsCreateDialogOpen(true)}
          className="btn primary"
          disabled={isLoading || isOperating}
        >
          + Create User
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <p>Error: {error}</p>
          <button onClick={fetchUsers} disabled={isLoading}>
            Try Again
          </button>
        </div>
      )}

      {globalError && (
        <div className="error-banner" role="alert">
          <p>Error: {globalError}</p>
        </div>
      )}

      <UsersTable
        users={users}
        isLoading={isLoading}
        onEdit={handleEditUser}
        onDelete={handleDeleteUser}
        onRefresh={fetchUsers}
      />

      <CreateUserDialog
        isOpen={isCreateDialogOpen}
        onClose={() => {
          setIsCreateDialogOpen(false);
          setGlobalError(null);
        }}
        onSuccess={() => {
          fetchUsers();
        }}
        onCreateUser={handleCreateUser}
        isLoading={isOperating}
      />

      <EditUserDialog
        key={selectedUser?.id}
        isOpen={isEditDialogOpen}
        user={selectedUser}
        onClose={() => {
          setIsEditDialogOpen(false);
          setSelectedUser(null);
          setGlobalError(null);
        }}
        onSuccess={() => {
          fetchUsers();
        }}
        onUpdateUser={handleUpdateUser}
        isLoading={isOperating}
      />

      <DeleteUserConfirm
        isOpen={isDeleteDialogOpen}
        user={selectedUser}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setSelectedUser(null);
          setGlobalError(null);
        }}
        onSuccess={() => {
          fetchUsers();
        }}
        onDeleteUser={handleDeleteConfirmed}
        isLoading={isOperating}
        isLastAdmin={isLastAdmin()}
      />
    </div>
  );
}
