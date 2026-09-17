// GET /api/[fund]/pitches/[id]/files/[fileId] — redirect to a freshly signed
// URL for one pitch attachment.
//
// The pitch page could sign the URLs itself (and did), but a signed URL dies
// after an hour, which breaks an inline PDF viewer left open on a long
// meeting. This route is a stable address instead: the signature is minted
// per request, so the viewer's src never goes stale and no long-lived
// storage URL sits in the page source.
//
// Readability is RLS's call — the pitch and file rows are read through the
// user client, so a member who cannot see the pitch cannot see its deck.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import type { Pitch, PitchFile } from "@/types/domain";

const SIGNED_URL_TTL_SECONDS = 3600;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fund: string; id: string; fileId: string }> }
) {
  const { fund: slug, id, fileId } = await params;
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await getFundContext(slug);
  if (!ctx) return notFound;
  if (!z.uuid().safeParse(id).success) return notFound;
  if (!z.uuid().safeParse(fileId).success) return notFound;

  const { supabase, user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: pitchRow } = await supabase
    .from("pitches")
    .select("id")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!pitchRow) return notFound;

  const { data: fileRow } = await supabase
    .from("pitch_files")
    .select("storage_path, file_name")
    .eq("id", fileId)
    .eq("pitch_id", (pitchRow as Pick<Pitch, "id">).id)
    .maybeSingle();
  if (!fileRow) return notFound;

  const { data, error } = await supabase.storage
    .from("pitch-files")
    .createSignedUrl(
      (fileRow as Pick<PitchFile, "storage_path">).storage_path,
      SIGNED_URL_TTL_SECONDS
    );
  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "That file could not be opened right now" },
      { status: 502 }
    );
  }

  // 302, not 308: the target changes every request, so nothing should cache
  // the mapping.
  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
