import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface OrgMember {
  membershipId: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  orgRole: string;
  roleWarning?: string | null;
}

// Cualquier miembro de la organización puede ver la lista completa (RPC
// list_org_members, ver migración m16) — la política RLS de
// organization_members sigue restringida a la propia fila por la recursión
// 42P17 documentada, así que este RPC es el único camino soportado para
// listar compañeros de equipo.
export async function fetchMembers(supabase: TypedClient, tenantId: string): Promise<OrgMember[]> {
  const { data, error } = await supabase.rpc("list_org_members", { org_id: tenantId });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    membershipId: row.membership_id,
    userId: row.member_user_id,
    orgRole: row.org_role,
    email: row.email,
    fullName: row.full_name,
  }));
}

// Invita a un usuario que YA tiene cuenta en TaskFlow (busca por email vía
// search_profile_by_email, ya que profiles_select está restringida a
// miembros de una org compartida y este usuario aún no lo es). No crea
// cuentas nuevas ni envía correos — ver la limitación documentada en el
// turno donde se agregó esta función.
export async function inviteMemberByEmail(
  supabase: TypedClient,
  tenantId: string,
  email: string
): Promise<OrgMember> {
  const normalized = email.trim().toLowerCase();
  const { data: profileRows, error: profileError } = await supabase.rpc("search_profile_by_email", {
    p_email: normalized,
  });
  if (profileError) throw profileError;
  const profile = profileRows?.[0];
  if (!profile) {
    throw new Error(`No hay ninguna cuenta registrada con el email "${email}". Pídele que se registre en /login primero.`);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("organization_members")
    .insert({ organization_id: tenantId, user_id: profile.id, org_role: "member" })
    .select("id, user_id, org_role")
    .single();
  if (insertError) {
    if (insertError.code === "23505") throw new Error("Ese usuario ya es miembro de la organización.");
    throw insertError;
  }

  // Otorga el rol granular "Contribuyente" (task.create/task.update) en cada
  // board de la organización — sin esto, el nuevo miembro entraría en modo
  // solo-lectura por las políticas RLS de la Sección 1.4.
  const { data: role } = await supabase.from("roles").select("id").eq("name", "Contribuyente").eq("is_system", true).single();
  const { data: boards, error: boardsError } = await supabase.from("boards").select("id").eq("tenant_id", tenantId);
  if (boardsError) console.error("No se pudieron listar los boards para asignar el rol al nuevo miembro:", boardsError);
  let roleWarning: string | null = null;
  if (role && boards?.length) {
    const { error: roleAssignError } = await supabase.from("role_assignments").insert(
      boards.map((b) => ({
        tenant_id: tenantId,
        user_id: profile.id,
        role_id: role.id,
        scope_type: "board",
        scope_id: b.id,
      }))
    );
    if (roleAssignError) {
      console.error("No se pudo asignar el rol Contribuyente al nuevo miembro:", roleAssignError);
      roleWarning = "El usuario se agregó a la organización, pero no se pudo asignar su rol. Asígnalo manualmente desde Roles y permisos.";
    }
  } else if (!role) {
    roleWarning = "El usuario se agregó a la organización, pero no se pudo asignar su rol. Asígnalo manualmente desde Roles y permisos.";
  }

  return {
    membershipId: inserted.id,
    userId: inserted.user_id,
    orgRole: inserted.org_role,
    email: profile.email,
    fullName: profile.full_name,
    roleWarning,
  };
}
