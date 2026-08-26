import { createClient as createServerSupabase } from "@/lib/supabase/server";

interface OrganizationMemberWithProfile {
  user_id: string;
  org_role: string;
  joined_at: string;
  profiles: {
    id: string;
    email: string | null;
    full_name: string | null;
  } | null;
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

  const { data: users, error: usersError } = await supabase
    .from("organization_members")
    .select(
      `
      user_id,
      org_role,
      joined_at,
      profiles:user_id(id, email, full_name)
    `
    )
    .eq("organization_id", membership.organization_id);

  if (usersError) {
    return Response.json({ error: usersError.message }, { status: 500 });
  }

  const formattedUsers = (users as unknown as OrganizationMemberWithProfile[] | null)?.map((u) => ({
    id: u.user_id,
    email: u.profiles?.email || "",
    name: u.profiles?.full_name || "Unknown",
    role: u.org_role === "owner" ? "admin" : u.org_role === "admin" ? "admin" : "user",
    status: "active",
    lastLogin: null,
    createdAt: u.joined_at,
    updatedAt: u.joined_at,
    assignedClientIds: [],
  }));

  return Response.json({ users: formattedUsers || [] });
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

  // Generate temporary password
  const tempPassword = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 5).toUpperCase();

  // Simulate creating user (in real implementation, would call auth endpoint)
  // For now, return success with generated password
  return Response.json(
    {
      id: "temp-" + Date.now(),
      email,
      name,
      role,
      status: "active",
      lastLogin: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assignedClientIds: clientIds,
      password: tempPassword,
    },
    { status: 200 }
  );
}
