import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import {
  checkIpRateLimit,
  checkRateLimit,
  deriveIpRateLimitKey,
  deriveRateLimitKey,
  getClientIp,
} from "@/lib/rate-limit";

/**
 * GET /api/public/share/[token]
 * Endpoint público (sin autenticación) que resuelve un link compartible vía
 * la RPC resolve_share_link (SECURITY DEFINER). Dos límites: por IP de
 * confianza (cabecera que pone la plataforma, no x-forwarded-for) y por el
 * propio token hasheado. El del token solo no basta: el token lo manda el
 * cliente, así que variarlo daba un cubo nuevo —y una consulta a la base—
 * por cada petición.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  const ipLimit = await checkIpRateLimit(deriveIpRateLimitKey(getClientIp(request)));
  if (!ipLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

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
