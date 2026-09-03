"use client";
import EpicsSprintsPanel from "@/components/EpicsSprintsPanel";

export default function AdminPlanificacionPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Épicas y Sprints</div>
      <h1>Épicas y Sprints</h1>
      <div style={{ marginTop: 20 }}>
        <EpicsSprintsPanel embedded onClose={() => {}} />
      </div>
    </>
  );
}
