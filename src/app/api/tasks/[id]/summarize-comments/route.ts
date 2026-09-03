import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { getAiCredential } from "@/lib/ai/client";
import { summarizeComments } from "@/lib/ai/completions";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

/**
 * POST /api/tasks/[id]/summarize-comments
 * Resume el hilo de comentarios de una tarea usando la credencial de IA
 * configurada por la organización. 501 si no hay ninguna configurada.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: taskId } = await params;
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(deriveRateLimitKey(`ai-summarize-comments:${authData.user.id}`));
  if (!rateLimit.success) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." }, { status: 429 });
  }

  // RLS-scoped: only succeeds if the caller is a member of the task's org.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("tenant_id")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError || !task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const credential = await getAiCredential(task.tenant_id);
  if (!credential) {
    return NextResponse.json(
      { error: "IA no configurada. Agrega una API key de OpenAI o Anthropic en Integraciones." },
      { status: 501 }
    );
  }

  const { data: comments, error: commentsError } = await supabase
    .from("comments")
    .select("body")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (commentsError) {
    return NextResponse.json({ error: commentsError.message }, { status: 500 });
  }

  try {
    const summary = await summarizeComments(
      credential,
      (comments ?? []).map((c) => c.body)
    );
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo generar el resumen.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
