"use client";
import WorkspaceModal from "@/components/WorkspaceModal";

export default function AdminWorkspacesPage() {
  return (
    <>
      <div className="admin-breadcrumb">Organización / Workspaces</div>
      <h1>Workspaces</h1>
      <div style={{ marginTop: 20 }}>
        <WorkspaceModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
