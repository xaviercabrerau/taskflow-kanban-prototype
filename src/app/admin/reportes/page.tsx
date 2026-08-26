"use client";
import ReportsModal from "@/components/ReportsModal";

export default function AdminReportesPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Reportes</div>
      <h1>Reportes BI</h1>
      <div style={{ marginTop: 20 }}>
        <ReportsModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
