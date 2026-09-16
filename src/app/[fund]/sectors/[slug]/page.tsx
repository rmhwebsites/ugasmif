// /[fund]/sectors/[slug] — sector workspace: team, holdings, weight vs
// target, pitch history, "New pitch" for members of the sector (SPEC 11.2).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import { can, inSector, isOfficer } from "@/lib/permissions";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { PitchCard, type PitchListItem } from "@/components/pitch/PitchCard";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatPercent } from "@/lib/format";
import type { Membership, Profile, Sector } from "@/types/domain";

export const metadata: Metadata = { title: "Sector" };

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name" | "email"> | null;
};

export default async function SectorWorkspacePage({
  params,
}: {
  params: Promise<{ fund: string; slug: string }>;
}) {
  const { fund: fundSlug, slug } = await params;
  const ctx = await getFundContext(fundSlug);
  if (!ctx) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: sectorRow } = await supabase
    .from("sectors")
    .select("*")
    .eq("fund_id", ctx.fund.id)
    .eq("slug", slug)
    .maybeSingle();
  const sector = sectorRow as Sector | null;
  if (!sector) notFound();

  const [valuation, membersRes, pitchesRes] = await Promise.all([
    valueFund(supabase, ctx.fund.id),
    supabase
      .from("memberships")
      .select("*, profiles(full_name, email)")
      .eq("fund_id", ctx.fund.id)
      .eq("academic_year_id", ctx.currentYear.id)
      .eq("sector_id", sector.id)
      .eq("status", "active")
      .order("is_sector_leader", { ascending: false }),
    supabase
      .from("pitches")
      .select("*, sector:sectors(name), author:profiles!pitches_author_id_fkey(full_name)")
      .eq("fund_id", ctx.fund.id)
      .eq("sector_id", sector.id)
      .order("created_at", { ascending: false }),
  ]);

  const members = (membersRes.data as MemberRow[]) ?? [];
  const pitches = (pitchesRes.data as PitchListItem[]) ?? [];
  const sectorWeight = valuation.sectors.find((s) => s.sectorId === sector.id);
  const sectorHoldings = valuation.holdings.filter(
    (h) => h.holding.sector_id === sector.id
  );
  const canPitch =
    can(ctx, "draft_pitch", { sectorId: sector.id }) &&
    (inSector(ctx, sector.id) || isOfficer(ctx) || ctx.isAppAdmin);
  const visiblePitches = pitches.filter(
    (p) =>
      p.status !== "draft" ||
      p.author_id === ctx.profile.id ||
      isOfficer(ctx)
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{sector.name}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {formatPercent(sectorWeight?.weightPct ?? 0)} of the fund
            {sectorWeight?.targetWeightPct !== null &&
              sectorWeight?.targetWeightPct !== undefined && (
                <> · target {formatPercent(sectorWeight.targetWeightPct)}</>
              )}
            {sectorWeight?.benchmarkWeightPct !== null &&
              sectorWeight?.benchmarkWeightPct !== undefined && (
                <> · benchmark {formatPercent(sectorWeight.benchmarkWeightPct)}</>
              )}
          </p>
        </div>
        {canPitch && (
          <Link
            href={`/${ctx.fund.slug}/pitches/new?sector=${sector.slug}`}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            New pitch
          </Link>
        )}
      </div>

      {/* Team */}
      <section className="glass-card p-4 sm:p-6">
        <h2 className="mb-3 text-base font-semibold sm:text-lg">Team</h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted">
            Nobody is assigned to this sector yet. Officers assign members on
            the roster page.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-lg bg-highlight px-3 py-2 text-sm"
              >
                <span>{m.profiles?.full_name ?? "—"}</span>
                {m.is_sector_leader && <Badge tone="accent">leader</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Holdings */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold sm:text-lg">Holdings</h2>
        {sectorHoldings.length === 0 ? (
          <EmptyState
            title="No holdings in this sector"
            hint="Positions appear here once the PM executes a trade in this sector."
          />
        ) : (
          <HoldingsTable
            holdings={sectorHoldings}
            fund={ctx.fund.slug}
            assetClass={ctx.fund.asset_class}
          />
        )}
      </section>

      {/* Pitches */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold sm:text-lg">Pitches</h2>
        {visiblePitches.length === 0 ? (
          <EmptyState
            title="No pitches yet"
            hint={
              canPitch
                ? "Start the sector's first pitch with the New pitch button."
                : "Sector members start pitches from this page."
            }
          />
        ) : (
          <div className="grid gap-3">
            {visiblePitches.map((p) => (
              <PitchCard key={p.id} pitch={p} fund={ctx.fund.slug} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
