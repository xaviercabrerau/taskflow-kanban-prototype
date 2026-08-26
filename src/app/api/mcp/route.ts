import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import type { Database } from "@/lib/supabase/database.types";
import { checkRateLimit, deriveRateLimitKey } from "@/lib/rate-limit";

interface ToolSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
}

interface ToolInputSchema {
  type: string;
  properties: Record<string, ToolSchemaProperty>;
  required: string[];
}

const TOOLS: { name: string; description: string; inputSchema: ToolInputSchema }[] = [
  {
    name: "list_tasks",
    description: "List all tasks visible to the token's owner across their boards.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "create_task",
    description: "Create a new task on a board.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the task." },
        priority: {
          type: "string",
          description: "Task priority. Defaults to 'medium'.",
          enum: ["low", "medium", "high", "urgent"],
        },
        due_date: { type: "string", description: "Due date in YYYY-MM-DD format." },
        board_name: {
          type: "string",
          description: "Name of the board to create the task on. Defaults to the owner's default board.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "move_task",
    description: "Move a task to a different column.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "UUID of the task to move." },
        column_label: { type: "string", description: "Label of the destination column." },
      },
      required: ["task_id", "column_label"],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "UUID of the task to comment on." },
        body: { type: "string", description: "Comment text." },
      },
      required: ["task_id", "body"],
    },
  },
];

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  status = 200
) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function extractToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  // Los tokens de create_mcp_session siempre llevan el prefijo tfmcp_ con
  // 48 hex chars después — descartar cualquier otra forma antes de la
  // consulta a la DB (no es una boundary de seguridad, solo evita un
  // round-trip inútil para tokens obviamente inválidos).
  if (!token.startsWith("tfmcp_") || token.length < 20) return null;
  return token;
}

function getSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function toolTextResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

// Minimal manual validator against a tool's own declared JSON Schema (no
// zod/ajv dependency — the project doesn't already use a schema library).
// Checks presence of `required` fields and `typeof`/`enum` of any declared
// property that's present, returning the first failing field name or null.
function validateArgs(schema: ToolInputSchema, args: Record<string, unknown>): string | null {
  for (const field of schema.required) {
    if (args[field] === undefined || args[field] === null) {
      return `"${field}" is required`;
    }
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (prop.type === "string" && typeof value !== "string") {
      return `"${key}" must be a string`;
    }
    if (prop.enum && typeof value === "string" && !prop.enum.includes(value)) {
      return `"${key}" must be one of: ${prop.enum.join(", ")}`;
    }
  }
  return null;
}

// Mensajes genéricos por herramienta: el detalle real del error de Postgres
// (nombres de constraints, columnas, texto interno) se registra server-side
// pero nunca se reenvía al cliente MCP — cualquier tenedor de un PAT válido
// podría usarlo para enumerar el esquema interno.
function safeToolError(tool: string, error: { message: string; code?: string }): string {
  console.error(`[mcp:${tool}]`, error.code ?? "", error.message);
  if (error.message?.toLowerCase().includes("invalid or expired token")) {
    return "Token inválido o expirado.";
  }
  return "No se pudo completar la operación. Verifica los parámetros e intenta de nuevo.";
}

async function callTool(name: string, args: Record<string, unknown>, token: string) {
  const supabase = getSupabase();

  if (name === "list_tasks") {
    const { data, error } = await supabase.rpc("mcp_list_tasks", { p_token: token });
    if (error) return toolTextResult(safeToolError(name, error), true);
    return toolTextResult(JSON.stringify(data, null, 2));
  }

  if (name === "create_task") {
    const { data, error } = await supabase.rpc("mcp_create_task", {
      p_token: token,
      p_title: args.title as string,
      p_priority: (args.priority as string) ?? "medium",
      p_due_date: (args.due_date as string) ?? null,
      p_board_name: (args.board_name as string) ?? null,
    });
    if (error) return toolTextResult(safeToolError(name, error), true);
    return toolTextResult(`Created task ${data}.`);
  }

  if (name === "move_task") {
    const { error } = await supabase.rpc("mcp_move_task", {
      p_token: token,
      p_task_id: args.task_id as string,
      p_column_label: args.column_label as string,
    });
    if (error) return toolTextResult(safeToolError(name, error), true);
    return toolTextResult(`Moved task ${args.task_id} to "${args.column_label}".`);
  }

  if (name === "add_comment") {
    const { data, error } = await supabase.rpc("mcp_add_comment", {
      p_token: token,
      p_task_id: args.task_id as string,
      p_body: args.body as string,
    });
    if (error) return toolTextResult(safeToolError(name, error), true);
    return toolTextResult(`Added comment ${data} to task ${args.task_id}.`);
  }

  return toolTextResult(`Unknown tool: ${name}`, true);
}

export async function POST(request: Request) {
  // Top-level try/catch so an unhandled crash anywhere in this handler
  // (malformed JSON body, an unexpected Supabase client-construction
  // failure, etc.) reports to Sentry before we fail the JSON-RPC request,
  // rather than surfacing as a bare unhandled 500 with no observability.
  try {
    const rateLimitToken = extractToken(request);
    const rateLimitKey = deriveRateLimitKey(rateLimitToken);
    const rateLimit = await checkRateLimit(rateLimitKey);
    if (!rateLimit.success) {
      return rpcError(null, -32029, "Rate limit exceeded. Please slow down and try again later.", 429);
    }

    const body = (await request.json()) as JsonRpcRequest;
    const { id, method, params } = body;

    if (method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }

    if (method === "initialize") {
      return rpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "taskflow-mcp", version: "1.0.0" },
      });
    }

    if (method === "tools/list") {
      return rpcResult(id, { tools: TOOLS });
    }

    if (method === "tools/call") {
      const token = extractToken(request);
      if (!token) {
        return rpcError(id, -32001, "Missing or invalid bearer token");
      }
      const name = params?.name;
      if (typeof name !== "string" || !name) {
        return rpcError(id, -32602, "Invalid params: \"name\" is required");
      }

      const rawArgs = params?.arguments;
      if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
        return rpcError(id, -32602, "Invalid params: \"arguments\" must be an object");
      }
      const args = (rawArgs as Record<string, unknown>) ?? {};

      const tool = TOOLS.find((t) => t.name === name);
      if (tool) {
        const validationError = validateArgs(tool.inputSchema, args);
        if (validationError) {
          return rpcError(id, -32602, `Invalid params: ${validationError}`);
        }
      }

      const result = await callTool(name, args, token);
      return rpcResult(id, result);
    }

    return rpcError(id, -32601, "Method not found");
  } catch (error) {
    Sentry.captureException(error);
    console.error("[mcp:POST] unhandled error", error);
    return rpcError(null, -32603, "Internal error");
  }
}
