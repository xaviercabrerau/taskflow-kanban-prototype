"use client";

import dynamic from "next/dynamic";

const CalendarView = dynamic(() => import("@/components/CalendarView"), {
  ssr: false,
  loading: () => <p style={{ padding: 24, color: "var(--muted)" }}>Cargando…</p>,
});

export default function CalendarioPage() {
  return <CalendarView />;
}
