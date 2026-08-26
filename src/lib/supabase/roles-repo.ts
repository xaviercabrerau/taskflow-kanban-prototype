import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface Permission {
  id: string;
  key: string;
  category: string;
  description: string | null;
}

export interface OrgRole {
  id: string;
  name: string;
  isSystem: boolean;
  tenantId: string | null;
  permissionIds: string[];
}

export async function fetchPermissionsCatalog(supabase: TypedClient): Promise<Permission[]> {
  const { data, error } = await supabase.from("permissions").select("id, key, category, description").order("category").order("key");
  if (error) throw error;
  return data ?? [];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchRoles(supabase: TypedClient, tenantId: string): Promise<OrgRole[]> {
  if (!UUID_RE.test(tenantId)) throw new Error("tenantId inválido.");
  const { data, error } = await supabase
    .from("roles")
    .select("id, name, is_system, tenant_id, role_permissions(permission_id)")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .order("is_system", { ascending: false })
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    isSystem: row.is_system,
    tenantId: row.tenant_id,
    permissionIds: row.role_permissions.map((rp) => rp.permission_id),
  }));
}

export async function createCustomRole(
  supabase: TypedClient,
  tenantId: string,
  name: string,
  permissionIds: string[]
): Promise<OrgRole> {
  const { data: role, error: roleError } = await supabase
    .from("roles")
    .insert({ name, tenant_id: tenantId, is_system: false })
    .select("id, name, is_system, tenant_id")
    .single();
  if (roleError) throw roleError;

  if (permissionIds.length > 0) {
    const { error: permError } = await supabase
      .from("role_permissions")
      .insert(permissionIds.map((permission_id) => ({ role_id: role.id, permission_id })));
    if (permError) throw permError;
  }

  return { id: role.id, name: role.name, isSystem: role.is_system, tenantId: role.tenant_id, permissionIds };
}

export async function updateRolePermissions(supabase: TypedClient, roleId: string, permissionIds: string[]): Promise<void> {
  const { error: deleteError } = await supabase.from("role_permissions").delete().eq("role_id", roleId);
  if (deleteError) throw deleteError;
  if (permissionIds.length > 0) {
    const { error: insertError } = await supabase
      .from("role_permissions")
      .insert(permissionIds.map((permission_id) => ({ role_id: roleId, permission_id })));
    if (insertError) throw insertError;
  }
}

export async function deleteCustomRole(supabase: TypedClient, roleId: string): Promise<void> {
  const { error } = await supabase.from("roles").delete().eq("id", roleId);
  if (error) throw error;
}

export async function fetchMemberRoleIds(supabase: TypedClient, tenantId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("role_assignments")
    .select("user_id, role_id")
    .eq("tenant_id", tenantId)
    .eq("scope_type", "board");
  if (error) throw error;
  const byUser: Record<string, string> = {};
  for (const row of data ?? []) byUser[row.user_id] = row.role_id;
  return byUser;
}

export async function assignRoleToMember(
  supabase: TypedClient,
  tenantId: string,
  userId: string,
  roleId: string
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("role_assignments")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("scope_type", "board");
  if (deleteError) throw deleteError;

  const { data: boards, error: boardsError } = await supabase.from("boards").select("id").eq("tenant_id", tenantId);
  if (boardsError) throw boardsError;
  if (!boards?.length) return;

  const { error: insertError } = await supabase.from("role_assignments").insert(
    boards.map((b) => ({
      tenant_id: tenantId,
      user_id: userId,
      role_id: roleId,
      scope_type: "board",
      scope_id: b.id,
    }))
  );
  if (insertError) throw insertError;
}
