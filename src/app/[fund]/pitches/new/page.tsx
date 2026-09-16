// /[fund]/pitches/new — pitch editor in create mode (SPEC Section 12).
// Server component gathers the option lists; the PitchEditor client island
// creates the draft and then redirects to the edit page where autosave and
// uploads take over.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can, isOfficer } from "@/lib/permissions";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  PitchEditor,
  type EditorHolding,
  type EditorPitchOption,
  type EditorSector,
} from "@/components/pitch/PitchEditor";

export default async function NewPitchPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!can(ctx, "draft_pitch")) {
    return (
      <EmptyState
        title="You can't draft pitches in this fund"
        hint={
          ctx.isFacultyAdvisor && !ctx.membership
            ? "The faculty advisor reads everything but pitches come from the sector teams."
            : "Viewers and alumni are read-only. If you should be pitching, ask an officer to update your role on the roster."
        }
        action={
          <Link
            href={`/${slug}/pitches`}
            className="text-sm font-medium text-accent hover:underline"
          >
            Back to pitches
          </Link>
        }
      />
    );
  }

  const { supabase } = await getAuthState();
  const [sectorsRes, holdingsRes, pitchesRes] = await Promise.all([
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
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/${slug}/pitches`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All pitches
        </Link>
        <h1 className="mt-1 text-xl font-bold sm:text-2xl">New pitch</h1>
        <p className="text-xs text-muted sm:text-sm">
          Fill in the basics, create the draft, then attach the deck and model.
          Your sector leader submits it when it&apos;s ready.
        </p>
      </div>

      <PitchEditor
        fund={slug}
        mode="create"
        sectors={(sectorsRes.data as EditorSector[] | null) ?? []}
        defaultSectorId={ctx.membership?.sector_id ?? null}
        canPickAnySector={isOfficer(ctx) || ctx.isAppAdmin}
        holdings={(holdingsRes.data as EditorHolding[] | null) ?? []}
        pitchOptions={(pitchesRes.data as EditorPitchOption[] | null) ?? []}
        isFixedIncome={ctx.fund.asset_class === "fixed_income"}
      />
    </div>
  );
}
