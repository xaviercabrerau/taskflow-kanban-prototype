const BASE_URL = "https://task.conto.ec";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/v1/tasks",
    desc: "Lista todas las tareas visibles para el dueño del token.",
    body: null,
    example: `curl ${BASE_URL}/api/v1/tasks \\
  -H "Authorization: Bearer tfmcp_TU_TOKEN"`,
  },
  {
    method: "POST",
    path: "/api/v1/tasks",
    desc: "Crea una tarea nueva.",
    body: `{ "title": "string", "priority"?: "low"|"medium"|"high"|"urgent", "due_date"?: "YYYY-MM-DD", "board_name"?: "string" }`,
    example: `curl -X POST ${BASE_URL}/api/v1/tasks \\
  -H "Authorization: Bearer tfmcp_TU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Revisar contrato", "priority": "high"}'`,
  },
  {
    method: "POST",
    path: "/api/v1/tasks/{id}/move",
    desc: "Mueve una tarea a otra columna (por el label visible, ej. \"En progreso\").",
    body: `{ "column_label": "string" }`,
    example: `curl -X POST ${BASE_URL}/api/v1/tasks/TASK_ID/move \\
  -H "Authorization: Bearer tfmcp_TU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"column_label": "En progreso"}'`,
  },
  {
    method: "POST",
    path: "/api/v1/tasks/{id}/comments",
    desc: "Agrega un comentario a una tarea.",
    body: `{ "body": "string" }`,
    example: `curl -X POST ${BASE_URL}/api/v1/tasks/TASK_ID/comments \\
  -H "Authorization: Bearer tfmcp_TU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"body": "Quedó listo, revisar por favor."}'`,
  },
];

export default function AdminApiDocsPage() {
  return (
    <>
      <div className="admin-breadcrumb">Seguridad / API pública</div>
      <h1>API pública (REST)</h1>
      <div style={{ marginTop: 20, maxWidth: 760, display: "flex", flexDirection: "column", gap: 24 }}>
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
          API REST para integrar TaskFlow con scripts o sistemas externos. Usa el mismo token de acceso personal
          (formato <code>tfmcp_...</code>) que las herramientas MCP — créalo en{" "}
          <a href="/admin/api-keys">API Keys (MCP)</a>. Cada token hereda los permisos de quien lo creó y respeta el
          mismo límite de solicitudes (30/min).
        </p>
        {ENDPOINTS.map((ep) => (
          <div key={ep.method + ep.path} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 6 }}>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "var(--surface-2, rgba(128,128,128,0.15))",
                }}
              >
                {ep.method}
              </span>
              <code style={{ fontSize: 13.5 }}>{ep.path}</code>
            </div>
            <p style={{ fontSize: 13.5, margin: "0 0 10px" }}>{ep.desc}</p>
            {ep.body && (
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
                Body: <code>{ep.body}</code>
              </p>
            )}
            <pre
              style={{
                background: "var(--surface-2, rgba(128,128,128,0.1))",
                borderRadius: 8,
                padding: 12,
                fontSize: 12,
                overflowX: "auto",
                margin: 0,
              }}
            >
              {ep.example}
            </pre>
          </div>
        ))}
        <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Todas las respuestas de error usan <code>{"{ error: string }"}</code> con status HTTP apropiado (401 sin
          token válido, 429 límite excedido, 400 parámetros inválidos).
        </p>
      </div>
    </>
  );
}
