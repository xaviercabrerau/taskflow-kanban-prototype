import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesUpdate } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export interface OrgSecuritySettings {
  auditRetentionDays: number;
  mfaRequired: boolean;
  ssoEnabled: boolean;
  ssoDomain: string | null;
  mcpTokensEnabled: boolean;
}

export async function fetchOrgSettings(supabase: TypedClient, tenantId: string): Promise<OrgSecuritySettings> {
  const { data, error } = await supabase
    .from("organizations")
    .select("audit_retention_days, mfa_required, sso_enabled, sso_domain, mcp_tokens_enabled")
    .eq("id", tenantId)
    .single();
  if (error) throw error;
  return {
    auditRetentionDays: data.audit_retention_days,
    mfaRequired: data.mfa_required,
    ssoEnabled: data.sso_enabled,
    ssoDomain: data.sso_domain,
    mcpTokensEnabled: data.mcp_tokens_enabled,
  };
}

export async function updateOrgSettings(
  supabase: TypedClient,
  tenantId: string,
  patch: Partial<{
    auditRetentionDays: number;
    mfaRequired: boolean;
    ssoEnabled: boolean;
    ssoDomain: string | null;
    mcpTokensEnabled: boolean;
  }>
): Promise<void> {
  const update: TablesUpdate<"organizations"> = {};
  if (patch.auditRetentionDays !== undefined) update.audit_retention_days = patch.auditRetentionDays;
  if (patch.mfaRequired !== undefined) update.mfa_required = patch.mfaRequired;
  if (patch.ssoEnabled !== undefined) update.sso_enabled = patch.ssoEnabled;
  if (patch.ssoDomain !== undefined) update.sso_domain = patch.ssoDomain;
  if (patch.mcpTokensEnabled !== undefined) update.mcp_tokens_enabled = patch.mcpTokensEnabled;
  const { error } = await supabase.from("organizations").update(update).eq("id", tenantId);
  if (error) throw error;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  source: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
}

export async function fetchAuditLog(
  supabase: TypedClient,
  tenantId: string,
  opts: { from?: string; to?: string; limit?: number } = {}
): Promise<AuditLogRow[]> {
  let query = supabase
    .from("audit_log")
    .select("id, actor_id, source, action, resource_type, resource_id, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 500);
  if (opts.from) query = query.gte("created_at", opts.from);
  if (opts.to) query = query.lte("created_at", opts.to);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    source: row.source,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    createdAt: row.created_at,
  }));
}
