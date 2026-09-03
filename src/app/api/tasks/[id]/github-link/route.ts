import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { getGithubToken, fetchGithubIssueOrPr } from "@/lib/github/client";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";
import { safeApiError } from "@/lib/api-v1/auth";

/**
 * POST /api/tasks/[id]/github-link
 * Body: { url: string } — un link a un issue o pull request de GitHub.
 * Responde 501 si la organización no tiene un token de GitHub configurado
 * en /admin/integraciones.
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

  const rateLimit = await checkRateLimit(deriveRateLimitKey(`github-link:${authData.user.id}`));
  if (!rateLimit.success) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." }, { status: 429 });
  }

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.url?.trim()) {
    return NextResponse.json({ error: "url es requerida" }, { status: 400 });
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("tenant_id")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError || !task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const token = await getGithubToken(task.tenant_id);
  if (!token) {
    return NextResponse.json(
      { error: "GitHub no configurado. Agrega un token de acceso personal en Integraciones." },
      { status: 501 }
    );
  }

  try {
    const issue = await fetchGithubIssueOrPr(token, body.url.trim());
    const { data: link, error: insertError } = await supabase
      .from("task_github_links")
      .insert({
        task_id: taskId,
        tenant_id: task.tenant_id,
        url: body.url.trim(),
        repo: issue.repo,
        number: issue.number,
        kind: issue.kind,
        title: issue.title,
        state: issue.state,
        created_by: authData.user.id,
      })
      .select("*")
      .single();
    if (insertError) {
      return NextResponse.json({ error: safeApiError("github-link", insertError) }, { status: 500 });
    }
    return NextResponse.json({ link }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo vincular el issue/PR.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
