"use client";
import RecurringTasksPanel from "@/components/RecurringTasksPanel";

export default function AdminRecurringTasksPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Tareas recurrentes</div>
      <h1>Tareas recurrentes</h1>
      <div style={{ marginTop: 20 }}>
        <RecurringTasksPanel embedded onClose={() => {}} />
      </div>
    </>
  );
}
