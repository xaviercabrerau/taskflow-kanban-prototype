import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

/**
 * GET /api/public/share/[token]
 * Endpoint público (sin autenticación) que resuelve un link compartible vía
 * la RPC resolve_share_link (SECURITY DEFINER). Rate-limited por el propio
 * token (hasheado) para no depender de una IP suplantable — ver deriveRateLimitKey.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  const rateLimit = await checkRateLimit(deriveRateLimitKey(`public-share:${token}`));
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("resolve_share_link", { p_token: token });
  if (error) {
    return NextResponse.json({ error: "Link inválido o expirado." }, { status: 404 });
  }

  return NextResponse.json({ data });
}
