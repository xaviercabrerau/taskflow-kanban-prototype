import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

interface OrganizationMemberRow {
  user_id: string;
  org_role: string;
  joined_at: string;
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
}

export async function GET(request: Request) {
  void request;
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, org_role")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (membershipError) {
    return Response.json({ error: membershipError.message }, { status: 500 });
  }

  if (!membership) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Two separate queries instead of a `profiles:user_id(...)` embed: that
  // embed needs a direct FK from organization_members to profiles for
  // PostgREST to resolve, but organization_members.user_id references
  // auth.users (same as profiles.id does) — there is no such direct FK, so
  // the embed fails with "Could not find a relationship" on every call.
  const { data: members, error: usersError } = await supabase
    .from("organization_members")
    .select("user_id, org_role, joined_at")
    .eq("organization_id", membership.organization_id);

  if (usersError) {
    return Response.json({ error: usersError.message }, { status: 500 });
  }

  const memberRows = (members as OrganizationMemberRow[] | null) ?? [];
  const userIds = memberRows.map((m) => m.user_id);

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]);

  if (profilesError) {
    return Response.json({ error: profilesError.message }, { status: 500 });
  }

  const profileById = new Map((profiles as ProfileRow[] | null ?? []).map((p) => [p.id, p]));

  const formattedUsers = memberRows.map((u) => {
    const profile = profileById.get(u.user_id);
    return {
      id: u.user_id,
      email: profile?.email || "",
      name: profile?.full_name || "Unknown",
      role: u.org_role === "owner" ? "admin" : u.org_role === "admin" ? "admin" : "user",
      status: "active",
      lastLogin: null,
      createdAt: u.joined_at,
      updatedAt: u.joined_at,
      assignedClientIds: [],
    };
  });

  return Response.json({ users: formattedUsers });
}

export async function POST(request: Request) {
  let body: {
    email?: string;
    name?: string;
    role?: string;
    clientIds?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = body.email?.trim();
  const name = body.name?.trim();
  const role = body.role || "user";
  const clientIds = body.clientIds || [];

  if (!email) {
    return Response.json({ error: "Email is required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
    return Response.json({ error: "Only organization owners can create users" }, { status: 403 });
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

  // Genera una contraseña temporal real y crea la cuenta ya confirmada
  // (email_confirm: true) — antes esta ruta solo generaba esta misma
  // contraseña y devolvía un 200 falso sin llamar nunca a Supabase Auth
  // (comentario original: "Simulate creating user"), así que el usuario
  // creado en /admin/usuarios nunca existía de verdad y el login fallaba
  // con "Invalid login credentials". Mismo patrón que
  // /api/admin/create-user/route.ts, que sí funciona correctamente.
  const tempPassword = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 5).toUpperCase();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      ...(name ? { full_name: name } : {}),
      must_change_password: true,
    },
  });
  if (createError || !created.user) {
    return Response.json({ error: createError?.message ?? "No se pudo crear el usuario." }, { status: 400 });
  }

  // clientIds no tiene equivalente en el modelo de datos real de TaskFlow
  // (era parte del scaffolding genérico de este endpoint) — se ignora.
  void clientIds;

  // org_role solo admite 'owner'|'admin'|'member'|'guest' (constraint de
  // organization_members) — mapear los 3 roles que ofrece el diálogo.
  const orgRole = role === "admin" ? "admin" : role === "viewer" ? "guest" : "member";

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: membership.organization_id, user_id: created.user.id, org_role: orgRole });
  if (memberError) {
    return Response.json(
      { error: `Usuario creado, pero no se pudo añadir a la organización: ${memberError.message}` },
      { status: 500 }
    );
  }

  if (name) {
    const { error: profileError } = await admin.from("profiles").update({ full_name: name }).eq("id", created.user.id);
    if (profileError) {
      console.error("POST /api/admin/users: failed to update profile full_name", profileError);
    }
  }

  return Response.json(
    {
      id: created.user.id,
      email,
      name: name || "Unknown",
      role,
      status: "active",
      lastLogin: null,
      createdAt: created.user.created_at,
      updatedAt: created.user.created_at,
      assignedClientIds: [],
      password: tempPassword,
    },
    { status: 200 }
  );
}
