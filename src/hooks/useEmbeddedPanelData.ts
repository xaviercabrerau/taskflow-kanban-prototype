"use client";

import { useEffect, useState, type DependencyList } from "react";

interface UseEmbeddedPanelDataOptions {
  skip?: boolean;
  errorMessage?: string;
}

/**
 * Encapsula el boilerplate de fetch (cancelled/loading/error) repetido en
 * los paneles embebibles de admin — antes cada uno reescribía la misma
 * lógica de `let cancelled = false` + `.then/.catch/.finally`. Ver
 * AUDITORIA_2026-09-03.md, hallazgo 13.
 */
export function useEmbeddedPanelData<T>(
  fetchFn: () => Promise<T>,
  deps: DependencyList,
  options?: UseEmbeddedPanelDataOptions
) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(!options?.skip);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (options?.skip) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFn()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        console.error(options?.errorMessage ?? "No se pudieron cargar los datos:", err);
        if (!cancelled) setError(options?.errorMessage ?? "No se pudieron cargar los datos.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps las controla el llamador
  }, deps);

  return { data, setData, loading, error, setError };
}
