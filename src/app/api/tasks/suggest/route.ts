import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { getAiCredential } from "@/lib/ai/client";
import { suggestTaskFields } from "@/lib/ai/completions";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

/**
 * POST /api/tasks/suggest
 * Body: { title: string, boardId: string, tenantId: string }
 * Sugiere prioridad/responsable para una tarea nueva basándose en el
 * historial reciente del tablero. Nunca se aplica sola — el cliente
 * (TaskModal) la muestra como sugerencia descartable. Responde 501 si no
 * hay credencial de IA configurada, mismo contrato que
 * parse-natural-language.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(deriveRateLimitKey(`ai-suggest-task:${authData.user.id}`));
  if (!rateLimit.success) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." }, { status: 429 });
  }

  let body: { title?: string; boardId?: string; tenantId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.title?.trim() || !body.boardId || !body.tenantId) {
    return NextResponse.json({ error: "title, boardId y tenantId son requeridos" }, { status: 400 });
  }

  // Filtrar también por user_id (no solo organization_id) es obligatorio:
  // la política RLS de organization_members deja ver TODAS las filas de la
  // org a un owner (org_members_select: user_id = auth.uid() OR
  // is_org_owner(organization_id)). Sin el filtro por user_id, un owner de
  // una org con 2+ miembros recibía varias filas y .maybeSingle() fallaba
  // silenciosamente -> membership quedaba undefined -> 403 para el propio
  // dueño de la organización. Ver parse-natural-language/route.ts.
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", body.tenantId)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Error verificando membresía:", membershipError);
    return NextResponse.json({ error: "Sin permiso para esta organización" }, { status: 403 });
  }
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

  const { data: recentTasks } = await supabase
    .from("tasks")
    .select("title, priority, assignee_name")
    .eq("board_id", body.boardId)
    .order("created_at", { ascending: false })
    .limit(20);

  try {
    const suggestion = await suggestTaskFields(
      credential,
      body.title.trim(),
      (recentTasks ?? []).map((t) => ({
        title: t.title,
        priority: t.priority,
        assignee: t.assignee_name ?? "Sin asignar",
      }))
    );
    return NextResponse.json(suggestion);
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo generar la sugerencia.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
