"use client";
import CustomFieldsModal from "@/components/CustomFieldsModal";

export default function AdminCustomFieldsPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Campos personalizados</div>
      <h1>Campos personalizados</h1>
      <div style={{ marginTop: 20 }}>
        <CustomFieldsModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
