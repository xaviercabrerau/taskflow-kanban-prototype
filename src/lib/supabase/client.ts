"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

// Cliente Supabase para Client Components (auth, lecturas/escrituras desde el navegador).
// Se apoya en las políticas RLS del proyecto "taskflow" para el aislamiento multi-tenant.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }
  return createBrowserClient<Database>(url, anonKey);
}
