"use client";
import AuditExportModal from "@/components/AuditExportModal";

export default function AdminAuditoriaPage() {
  return (
    <>
      <div className="admin-breadcrumb">Seguridad / Auditoría</div>
      <h1>Registro de auditoría</h1>
      <div style={{ marginTop: 20 }}>
        <AuditExportModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
