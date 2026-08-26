import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { signToken } from "@/lib/jwt";
import { NextResponse } from "next/server";

interface LoginRequest {
  email: string;
  password: string;
}

/**
 * POST /api/auth/login
 * Authenticate a user and return a JWT token with role field
 *
 * Request body:
 * {
 *   "email": "user@example.com",
 *   "password": "password123"
 * }
 *
 * Response:
 * {
 *   "token": "eyJhbGc...",
 *   "user": {
 *     "id": "uuid",
 *     "email": "user@example.com",
 *     "role": "admin"
 *   }
 * }
 */
export async function POST(request: Request) {
  try {
    const body: LoginRequest = await request.json();

    // Validate input
    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabase();

    // Authenticate with Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const userId = authData.user.id;

    // Get user's organization and role
    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("org_role, organization_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { error: "Failed to fetch user role" },
        { status: 500 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        { error: "User is not a member of any organization" },
        { status: 403 }
      );
    }

    // Map Supabase org_role to AuthToken role
    const role = mapOrgRoleToAuthRole(membership.org_role);

    // Sign JWT token with role field
    const token = signToken(userId, role);

    // Return token and user info
    return NextResponse.json(
      {
        token,
        user: {
          id: userId,
          email: authData.user.email,
          role,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Map Supabase organization role to JWT authentication role
 *
 * Mapping:
 * - owner -> admin (full permissions)
 * - admin -> admin (full permissions)
 * - member -> user (standard permissions)
 */
function mapOrgRoleToAuthRole(orgRole: string): 'admin' | 'user' | 'viewer' {
  switch (orgRole) {
    case 'owner':
    case 'admin':
      return 'admin';
    case 'member':
    default:
      return 'user';
  }
}
