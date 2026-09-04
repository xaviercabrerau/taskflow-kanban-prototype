import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

type TypedClient = SupabaseClient<Database>;

export type AutomationTrigger =
  | { type: "task_created" }
  | { type: "status_changed"; to_column_id?: string }
  | { type: "due_date_approaching"; days_before: number }
  | { type: "sla_stale"; hours: number };

export type AutomationAction =
  | { type: "move_to_column"; column_id: string }
  | { type: "set_field"; field: string; value: string }
  | { type: "add_comment"; body: string }
  | { type: "webhook"; url: string }
  // Sincroniza la tarea con un ticket/caso en el CRM configurado en
  // integration_id (provider "crm_generic") — crea o actualiza según si la
  // tarea ya tiene external_ticket_id. Ejecutada en execute_automation_rules()
  // (20260904000000_crm_generic_adapter.sql), no en el cliente.
  | { type: "crm_sync"; integration_id: string };

export type AutomationConditionField = "priority" | "tag" | "assignee_name" | "title";
export type AutomationConditionOperator = "eq" | "neq" | "contains";

export interface AutomationCondition {
  field: AutomationConditionField;
  operator: AutomationConditionOperator;
  value: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  isActive: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdAt: string;
}

const TRIGGER_TYPES = new Set(["task_created", "status_changed", "due_date_approaching", "sla_stale"]);
const ACTION_TYPES = new Set(["move_to_column", "set_field", "add_comment", "webhook", "crm_sync"]);
const CONDITION_FIELDS = new Set<AutomationConditionField>(["priority", "tag", "assignee_name", "title"]);
const CONDITION_OPERATORS = new Set<AutomationConditionOperator>(["eq", "neq", "contains"]);

function isAutomationTrigger(x: unknown): x is AutomationTrigger {
  return typeof x === "object" && x !== null && TRIGGER_TYPES.has((x as { type?: unknown }).type as string);
}

function isAutomationCondition(x: unknown): x is AutomationCondition {
  if (typeof x !== "object" || x === null) return false;
  const c = x as { field?: unknown; operator?: unknown; value?: unknown };
  return (
    CONDITION_FIELDS.has(c.field as AutomationConditionField) &&
    CONDITION_OPERATORS.has(c.operator as AutomationConditionOperator) &&
    typeof c.value === "string"
  );
}

function isAutomationAction(x: unknown): x is AutomationAction {
  return typeof x === "object" && x !== null && ACTION_TYPES.has((x as { type?: unknown }).type as string);
}

const DEFAULT_TRIGGER: AutomationTrigger = { type: "task_created" };

function mapRow(row: Database["public"]["Tables"]["automation_rules"]["Row"]): AutomationRule {
  const rawConditions: unknown[] = Array.isArray(row.conditions) ? row.conditions : [];
  const rawActions: unknown[] = Array.isArray(row.actions) ? row.actions : [];
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    trigger: isAutomationTrigger(row.trigger) ? row.trigger : DEFAULT_TRIGGER,
    conditions: rawConditions.filter(isAutomationCondition),
    actions: rawActions.filter(isAutomationAction),
    createdAt: row.created_at,
  };
}

export async function fetchAutomationRules(supabase: TypedClient, workspaceId: string): Promise<AutomationRule[]> {
  const { data, error } = await supabase
    .from("automation_rules")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createAutomationRule(
  supabase: TypedClient,
  params: {
    tenantId: string;
    workspaceId: string;
    name: string;
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  }
): Promise<AutomationRule> {
  const { data, error } = await supabase
    .from("automation_rules")
    .insert({
      tenant_id: params.tenantId,
      workspace_id: params.workspaceId,
      name: params.name,
      trigger: params.trigger as unknown as Json,
      conditions: params.conditions as unknown as Json,
      actions: params.actions as unknown as Json,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function toggleAutomationRule(supabase: TypedClient, ruleId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("automation_rules").update({ is_active: isActive }).eq("id", ruleId);
  if (error) throw error;
}

export async function deleteAutomationRule(supabase: TypedClient, ruleId: string): Promise<void> {
  const { error } = await supabase.from("automation_rules").delete().eq("id", ruleId);
  if (error) throw error;
}
