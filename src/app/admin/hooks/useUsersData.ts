"use client";

import { useState, useCallback } from "react";

export interface GetUserResponse {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user" | "viewer";
  status: "active" | "inactive";
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
  assignedClientIds: string[];
}

export interface CreateUserRequest {
  email: string;
  name: string;
  role: "admin" | "user" | "viewer";
  clientIds?: string[];
}

export interface UpdateUserRequest {
  name?: string;
  role?: "admin" | "user" | "viewer";
  status?: "active" | "inactive";
  clientIds?: string[];
}

interface UseUsersDataReturn {
  users: GetUserResponse[];
  isLoading: boolean;
  error: string | null;

  fetchUsers: () => Promise<void>;
  createUser: (data: CreateUserRequest) => Promise<{ password: string }>;
  updateUser: (id: string, data: UpdateUserRequest) => Promise<GetUserResponse>;
  deleteUser: (id: string) => Promise<void>;
  assignClients: (id: string, clientIds: string[]) => Promise<GetUserResponse>;
}

const MAX_RETRIES = 3;

async function makeRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }

      return data as T;
    } catch (error) {
      lastError = error as Error;
      if (i < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}

export function useUsersData(): UseUsersDataReturn {
  const [users, setUsers] = useState<GetUserResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await makeRequest<{ users?: GetUserResponse[] }>(
        "/api/admin/users"
      );
      setUsers(data.users || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch users";
      setError(message);
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createUser = useCallback(
    async (data: CreateUserRequest): Promise<{ password: string }> => {
      const response = await makeRequest<GetUserResponse & { password?: string }>(
        "/api/admin/users",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: data.email,
            name: data.name,
            role: data.role,
            clientIds: data.clientIds,
          }),
        }
      );

      await fetchUsers();
      return { password: response.password || "" };
    },
    [fetchUsers]
  );

  const updateUser = useCallback(
    async (id: string, updateData: UpdateUserRequest): Promise<GetUserResponse> => {
      const response = await makeRequest<GetUserResponse>(
        `/api/admin/users/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }
      );

      await fetchUsers();
      return response;
    },
    [fetchUsers]
  );

  const deleteUser = useCallback(
    async (id: string): Promise<void> => {
      await makeRequest<{ id: string }>(`/api/admin/users/${id}`, {
        method: "DELETE",
      });

      await fetchUsers();
    },
    [fetchUsers]
  );

  const assignClients = useCallback(
    async (id: string, clientIds: string[]): Promise<GetUserResponse> => {
      const response = await makeRequest<GetUserResponse>(
        `/api/admin/users/${id}/assign-clients`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientIds }),
        }
      );

      await fetchUsers();
      return response;
    },
    [fetchUsers]
  );

  return {
    users,
    isLoading,
    error,
    fetchUsers,
    createUser,
    updateUser,
    deleteUser,
    assignClients,
  };
}
