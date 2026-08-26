import { createClient as createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: userId } = await params;
  const supabase = await createServerSupabase();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: userMembership, error: userError } = await supabase
    .from("organization_members")
    .select("org_role, joined_at")
    .eq("user_id", userId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (userError || !userMembership) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", userId)
    .maybeSingle();

  return Response.json({
    id: userId,
    email: profile?.email || "",
    name: profile?.full_name || "Unknown",
    role: userMembership.org_role === "owner" ? "admin" : "user",
    status: "active",
    lastLogin: null,
    createdAt: userMembership.joined_at,
    updatedAt: userMembership.joined_at,
    assignedClientIds: [],
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: userId } = await params;
  let body: {
    name?: string;
    role?: string;
    status?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
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

  if (membershipError || !membership || membership.org_role !== "owner") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.name) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: body.name })
      .eq("id", userId);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 400 });
    }
  }

  if (body.role) {
    const newOrgRole = body.role === "admin" ? "admin" : "member";
    const { error: roleError } = await supabase
      .from("organization_members")
      .update({ org_role: newOrgRole })
      .eq("user_id", userId)
      .eq("organization_id", membership.organization_id);

    if (roleError) {
      return Response.json({ error: roleError.message }, { status: 400 });
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", userId)
    .maybeSingle();

  const { data: updated } = await supabase
    .from("organization_members")
    .select("org_role, joined_at")
    .eq("user_id", userId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  return Response.json({
    id: userId,
    email: profile?.email || "",
    name: profile?.full_name || "Unknown",
    role: updated?.org_role === "owner" ? "admin" : "user",
    status: "active",
    lastLogin: null,
    createdAt: updated?.joined_at,
    updatedAt: new Date().toISOString(),
    assignedClientIds: [],
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: userId } = await params;
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

  if (membershipError || !membership || membership.org_role !== "owner") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check if user is the last admin
  const { data: admins } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .in("org_role", ["admin", "owner"]);

  if (admins && admins.length === 1 && admins[0].user_id === userId) {
    return Response.json(
      { error: "Cannot delete the last admin user" },
      { status: 409 }
    );
  }

  const { error: deleteError } = await supabase
    .from("organization_members")
    .delete()
    .eq("user_id", userId)
    .eq("organization_id", membership.organization_id);

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 400 });
  }

  return Response.json({ id: userId });
}
