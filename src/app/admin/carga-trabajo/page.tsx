"use client";
import WorkloadPanel from "@/components/WorkloadPanel";

export default function AdminWorkloadPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Carga de trabajo</div>
      <h1>Carga de trabajo</h1>
      <div style={{ marginTop: 20 }}>
        <WorkloadPanel embedded onClose={() => {}} />
      </div>
    </>
  );
}
