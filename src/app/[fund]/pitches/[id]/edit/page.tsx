// /[fund]/pitches/[id]/edit — pitch editor in edit mode with autosave and
// file uploads (SPEC Section 12). Editable by the author while draft, the
// sector leader through submitted, and officers until voting opens; anyone
// else lands back on the pitch page.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { isOfficer, leadsSector } from "@/lib/permissions";
import { PitchStatusBadge } from "@/components/ui/Badge";
import {
  PitchEditor,
  type EditorHolding,
  type EditorPitchOption,
  type EditorSector,
} from "@/components/pitch/PitchEditor";
import type { Pitch, PitchFile } from "@/types/domain";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditPitchPage({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!UUID_RE.test(id)) notFound();

  const { supabase, user } = await getAuthState();
  const { data: pitchRow } = await supabase
    .from("pitches")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!pitchRow) notFound();
  const pitch = pitchRow as Pitch;

  const editable = isOfficer(ctx)
    ? ["draft", "submitted", "scheduled"].includes(pitch.status)
    : leadsSector(ctx, pitch.sector_id)
      ? ["draft", "submitted"].includes(pitch.status)
      : pitch.author_id === user?.id && pitch.status === "draft";
  if (!editable) redirect(`/${slug}/pitches/${id}`);

  const [sectorsRes, holdingsRes, pitchesRes, filesRes] = await Promise.all([
    supabase
      .from("sectors")
      .select("id, name")
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("holdings")
      .select("id, name, symbol")
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("pitches")
      .select("id, title")
      .eq("fund_id", ctx.fund.id)
      .neq("id", pitch.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("pitch_files")
      .select("*")
      .eq("pitch_id", pitch.id)
      .order("created_at"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/${slug}/pitches/${id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Pitch page
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold sm:text-2xl">Edit pitch</h1>
          <PitchStatusBadge status={pitch.status} />
        </div>
        <p className="text-xs text-muted sm:text-sm">
          Changes autosave a few seconds after you stop typing.
        </p>
      </div>

      <PitchEditor
        fund={slug}
        mode="edit"
        pitch={pitch}
        files={(filesRes.data as PitchFile[] | null) ?? []}
        sectors={(sectorsRes.data as EditorSector[] | null) ?? []}
        defaultSectorId={pitch.sector_id}
        canPickAnySector={isOfficer(ctx) || ctx.isAppAdmin}
        holdings={(holdingsRes.data as EditorHolding[] | null) ?? []}
        pitchOptions={(pitchesRes.data as EditorPitchOption[] | null) ?? []}
        isFixedIncome={ctx.fund.asset_class === "fixed_income"}
      />
    </div>
  );
}
