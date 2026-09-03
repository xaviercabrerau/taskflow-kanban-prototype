import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { revokeShareLink } from "@/lib/supabase/share-links-repo";

/**
 * DELETE /api/share-links/[id]
 * Revoca un link compartible (soft-delete vía revoked_at). RLS
 * (public_share_links_all) limita esto a miembros de la organización dueña.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await revokeShareLink(supabase, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
