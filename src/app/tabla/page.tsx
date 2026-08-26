"use client";

import dynamic from "next/dynamic";

const TableView = dynamic(() => import("@/components/TableView"), {
  ssr: false,
  loading: () => <p style={{ padding: 24, color: "var(--muted)" }}>Cargando…</p>,
});

export default function TablaPage() {
  return <TableView />;
}
