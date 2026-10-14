// One pitch with its sector and author, read once per request. The pitch
// page, its edit page and both browser-tab titles all ask for it, and
// cache() keeps that to a single query. RLS decides what comes back.

import { cache } from "react";
import { getAuthState } from "@/lib/fund";
import type { Pitch } from "@/types/domain";

export interface PitchDetail extends Pitch {
  sector: { name: string; slug: string } | null;
  author: { full_name: string } | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPitchId(id: string): boolean {
  return UUID_RE.test(id);
}

export const loadPitch = cache(
  async (fundId: string, id: string): Promise<PitchDetail | null> => {
    if (!isPitchId(id)) return null;
    const { supabase } = await getAuthState();
    const { data } = await supabase
      .from("pitches")
      .select(
        "*, sector:sectors(name, slug), author:profiles!author_id(full_name)"
      )
      .eq("id", id)
      .eq("fund_id", fundId)
      .maybeSingle();
    return (data as unknown as PitchDetail | null) ?? null;
  }
);
