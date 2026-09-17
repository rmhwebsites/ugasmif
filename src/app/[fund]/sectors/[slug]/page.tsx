// /[fund]/sectors/[slug] — sector workspace: team, holdings, weight vs
// target, pitch history, "New pitch" for members of the sector (SPEC 11.2).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import { can, inSector, isOfficer, roleLabel } from "@/lib/permissions";
import {
  groupStats,
  positionContributions,
  weightsWithinGroup,
} from "@/lib/analysis";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { ValueChart } from "@/components/charts/ValueChart";
import { PitchCard, type PitchListItem } from "@/components/pitch/PitchCard";
import { MemberCarousel } from "@/components/team/MemberCarousel";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { ContributionBars } from "@/components/analysis/ContributionBars";
import { SectorWeights } from "@/components/analysis/SectorBreakdown";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  formatCurrencyWhole,
  formatPercent,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/format";
import type {
  ChartPoint,
  FundSnapshot,
  FundSnapshotDetail,
  Membership,
  Profile,
  Sector,
} from "@/types/domain";

export const metadata: Metadata = { title: "Sector" };

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name" | "email" | "avatar_url"> | null;
};

type SnapshotRow = Pick<FundSnapshot, "snapshot_date" | "detail">;

/** jsonb numbers arrive as numbers or numeric strings; anything else is a gap. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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

  const [valuation, membersRes, pitchesRes, snapshotsRes] = await Promise.all([
    valueFund(supabase, ctx.fund.id),
    supabase
      .from("memberships")
      .select("*, profiles(full_name, email, avatar_url)")
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
    supabase
      .from("fund_snapshots")
      .select("snapshot_date, detail")
      .eq("fund_id", ctx.fund.id)
      .order("snapshot_date", { ascending: true }),
  ]);

  const members = (membersRes.data as MemberRow[]) ?? [];
  const pitches = (pitchesRes.data as PitchListItem[]) ?? [];
  const sectorWeight = valuation.sectors.find((s) => s.sectorId === sector.id);
  const sectorHoldings = valuation.holdings.filter(
    (h) => h.holding.sector_id === sector.id
  );
  // What the sector's weight is actually made of, and which of its positions
  // are carrying it. Both come from the live valuation, so they work before
  // the first nightly snapshot exists.
  const stats = groupStats(sectorHoldings);
  const withinSector = weightsWithinGroup(sectorHoldings);
  const sectorContributions = positionContributions(sectorHoldings);

  const canPitch =
    can(ctx, "draft_pitch", { sectorId: sector.id }) &&
    (inSector(ctx, sector.id) || isOfficer(ctx) || ctx.isAppAdmin);
  const visiblePitches = pitches.filter(
    (p) =>
      p.status !== "draft" ||
      p.author_id === ctx.profile.id ||
      isOfficer(ctx)
  );

  // Weight vs target/benchmark over time: the nightly snapshot records every
  // sector's weight, target and benchmark weight in its detail jsonb, so the
  // history is a scan of fund_snapshots rather than a recomputation.
  const snapshots = (snapshotsRes.data as SnapshotRow[]) ?? [];
  const weightPoints: ChartPoint[] = [];
  const targetPoints: ChartPoint[] = [];
  const benchmarkPoints: ChartPoint[] = [];
  for (const snap of snapshots) {
    const detail = snap.detail as FundSnapshotDetail;
    const row = Array.isArray(detail.sectors)
      ? detail.sectors.find((s) => s.sectorId === sector.id)
      : undefined;
    const weight = row ? toNumber(row.weightPct) : null;
    if (!row || weight === null) continue;
    weightPoints.push({ time: snap.snapshot_date, value: weight });
    const target = toNumber(row.targetWeightPct);
    if (target !== null) {
      targetPoints.push({ time: snap.snapshot_date, value: target });
    }
    const benchmark = toNumber(row.benchmarkWeightPct);
    if (benchmark !== null) {
      benchmarkPoints.push({ time: snap.snapshot_date, value: benchmark });
    }
  }
  // ValueChart draws one overlay line, so the target gets it and the benchmark
  // weight reads as a number under the chart — unless no target was ever set,
  // in which case the benchmark is the only reference worth drawing.
  const referenceLine = targetPoints.length > 0 ? targetPoints : benchmarkPoints;
  const referenceLabel = targetPoints.length > 0 ? "target" : "benchmark";
  const latestBenchmarkWeight =
    benchmarkPoints.length > 0
      ? benchmarkPoints[benchmarkPoints.length - 1].value
      : null;
  const weightTrendUp =
    weightPoints.length > 1 &&
    weightPoints[weightPoints.length - 1].value >= weightPoints[0].value;

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
          <MemberCarousel
            members={members.map((m) => ({
              id: m.id,
              name: m.profiles?.full_name ?? "Unnamed member",
              role: roleLabel(m.role, m.title_override),
              avatarUrl: m.profiles?.avatar_url ?? null,
              isLeader: m.is_sector_leader,
            }))}
            label={`${sector.name} team`}
          />
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

      {/* Breakdown */}
      {sectorHoldings.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold sm:text-lg">Breakdown</h2>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <StatCard
              label="Sector value"
              value={formatCurrencyWhole(stats.marketValue)}
              sub={`${stats.positions} position${stats.positions === 1 ? "" : "s"}`}
            />
            <StatCard
              label="Unrealized gain"
              value={
                <span className={stats.unrealizedGain >= 0 ? "text-gain" : "text-loss"}>
                  {formatSignedCurrency(stats.unrealizedGain)}
                </span>
              }
              sub={
                stats.returnPct === null
                  ? "No cost basis"
                  : `${formatSignedPercent(stats.returnPct)} on cost`
              }
            />
            <StatCard
              label="Day change"
              value={
                stats.dayChange === null ? (
                  "—"
                ) : (
                  <span className={stats.dayChange >= 0 ? "text-gain" : "text-loss"}>
                    {formatSignedCurrency(stats.dayChange)}
                  </span>
                )
              }
              sub={stats.dayChange === null ? "Nothing priced today" : "Across the sector"}
            />
            <StatCard
              label="Largest position"
              value={stats.topLabel ?? "—"}
              sub={
                stats.topWeightPct === null
                  ? ""
                  : `${formatPercent(stats.topWeightPct)} of the sector`
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="overflow-hidden">
              <CardHeader
                title="Weight within the sector"
                action={<span className="text-xs text-muted">Live valuation</span>}
              />
              <SectorWeights rows={withinSector} fund={ctx.fund.slug} />
            </Card>
            <Card className="overflow-hidden">
              <CardHeader
                title="Contribution to unrealized gain"
                action={<span className="text-xs text-muted">Biggest movers first</span>}
              />
              <ContributionBars
                rows={sectorContributions}
                fund={ctx.fund.slug}
                limit={6}
              />
            </Card>
          </div>
        </section>
      )}

      {/* Weight vs target / benchmark over time */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold sm:text-lg">Weight over time</h2>
        {weightPoints.length < 2 ? (
          <EmptyState
            title="No weight history yet"
            hint="This chart plots the sector's weight against its target and benchmark weight. It fills in after the nightly snapshot runs — two nights of snapshots make the first line."
          />
        ) : (
          <div className="glass-card overflow-hidden py-3">
            <ValueChart
              data={weightPoints}
              benchmark={referenceLine.length > 0 ? referenceLine : undefined}
              isPositive={weightTrendUp}
              fund={ctx.fund.slug}
              height={200}
              showPriceScale
            />
            <p className="px-4 pt-2 text-xs text-muted sm:px-6">
              Shaded area: the sector&apos;s weight in the fund, one point per
              nightly snapshot.
              {referenceLine.length > 0 && ` Grey line: ${referenceLabel} weight.`}
              {referenceLabel === "target" && latestBenchmarkWeight !== null && (
                <> Benchmark weight is {formatPercent(latestBenchmarkWeight)}.</>
              )}
            </p>
          </div>
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
