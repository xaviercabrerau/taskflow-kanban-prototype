"use client";
import RolesModal from "@/components/RolesModal";

export default function AdminRolesPage() {
  return (
    <>
      <div className="admin-breadcrumb">Organización / Roles y permisos</div>
      <h1>Roles y permisos</h1>
      <div style={{ marginTop: 20 }}>
        <RolesModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
