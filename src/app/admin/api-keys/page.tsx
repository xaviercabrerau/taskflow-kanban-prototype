"use client";
import McpTokensModal from "@/components/McpTokensModal";

export default function AdminApiKeysPage() {
  return (
    <>
      <div className="admin-breadcrumb">Seguridad / API Keys</div>
      <h1>Tokens de acceso (MCP)</h1>
      <div style={{ marginTop: 20 }}>
        <McpTokensModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
