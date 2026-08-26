"use client";
import MfaSettingsModal from "@/components/MfaSettingsModal";
import SsoSettingsModal from "@/components/SsoSettingsModal";

export default function AdminSeguridadPage() {
  return (
    <>
      <div className="admin-breadcrumb">Seguridad / Seguridad y acceso</div>
      <h1>Seguridad y acceso</h1>
      <div className="admin-panel-stack" style={{ marginTop: 20 }}>
        <MfaSettingsModal embedded onClose={() => {}} />
        <SsoSettingsModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
