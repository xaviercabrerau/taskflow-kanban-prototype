"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

interface PresencePayload {
  name: string;
  color: string;
  x: number;
  y: number;
}

const CURSOR_COLORS = ["#6E56CF", "#C2255C", "#2F9E44", "#E8590C", "#1971C2", "#AE3EC9"];
const PUBLISH_THROTTLE_MS = 60;

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

// Presencia de cursores en vivo sobre un board, vía Supabase Realtime
// Presence (efímero, no persiste en Postgres). Cada cliente publica su
// posición relativa (0..1) al contenedor; el resto la recibe por el evento
// "sync" del canal.
export function usePresenceCursors(
  supabase: SupabaseClient<Database>,
  boardId: string | null,
  userId: string | null,
  name: string
) {
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const lastPublishRef = useRef(0);

  useEffect(() => {
    if (!boardId || !userId) return;
    subscribedRef.current = false;

    const channel = supabase.channel(`board-presence:${boardId}`, {
      config: { presence: { key: userId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresencePayload>();
      const next: Record<string, RemoteCursor> = {};
      for (const [key, presences] of Object.entries(state)) {
        if (key === userId) continue;
        const p = presences[presences.length - 1];
        if (!p) continue;
        next[key] = { userId: key, name: p.name, color: p.color, x: p.x, y: p.y };
      }
      setCursors(next);
    });

    channel.subscribe((status) => {
      subscribedRef.current = status === "SUBSCRIBED";
    });

    channelRef.current = channel;

    return () => {
      subscribedRef.current = false;
      supabase.removeChannel(channel);
      channelRef.current = null;
      setCursors({});
    };
  }, [supabase, boardId, userId]);

  const publish = useCallback(
    (x: number, y: number) => {
      if (!subscribedRef.current || !channelRef.current || !userId) return;
      const now = Date.now();
      if (now - lastPublishRef.current < PUBLISH_THROTTLE_MS) return;
      lastPublishRef.current = now;
      channelRef.current.track({ name, color: colorForUser(userId), x, y } satisfies PresencePayload);
    },
    [name, userId]
  );

  const clear = useCallback(() => {
    if (subscribedRef.current) channelRef.current?.untrack();
  }, []);

  return { cursors, publish, clear };
}
