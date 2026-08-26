"use client";

import dynamic from "next/dynamic";

const DashboardView = dynamic(() => import("@/components/DashboardView"), {
  ssr: false,
  loading: () => <p style={{ padding: 24, color: "var(--muted)" }}>Cargando…</p>,
});

export default function DashboardPage() {
  return <DashboardView />;
}
