import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export const INTEGRATION_PROVIDERS = [
  "slack",
  "teams",
  "zoom",
  "n8n",
  "openai",
  "anthropic",
  "github",
  "resend",
  "gmail_inbound",
  "google",
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export interface Integration {
  id: string;
  provider: IntegrationProvider;
  config: Record<string, Json>;
  isActive: boolean;
  hasCredential: boolean;
}

export async function fetchIntegrations(supabase: TypedClient, tenantId: string): Promise<Integration[]> {
  const { data, error } = await supabase
    .from("integrations")
    .select("id, provider, config, is_active, credentials_enc")
    .eq("tenant_id", tenantId)
    .order("provider");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    provider: row.provider as IntegrationProvider,
    config: (row.config ?? {}) as Record<string, Json>,
    isActive: row.is_active,
    hasCredential: row.credentials_enc !== null,
  }));
}

// secret: null = no cambiar el secreto guardado; "" = borrarlo; string = crear/actualizar.
// Vía RPC SECURITY DEFINER: el secreto se guarda en Supabase Vault, nunca en texto plano
// en la tabla integrations (credentials_enc solo almacena el id del secreto en Vault).
export async function upsertIntegration(
  supabase: TypedClient,
  tenantId: string,
  provider: IntegrationProvider,
  config: Record<string, Json>,
  secret: string | null,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase.rpc("upsert_integration", {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_config: config as Json,
    // El generador de tipos no marca p_secret como nullable (no tiene
    // DEFAULT en Postgres), pero la función sí acepta null en tiempo real
    // — es el sentinel documentado arriba para "no cambiar el secreto".
    p_secret: secret as string,
    p_is_active: isActive,
  });
  if (error) throw error;
}

export async function removeIntegration(supabase: TypedClient, integrationId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_integration", { p_integration_id: integrationId });
  if (error) throw error;
}
