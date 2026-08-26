"use client";

import dynamic from "next/dynamic";

const GanttView = dynamic(() => import("@/components/GanttView"), {
  ssr: false,
  loading: () => <p style={{ padding: 24, color: "var(--muted)" }}>Cargando…</p>,
});

export default function GanttPage() {
  return <GanttView />;
}
