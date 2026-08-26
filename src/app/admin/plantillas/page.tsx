"use client";
import TemplateMarketplaceModal from "@/components/TemplateMarketplaceModal";

export default function AdminPlantillasPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Plantillas</div>
      <h1>Marketplace de plantillas</h1>
      <div style={{ marginTop: 20 }}>
        <TemplateMarketplaceModal embedded onClose={() => {}} />
      </div>
    </>
  );
}
