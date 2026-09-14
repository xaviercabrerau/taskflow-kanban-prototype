import { timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getGithubToken, fetchGithubIssueOrPr } from "@/lib/github/client";

// Cron cada 15 minutos (vercel.json) que revisa los PRs vinculados a
// tareas (task_github_links) y mueve la tarea a la columna "done" del
// tablero cuando GitHub reporta el PR como mergeado. Polling, no webhook
// — ninguna organización tiene hoy una GitHub App instalada; el mismo
// Personal Access Token que ya usa TaskGithubSection.tsx para traer
// título/estado alcanza para esto (ver diseño 2026-09-13).
//
// Auth: mismo patrón que /api/cron/alert-check — Bearer CRON_SECRET.
function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service-role configuration missing");
  return createClient<Database>(url, key);
}

interface LinkedTaskRow {
  id: string;
  task_id: string;
  url: string;
  repo: string;
  number: number;
  kind: string;
  state: string;
  tasks: { id: string; board_id: string; column_id: string; tenant_id: string } | null;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  const { data: links, error: linksError } = await supabase
    .from("task_github_links")
    .select("id, task_id, url, repo, number, kind, state, tasks:task_id(id, board_id, column_id, tenant_id)")
    .eq("kind", "pull_request")
    .neq("state", "merged");
  if (linksError) {
    return Response.json({ error: linksError.message }, { status: 500 });
  }

  let moved = 0;
  const tokenCache = new Map<string, string | null>();
  const doneColumnCache = new Map<string, string | null>();

  for (const link of (links ?? []) as unknown as LinkedTaskRow[]) {
    const task = link.tasks;
    if (!task) continue;

    let token = tokenCache.get(task.tenant_id);
    if (token === undefined) {
      token = await getGithubToken(task.tenant_id);
      tokenCache.set(task.tenant_id, token);
    }
    if (!token) continue; // Org sin GitHub conectado — nada que revisar.

    let refreshed;
    try {
      refreshed = await fetchGithubIssueOrPr(token, link.url);
    } catch {
      continue; // PR eliminado / repo inaccesible — se reintenta en la próxima corrida.
    }

    if (refreshed.state !== "merged") {
      if (refreshed.state !== link.state) {
        await supabase.from("task_github_links").update({ state: refreshed.state }).eq("id", link.id);
      }
      continue;
    }

    let doneColumnId = doneColumnCache.get(task.board_id);
    if (doneColumnId === undefined) {
      const { data: doneColumns } = await supabase
        .from("board_columns")
        .select("id")
        .eq("board_id", task.board_id)
        .eq("is_done_state", true)
        .order("position", { ascending: true })
        .limit(1);
      doneColumnId = doneColumns?.[0]?.id ?? null;
      doneColumnCache.set(task.board_id, doneColumnId);
    }
    if (!doneColumnId || task.column_id === doneColumnId) {
      await supabase.from("task_github_links").update({ state: "merged" }).eq("id", link.id);
      continue;
    }

    // Date.now() as position: monotonically increasing, so the task lands
    // after whatever is already in the done column without an extra query
    // (mirrors the "append" fallback in board-repo's fractional positioning).
    await supabase.from("tasks").update({ column_id: doneColumnId, position: Date.now() }).eq("id", task.id);
    await supabase.from("task_github_links").update({ state: "merged" }).eq("id", link.id);
    await supabase.from("audit_log").insert({
      tenant_id: task.tenant_id,
      actor_id: null,
      source: "github_sync_cron",
      action: "task_auto_moved_github_merge",
      resource_type: "task",
      resource_id: task.id,
      metadata: { github_url: link.url },
    });
    moved += 1;
  }

  return Response.json({ moved });
}
