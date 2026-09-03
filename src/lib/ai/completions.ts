import type { AiCredential } from "./client";

/**
 * Thin wrapper over the OpenAI/Anthropic chat APIs via plain fetch — no SDK
 * dependency, matching this repo's pattern of avoiding extra bundle weight
 * for a first working version (see csvExport.ts). Both providers are asked
 * to return raw JSON only, parsed by the caller.
 */
async function complete(credential: AiCredential, systemPrompt: string, userPrompt: string): Promise<string> {
  if (credential.provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("Respuesta inesperada de OpenAI");
    return text;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": credential.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const json = await res.json();
  const text = json.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("Respuesta inesperada de Anthropic");
  return text;
}

export interface ParsedTaskFields {
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null; // YYYY-MM-DD
}

const PARSE_SYSTEM_PROMPT = `Extraes campos estructurados de una descripción de tarea en lenguaje natural (español o inglés).
Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional, con esta forma exacta:
{"title": "string corto y claro", "priority": "low"|"medium"|"high"|"urgent", "dueDate": "YYYY-MM-DD"|null}
Si no se menciona una fecha, dueDate debe ser null. Si no se menciona urgencia/prioridad, usa "medium".
La fecha de hoy es {today}.`;

export async function parseTaskFromText(credential: AiCredential, text: string): Promise<ParsedTaskFields> {
  const today = new Date().toISOString().slice(0, 10);
  const raw = await complete(credential, PARSE_SYSTEM_PROMPT.replace("{today}", today), text);

  let parsed: unknown;
  try {
    // Algunos modelos envuelven el JSON en un bloque ```json aunque se les pida no hacerlo.
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("La IA no devolvió un JSON válido.");
  }

  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : text.slice(0, 120);
  const priority = ["low", "medium", "high", "urgent"].includes(obj.priority as string)
    ? (obj.priority as ParsedTaskFields["priority"])
    : "medium";
  const dueDate = typeof obj.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.dueDate) ? obj.dueDate : null;

  return { title, priority, dueDate };
}

const SUMMARIZE_SYSTEM_PROMPT = `Resumes en español, en un máximo de 4 líneas, el hilo de comentarios de una tarea de gestión de proyectos.
Enfócate en decisiones tomadas, bloqueos pendientes y próximos pasos. Responde solo con el resumen en texto plano, sin markdown.`;

export async function summarizeComments(credential: AiCredential, comments: string[]): Promise<string> {
  if (comments.length === 0) return "Sin comentarios para resumir.";
  const joined = comments.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const summary = await complete(credential, SUMMARIZE_SYSTEM_PROMPT, joined);
  return summary.trim();
}
