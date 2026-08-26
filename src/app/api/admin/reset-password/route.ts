import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Restablece la contraseña de un miembro YA EXISTENTE de la organización del
// owner que llama (temporal o definitiva). Complementa create-user: esa ruta
// solo cubre altas nuevas, esta cubre "se me olvidó mi contraseña" o
// "necesito rotarla" para alguien que ya tiene cuenta.
export async function POST(request: Request) {
  let body: { userId?: string; password?: string; requirePasswordChange?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Cuerpo de la petición inválido." }, { status: 400 });
  }

  const targetUserId = body.userId?.trim();
  const password = body.password ?? "";
  const requirePasswordChange = body.requirePasswordChange ?? true;

  if (!targetUserId || !password) {
    return Response.json({ error: "userId y contraseña son requeridos." }, { status: 400 });
  }
  if (password.length < 8) {
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
    return Response.json({ error: "Solo el propietario de la organización puede restablecer contraseñas." }, { status: 403 });
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

  // Crítico: confirmar que el usuario objetivo pertenece a LA MISMA
  // organización del caller — sin esto, cualquier owner de cualquier
  // organización podría restablecer la contraseña de cualquier usuario del
  // sistema completo, no solo de los suyos.
  const { data: targetMembership, error: targetError } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (targetError) {
    return Response.json({ error: targetError.message }, { status: 500 });
  }
  if (!targetMembership || targetMembership.organization_id !== callerMembership.organization_id) {
    return Response.json({ error: "Ese usuario no pertenece a tu organización." }, { status: 403 });
  }

  const { data: existing, error: getError } = await admin.auth.admin.getUserById(targetUserId);
  if (getError || !existing.user) {
    return Response.json({ error: getError?.message ?? "Usuario no encontrado." }, { status: 404 });
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, {
    password,
    user_metadata: {
      ...existing.user.user_metadata,
      must_change_password: requirePasswordChange,
    },
  });
  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 400 });
  }

  return Response.json({ ok: true });
}
