import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { getAiCredential } from "@/lib/ai/client";
import { parseTaskFromText } from "@/lib/ai/completions";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

/**
 * POST /api/tasks/parse-natural-language
 * Body: { text: string }
 * Extrae título/prioridad/fecha de una descripción libre usando la
 * credencial de IA (OpenAI/Anthropic) configurada por la organización en
 * /admin/integraciones. Responde 501 si ninguna está configurada — el
 * llamador (TaskModal) debe tratarlo como "función no disponible", no como
 * un error de servidor.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(deriveRateLimitKey(`ai-parse-task:${authData.user.id}`));
  if (!rateLimit.success) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." }, { status: 429 });
  }

  let body: { text?: string; tenantId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.text?.trim() || !body.tenantId) {
    return NextResponse.json({ error: "text y tenantId son requeridos" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", body.tenantId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Sin permiso para esta organización" }, { status: 403 });
  }

  const credential = await getAiCredential(body.tenantId);
  if (!credential) {
    return NextResponse.json(
      { error: "IA no configurada. Agrega una API key de OpenAI o Anthropic en Integraciones." },
      { status: 501 }
    );
  }

  try {
    const fields = await parseTaskFromText(credential, body.text.trim());
    return NextResponse.json(fields);
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo interpretar el texto.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
