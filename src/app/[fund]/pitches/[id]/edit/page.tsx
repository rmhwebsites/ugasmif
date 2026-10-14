// /[fund]/pitches/[id]/edit — pitch editor in edit mode with autosave and
// file uploads (SPEC Section 12). Editable by the author while draft, the
// sector leader through submitted, and officers until voting opens; anyone
// else lands back on the pitch page. Whoever may submit the draft gets
// "Submit for scheduling" right in the editor.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can, isOfficer, leadsSector } from "@/lib/permissions";
import { PitchStatusBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  PitchEditor,
  type EditorHolding,
  type EditorPitchOption,
  type EditorSector,
} from "@/components/pitch/PitchEditor";
import type { PitchFile } from "@/types/domain";
import { isPitchId, loadPitch } from "../load-pitch";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}): Promise<Metadata> {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) return {};
  const pitch = await loadPitch(ctx.fund.id, id);
  return pitch ? { title: `Edit ${pitch.title}` } : {};
}

export default async function EditPitchPage({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!isPitchId(id)) notFound();

  const { supabase, user } = await getAuthState();
  const pitch = await loadPitch(ctx.fund.id, id);
  if (!pitch) notFound();

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
      <PageHeader
        back={{ href: `/${slug}/pitches/${id}`, label: pitch.title }}
        title="Edit pitch"
        description={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <PitchStatusBadge status={pitch.status} />
            Changes save a few seconds after you stop typing.
          </span>
        }
      />

      <PitchEditor
        fund={slug}
        mode="edit"
        pitch={pitch}
        files={(filesRes.data as PitchFile[] | null) ?? []}
        sectors={(sectorsRes.data as EditorSector[] | null) ?? []}
        defaultSectorId={pitch.sector_id}
        canPickAnySector={isOfficer(ctx) || ctx.isAppAdmin}
        canSubmit={
          pitch.status === "draft" &&
          can(ctx, "submit_pitch", { sectorId: pitch.sector_id })
        }
        canSetTargets={can(ctx, "set_sector_targets")}
        holdings={(holdingsRes.data as EditorHolding[] | null) ?? []}
        pitchOptions={(pitchesRes.data as EditorPitchOption[] | null) ?? []}
        isFixedIncome={ctx.fund.asset_class === "fixed_income"}
      />
    </div>
  );
}
