"use client";
import AutomationsModal from "@/components/AutomationsModal";

export default function AdminAutomatizacionesPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Automatizaciones</div>
      <h1>Automatizaciones</h1>
      <div style={{ marginTop: 20 }}>
        <AutomationsModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
