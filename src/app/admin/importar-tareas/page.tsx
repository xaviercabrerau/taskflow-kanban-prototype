"use client";
import ImportTasksPanel from "@/components/ImportTasksPanel";

export default function AdminImportarTareasPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Importar tareas</div>
      <h1>Importar tareas</h1>
      <div style={{ marginTop: 20 }}>
        <ImportTasksPanel embedded onClose={() => {}} />
      </div>
    </>
  );
}
