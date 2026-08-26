"use client";

import type { RemoteCursor } from "@/hooks/usePresenceCursors";

interface CursorOverlayProps {
  cursors: Record<string, RemoteCursor>;
}

export default function CursorOverlay({ cursors }: CursorOverlayProps) {
  const list = Object.values(cursors);
  if (list.length === 0) return null;

  return (
    <div className="cursor-overlay" aria-hidden="true">
      {list.map((c) => (
        <div key={c.userId} className="remote-cursor" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}>
          <svg width="14" height="18" viewBox="0 0 14 18" fill={c.color}>
            <path d="M0 0 L14 7 L7.5 8.5 L10 16 L7 17 L4.5 9.5 L0 14 Z" />
          </svg>
          <span className="remote-cursor-label" style={{ background: c.color }}>
            {c.name}
          </span>
        </div>
      ))}
    </div>
  );
}
