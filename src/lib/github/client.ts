/**
 * Server-only accessor for an organization's GitHub Personal Access Token
 * (configured in /admin/integraciones). Reads via get_github_token, revoked
 * from anon/authenticated — same pattern as src/lib/google/client.ts and
 * src/lib/ai/client.ts.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service-role configuration missing");
  return createClient<Database>(url, key);
}

/** Returns null if GitHub isn't connected for this tenant. */
export async function getGithubToken(tenantId: string): Promise<string | null> {
  const supabase = getServiceClient();
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, args: object) => Promise<{ data: string | null; error: { message: string } | null }>;
    }
  ).rpc("get_github_token", { p_tenant_id: tenantId });

  if (error) {
    console.error("Failed to fetch GitHub token", { tenantId, error: error.message });
    return null;
  }
  return data;
}

export interface GithubIssueOrPr {
  repo: string;
  number: number;
  kind: "issue" | "pull_request";
  title: string;
  state: string;
}

const URL_PATTERN = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)/;

/** Parses a GitHub issue/PR URL and fetches its current title/state via the REST API. */
export async function fetchGithubIssueOrPr(token: string, url: string): Promise<GithubIssueOrPr> {
  const match = url.trim().match(URL_PATTERN);
  if (!match) {
    throw new Error("URL de GitHub no reconocida. Debe ser un link a un issue o pull request.");
  }
  const [, repo, urlKind, numberStr] = match;
  const number = Number(numberStr);
  const kind: "issue" | "pull_request" = urlKind === "pull" ? "pull_request" : "issue";

  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(res.status === 404 ? "No se encontró ese issue/PR (revisa el link y el token)." : `GitHub API error: ${res.status}`);
  }
  const json = await res.json();
  const state = json.merged_at ? "merged" : json.state;

  return { repo, number, kind, title: json.title, state };
}
