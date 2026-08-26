import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Complementa create-user: cuando ese endpoint falla porque el email YA
// tiene una cuenta en Supabase Auth (típicamente un signup abandonado que
// nunca se sumó a ninguna organización), esta ruta vincula esa cuenta
// existente a la organización del owner que llama, en vez de forzarlo a
// usar un email distinto. auth.admin no expone "buscar por email"
// directamente, así que se pagina listUsers y se filtra en memoria — el
// volumen de usuarios de auth es bajo en esta etapa del producto.
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

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = body.fullName?.trim();
  if (body.orgRole !== undefined && body.orgRole !== "admin" && body.orgRole !== "member") {
    return Response.json({ error: "orgRole inválido: debe ser 'admin' o 'member'." }, { status: 400 });
  }
  const orgRole = body.orgRole === "admin" ? "admin" : "member";
  const roleId = body.roleId?.trim();
  const requirePasswordChange = body.requirePasswordChange ?? true;

  if (!email) {
    return Response.json({ error: "Email es requerido." }, { status: 400 });
  }
  if (password && password.length < 8) {
    return Response.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const { data: callerMembership, error: callerError } = await supabase
    .from("organization_members")
    .select("organization_id, org_role")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (callerError) {
    return Response.json({ error: callerError.message }, { status: 500 });
  }
  if (!callerMembership || callerMembership.org_role !== "owner") {
    return Response.json({ error: "Solo el propietario de la organización puede vincular usuarios." }, { status: 403 });
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

  let existingUser: { id: string; user_metadata: Record<string, unknown> } | null = null;
  for (let page = 1; page <= 20 && !existingUser; page += 1) {
    const { data: pageData, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) {
      return Response.json({ error: listError.message }, { status: 500 });
    }
    existingUser = pageData.users.find((u) => u.email?.toLowerCase() === email) ?? null;
    if (pageData.users.length < 200) break;
  }
  if (!existingUser) {
    return Response.json({ error: "No existe ninguna cuenta con ese email." }, { status: 404 });
  }

  const { data: targetMembership, error: targetError } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", existingUser.id)
    .maybeSingle();
  if (targetError) {
    return Response.json({ error: targetError.message }, { status: 500 });
  }
  if (targetMembership) {
    const message =
      targetMembership.organization_id === callerMembership.organization_id
        ? "Ese usuario ya es miembro de tu organización."
        : "Esa cuenta ya pertenece a otra organización.";
    return Response.json({ error: message }, { status: 409 });
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(existingUser.id, {
    email_confirm: true,
    ...(password ? { password } : {}),
    user_metadata: {
      ...existingUser.user_metadata,
      ...(fullName ? { full_name: fullName } : {}),
      must_change_password: password ? requirePasswordChange : existingUser.user_metadata?.must_change_password ?? false,
    },
  });
  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 400 });
  }

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: callerMembership.organization_id, user_id: existingUser.id, org_role: orgRole });
  if (memberError) {
    return Response.json({ error: `No se pudo añadir a la organización: ${memberError.message}` }, { status: 500 });
  }

  const warnings: string[] = [];

  if (fullName) {
    const { error: profileError } = await admin.from("profiles").update({ full_name: fullName }).eq("id", existingUser.id);
    if (profileError) {
      console.error("link-existing-user: failed to update profile full_name", profileError);
      warnings.push("Usuario vinculado pero no se pudo actualizar el nombre completo.");
    }
  }

  // Mismo patrón que create-user: una fila de role_assignments por board
  // del tenant (RBAC está scoped a nivel board).
  if (roleId) {
    const { data: validRole, error: roleCheckError } = await supabase
      .from("roles")
      .select("id")
      .eq("id", roleId)
      .or(`tenant_id.eq.${callerMembership.organization_id},tenant_id.is.null`)
      .maybeSingle();
    if (roleCheckError) {
      return Response.json({ error: roleCheckError.message }, { status: 500 });
    }
    if (!validRole) {
      return Response.json({ error: "El rol especificado no pertenece a esta organización." }, { status: 400 });
    }

    const { data: boards } = await admin.from("boards").select("id").eq("tenant_id", callerMembership.organization_id);
    if (boards?.length) {
      const { error: roleAssignError } = await admin.from("role_assignments").insert(
        boards.map((b) => ({
          tenant_id: callerMembership.organization_id,
          user_id: existingUser.id,
          role_id: roleId,
          scope_type: "board",
          scope_id: b.id,
          granted_by: authData.user.id,
        }))
      );
      if (roleAssignError) {
        console.error("link-existing-user: failed to insert role_assignments", roleAssignError);
        warnings.push("Usuario vinculado pero no se pudo asignar el rol. Asígnalo manualmente desde Roles y permisos.");
      }
    }
  }

  return Response.json({ ok: true, userId: existingUser.id, ...(warnings.length ? { warning: warnings.join(" ") } : {}) });
}
