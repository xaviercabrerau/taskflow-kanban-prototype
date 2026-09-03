import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

const MAX_COMMENT_LENGTH = 4000;
const MAX_GUEST_NAME_LENGTH = 80;

/**
 * POST /api/public/share/[token]/comment
 * Body: { body: string, guestName?: string }
 * Endpoint público (sin autenticación) que agrega un comentario de invitado
 * vía la RPC add_share_link_comment (SECURITY DEFINER) — esta rechaza la
 * escritura si el link no es scope=task+permission=comment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  const rateLimit = await checkRateLimit(deriveRateLimitKey(`public-share-comment:${token}`));
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  let body: { body?: string; guestName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const commentBody = body.body?.trim();
  if (!commentBody || commentBody.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json({ error: "Comentario inválido." }, { status: 400 });
  }
  const guestName = body.guestName?.trim().slice(0, MAX_GUEST_NAME_LENGTH) || null;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("add_share_link_comment", {
    p_token: token,
    p_body: commentBody,
    // Generated type marks this as `string` (not nullable); the SQL
    // function accepts null (falls back to 'Invitado') — see share-links-repo.ts.
    p_guest_name: guestName as unknown as string,
  });
  if (error) {
    return NextResponse.json({ error: "No se pudo enviar el comentario. El link puede haber expirado." }, { status: 400 });
  }

  return NextResponse.json({ data });
}
