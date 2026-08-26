"use client";

import dynamic from "next/dynamic";

const Board = dynamic(() => import("@/components/Board"), {
  ssr: false,
  loading: () => <p style={{ padding: 24, color: "var(--muted)" }}>Cargando…</p>,
});

export default function Home() {
  return <Board />;
}
