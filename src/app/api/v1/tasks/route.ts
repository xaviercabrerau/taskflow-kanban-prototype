import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, isAuthError, safeApiError } from "@/lib/api-v1/auth";

/**
 * GET /api/v1/tasks — list all tasks visible to the token's owner.
 * Auth: Authorization: Bearer <tfmcp_... token from /admin/api-keys>.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (isAuthError(auth)) return auth;

  const { data, error } = await auth.supabase.rpc("mcp_list_tasks", { p_token: auth.token });
  if (error) {
    return NextResponse.json({ error: safeApiError("list_tasks", error) }, { status: 400 });
  }
  return NextResponse.json({ tasks: data });
}

/**
 * POST /api/v1/tasks — create a task.
 * Body: { title: string, priority?: 'low'|'medium'|'high'|'urgent', due_date?: 'YYYY-MM-DD', board_name?: string }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (isAuthError(auth)) return auth;

  let body: { title?: string; priority?: string; due_date?: string; board_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: '"title" is required' }, { status: 400 });
  }
  if (body.title.length > 300) {
    return NextResponse.json({ error: '"title" must be 300 characters or fewer' }, { status: 400 });
  }

  const { data, error } = await auth.supabase.rpc("mcp_create_task", {
    p_token: auth.token,
    p_title: body.title,
    p_priority: body.priority ?? "medium",
    p_due_date: body.due_date ?? undefined,
    p_board_name: body.board_name ?? undefined,
  });
  if (error) {
    return NextResponse.json({ error: safeApiError("create_task", error) }, { status: 400 });
  }
  return NextResponse.json({ taskId: data }, { status: 201 });
}
