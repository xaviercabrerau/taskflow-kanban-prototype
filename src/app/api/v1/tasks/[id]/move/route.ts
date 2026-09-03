import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, isAuthError, safeApiError } from "@/lib/api-v1/auth";

/**
 * POST /api/v1/tasks/[id]/move — move a task to a different column.
 * Body: { column_label: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: taskId } = await params;
  const auth = await authenticateApiRequest(request);
  if (isAuthError(auth)) return auth;

  let body: { column_label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.column_label || typeof body.column_label !== "string") {
    return NextResponse.json({ error: '"column_label" is required' }, { status: 400 });
  }

  const { error } = await auth.supabase.rpc("mcp_move_task", {
    p_token: auth.token,
    p_task_id: taskId,
    p_column_label: body.column_label,
  });
  if (error) {
    return NextResponse.json({ error: safeApiError("move_task", error) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
