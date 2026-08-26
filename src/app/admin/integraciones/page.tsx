"use client";
import IntegrationsModal from "@/components/IntegrationsModal";

export default function AdminIntegracionesPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Integraciones</div>
      <h1>Integraciones de terceros</h1>
      <div style={{ marginTop: 20 }}>
        <IntegrationsModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
