import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, isAuthError, safeApiError } from "@/lib/api-v1/auth";

/**
 * POST /api/v1/tasks/[id]/comments — add a comment to a task.
 * Body: { body: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: taskId } = await params;
  const auth = await authenticateApiRequest(request);
  if (isAuthError(auth)) return auth;

  let body: { body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.body || typeof body.body !== "string") {
    return NextResponse.json({ error: '"body" is required' }, { status: 400 });
  }
  if (body.body.length > 4000) {
    return NextResponse.json({ error: '"body" must be 4000 characters or fewer' }, { status: 400 });
  }

  const { data, error } = await auth.supabase.rpc("mcp_add_comment", {
    p_token: auth.token,
    p_task_id: taskId,
    p_body: body.body,
  });
  if (error) {
    return NextResponse.json({ error: safeApiError("add_comment", error) }, { status: 400 });
  }
  return NextResponse.json({ commentId: data }, { status: 201 });
}
