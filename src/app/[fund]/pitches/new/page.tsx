// /[fund]/pitches/new — pitch editor in create mode (SPEC Section 12).
// Server component gathers the option lists; the PitchEditor client island
// creates the draft and then redirects to the edit page where autosave and
// uploads take over. ?sector=<slug> (from a sector page's "New pitch")
// preselects that sector for anyone allowed to pitch for it, and
// ?action=rebalance starts a rebalance pitch.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can, isOfficer } from "@/lib/permissions";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  PitchEditor,
  type EditorHolding,
  type EditorPitchOption,
  type EditorSector,
} from "@/components/pitch/PitchEditor";
import type { PitchAction } from "@/types/domain";

export const metadata: Metadata = { title: "New pitch" };

const ACTIONS: PitchAction[] = ["buy", "add", "trim", "sell", "rebalance"];

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function NewPitchPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ fund: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const back = { href: `/${slug}/pitches`, label: "Pitches" };

  if (!can(ctx, "draft_pitch")) {
    return (
      <div className="space-y-4">
        <PageHeader back={back} title="New pitch" />
        <EmptyState
          title="You can't draft pitches in this fund"
          hint={
            ctx.isFacultyAdvisor && !ctx.membership
              ? "The faculty advisor reads everything but pitches come from the sector teams."
              : "Viewers and alumni are read-only. If you should be pitching, ask an officer to update your role."
          }
          action={
            <Link
              href={`/${slug}/pitches`}
              className="text-sm font-medium text-accent-text hover:underline"
            >
              Back to pitches
            </Link>
          }
        />
      </div>
    );
  }

  const { supabase } = await getAuthState();
  const [sectorsRes, holdingsRes, pitchesRes] = await Promise.all([
    supabase
      .from("sectors")
      .select("id, name, slug")
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
  const sectors =
    (sectorsRes.data as (EditorSector & { slug: string })[] | null) ?? [];

  // The sector you started from, when you may pitch for it. Members are
  // pinned to their own sector, so for them a different one is ignored.
  const canPickAnySector = isOfficer(ctx) || ctx.isAppAdmin;
  const ownSectorId = ctx.membership?.sector_id ?? null;
  const fromSector = sectors.find((s) => s.slug === first(sp.sector)) ?? null;
  const defaultSectorId =
    fromSector && (canPickAnySector || fromSector.id === ownSectorId)
      ? fromSector.id
      : ownSectorId;

  const actionQ = first(sp.action) as PitchAction;
  const defaultAction = ACTIONS.includes(actionQ) ? actionQ : undefined;

  // Who takes the draft to a class date: the viewer, if they may submit
  // for the sector it goes in under, or else their sector leader.
  const submitsOwn = can(ctx, "submit_pitch", {
    sectorId: defaultSectorId ?? undefined,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        back={back}
        title="New pitch"
        description={
          submitsOwn
            ? "Fill in the basics, create the draft, then attach the deck and model. You submit it for a class date when it's ready."
            : "Fill in the basics, create the draft, then attach the deck and model. Your sector leader submits it for a class date when it's ready."
        }
      />

      <PitchEditor
        fund={slug}
        mode="create"
        sectors={sectors.map(({ id, name }) => ({ id, name }))}
        defaultSectorId={defaultSectorId}
        defaultAction={defaultAction}
        canPickAnySector={canPickAnySector}
        canSetTargets={can(ctx, "set_sector_targets")}
        holdings={(holdingsRes.data as EditorHolding[] | null) ?? []}
        pitchOptions={(pitchesRes.data as EditorPitchOption[] | null) ?? []}
        isFixedIncome={ctx.fund.asset_class === "fixed_income"}
      />
    </div>
  );
}
