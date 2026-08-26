import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Crea una cuenta nueva directamente (email+contraseña, ya confirmada) y la
// suma a la organización del owner que llama. Existe porque "Invitar por
// email" (InviteModal) SOLO funciona si la persona ya tiene cuenta propia en
// TaskFlow — no hay forma de que un admin cree la cuenta desde cero. Requiere
// SUPABASE_SERVICE_ROLE_KEY (nunca expuesto al cliente) para poder usar
// auth.admin.createUser, que no está disponible con la anon key.
export async function POST(request: Request) {
  let body: {
    email?: string;
    password?: string;
    fullName?: string;
    orgRole?: string;
    roleId?: string;
    requirePasswordChange?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Cuerpo de la petición inválido." }, { status: 400 });
  }

  const email = body.email?.trim();
  const password = body.password ?? "";
  const fullName = body.fullName?.trim();
  if (body.orgRole !== undefined && body.orgRole !== "admin" && body.orgRole !== "member") {
    return Response.json({ error: "orgRole inválido: debe ser 'admin' o 'member'." }, { status: 400 });
  }
  const orgRole = body.orgRole === "admin" ? "admin" : "member";
  const roleId = body.roleId?.trim();
  const requirePasswordChange = body.requirePasswordChange ?? true;

  if (!email || !password) {
    return Response.json({ error: "Email y contraseña son requeridos." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, org_role")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (membershipError) {
    return Response.json({ error: membershipError.message }, { status: 500 });
  }
  if (!membership || membership.org_role !== "owner") {
    return Response.json({ error: "Solo el propietario de la organización puede crear usuarios." }, { status: 403 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    return Response.json(
      { error: "El servidor no tiene configurado SUPABASE_SERVICE_ROLE_KEY. Agrégalo en las variables de entorno." },
      { status: 500 }
    );
  }
  const admin = createServiceClient<Database>(supabaseUrl, serviceRoleKey);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      ...(fullName ? { full_name: fullName } : {}),
      must_change_password: requirePasswordChange,
    },
  });
  if (createError || !created.user) {
    return Response.json({ error: createError?.message ?? "No se pudo crear el usuario." }, { status: 400 });
  }

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: membership.organization_id, user_id: created.user.id, org_role: orgRole });
  if (memberError) {
    return Response.json({ error: `Usuario creado, pero no se pudo añadir a la organización: ${memberError.message}` }, { status: 500 });
  }

  const warnings: string[] = [];

  if (fullName) {
    const { error: profileError } = await admin.from("profiles").update({ full_name: fullName }).eq("id", created.user.id);
    if (profileError) {
      console.error("create-user: failed to update profile full_name", profileError);
      warnings.push("Usuario creado pero no se pudo actualizar el nombre completo.");
    }
  }

  // Mismo patrón que assignRoleToMember en roles-repo.ts: una fila de
  // role_assignments por board del tenant (RBAC está scoped a nivel board).
  if (roleId) {
    const { data: validRole, error: roleCheckError } = await supabase
      .from("roles")
      .select("id")
      .eq("id", roleId)
      .or(`tenant_id.eq.${membership.organization_id},tenant_id.is.null`)
      .maybeSingle();
    if (roleCheckError) {
      return Response.json({ error: roleCheckError.message }, { status: 500 });
    }
    if (!validRole) {
      return Response.json({ error: "El rol especificado no pertenece a esta organización." }, { status: 400 });
    }

    const { data: boards } = await admin.from("boards").select("id").eq("tenant_id", membership.organization_id);
    if (boards?.length) {
      const { error: roleAssignError } = await admin.from("role_assignments").insert(
        boards.map((b) => ({
          tenant_id: membership.organization_id,
          user_id: created.user.id,
          role_id: roleId,
          scope_type: "board",
          scope_id: b.id,
          granted_by: authData.user.id,
        }))
      );
      if (roleAssignError) {
        console.error("create-user: failed to insert role_assignments", roleAssignError);
        warnings.push("Usuario creado pero no se pudo asignar el rol. Asígnalo manualmente desde Roles y permisos.");
      }
    }
  }

  return Response.json({ ok: true, userId: created.user.id, ...(warnings.length ? { warning: warnings.join(" ") } : {}) });
}
