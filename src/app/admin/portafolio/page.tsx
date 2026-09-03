"use client";
import PortfolioPanel from "@/components/PortfolioPanel";

export default function AdminPortfolioPage() {
  return (
    <>
      <div className="admin-breadcrumb">Producto / Portafolio</div>
      <h1>Portafolio de tableros</h1>
      <div style={{ marginTop: 20 }}>
        <PortfolioPanel embedded onClose={() => {}} />
      </div>
    </>
  );
}
