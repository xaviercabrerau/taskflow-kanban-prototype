import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { fetchShareLinks, createShareLink, type ShareScope, type SharePermission } from "@/lib/supabase/share-links-repo";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

/**
 * GET /api/share-links?boardId=...
 * Lista los links activos (no revocados) de un tablero. Solo miembros de la
 * organización — RLS en public_share_links_all hace cumplir esto.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const boardId = request.nextUrl.searchParams.get("boardId");
  if (!boardId) {
    return NextResponse.json({ error: "boardId es requerido" }, { status: 400 });
  }

  try {
    const links = await fetchShareLinks(supabase, boardId);
    return NextResponse.json({ links });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/share-links
 * Body: { boardId, scope: 'board'|'task', permission: 'view'|'comment', taskId?, expiresAt?, label? }
 * Crea un link compartible vía la RPC create_share_link (genera y hashea el
 * token del lado servidor); el token en texto plano solo se devuelve aquí,
 * una vez.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(deriveRateLimitKey(`share-links-create:${authData.user.id}`));
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  let body: {
    boardId?: string;
    scope?: ShareScope;
    permission?: SharePermission;
    taskId?: string | null;
    expiresAt?: string | null;
    label?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.boardId || (body.scope !== "board" && body.scope !== "task")) {
    return NextResponse.json({ error: "boardId y scope ('board'|'task') son requeridos" }, { status: 400 });
  }
  if (body.permission !== "view" && body.permission !== "comment") {
    return NextResponse.json({ error: "permission debe ser 'view' o 'comment'" }, { status: 400 });
  }
  if (body.scope === "task" && !body.taskId) {
    return NextResponse.json({ error: "taskId es requerido para scope='task'" }, { status: 400 });
  }

  try {
    const { link, token } = await createShareLink(supabase, body.boardId, body.scope, body.permission, {
      taskId: body.taskId ?? null,
      expiresAt: body.expiresAt ?? null,
      label: body.label ?? null,
    });
    return NextResponse.json({ link, token });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
