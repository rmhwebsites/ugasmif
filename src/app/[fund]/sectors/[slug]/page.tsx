// /[fund]/sectors/[slug] — sector workspace: team, holdings, weight vs
// target, pitch history, "New pitch" for members of the sector (SPEC 11.2).
//
// The top of the page answers the two questions people open it with: where
// the sector stands against its target, and what it is pitching next. The
// Pitches section shows every pitch still in motion (drafts included, as on
// the Pitches page) with the shortcut each one needs: Vote, Submit for the
// sector leader, Schedule for officers. Decided pitches show the latest few,
// and "All <Sector> pitches" opens the full list filtered to this sector.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import {
  can,
  canOpenAdminSection,
  inSector,
  isOfficer,
  roleLabel,
} from "@/lib/permissions";
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
import { Badge } from "@/components/ui/Badge";
import { ContributionBars } from "@/components/analysis/ContributionBars";
import { SectorWeights } from "@/components/analysis/SectorBreakdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton, ManageLink, PageHeader } from "@/components/ui/PageHeader";
import { TargetsNote, WeightTrio } from "../WeightTrio";
import {
  formatCurrencyWhole,
  formatDateTime,
  formatDay,
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
  VoteChoice,
} from "@/types/domain";

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name" | "email" | "avatar_url"> | null;
};

type SnapshotRow = Pick<FundSnapshot, "snapshot_date" | "detail">;

/** How many decided pitches the page lists before "All <Sector> pitches". */
const DECIDED_SHOWN = 3;

/** jsonb numbers arrive as numbers or numeric strings; anything else is a gap. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The sector row, shared by the tab title and the page in one request. */
const loadSector = cache(
  async (fundId: string, slug: string): Promise<Sector | null> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("sectors")
      .select("*")
      .eq("fund_id", fundId)
      .eq("slug", slug)
      .maybeSingle();
    return (data as Sector | null) ?? null;
  }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ fund: string; slug: string }>;
}): Promise<Metadata> {
  const { fund: fundSlug, slug } = await params;
  const ctx = await getFundContext(fundSlug);
  if (!ctx) return {};
  const sector = await loadSector(ctx.fund.id, slug);
  return sector ? { title: sector.name } : {};
}

export default async function SectorWorkspacePage({
  params,
}: {
  params: Promise<{ fund: string; slug: string }>;
}) {
  const { fund: fundSlug, slug } = await params;
  const ctx = await getFundContext(fundSlug);
  if (!ctx) notFound();

  const sector = await loadSector(ctx.fund.id, slug);
  if (!sector) notFound();

  const supabase = await createSupabaseServerClient();
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
      .select(
        "*, sector:sectors(name, slug), author:profiles!pitches_author_id_fkey(full_name)"
      )
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
  // Every pitch the fund can read, drafts included (RLS: fund access), so
  // this page and the Pitches page list the same things.
  const pitches = (pitchesRes.data as PitchListItem[]) ?? [];
  const sectorWeight = valuation.sectors.find((s) => s.sectorId === sector.id);
  const strategyTeamName =
    valuation.sectors.find((s) => s.isStrategyTeam)?.sectorName ?? null;
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
  const canSubmit = can(ctx, "submit_pitch", { sectorId: sector.id });
  const canSchedule = can(ctx, "schedule_pitch");
  const canVote = can(ctx, "cast_vote");
  const canSetTargets = can(ctx, "set_sector_targets");

  // Where each pitch stands. Votes close in order and class dates come in
  // order, so both lists put the soonest first; a scheduled pitch without a
  // date yet goes last.
  const voting = pitches
    .filter((p) => p.status === "voting")
    .sort((a, b) =>
      (a.vote_closes_at ?? "").localeCompare(b.vote_closes_at ?? "")
    );
  const scheduled = pitches
    .filter((p) => p.status === "scheduled")
    .sort((a, b) =>
      (a.scheduled_for ?? "9999").localeCompare(b.scheduled_for ?? "9999")
    );
  const submitted = pitches.filter((p) => p.status === "submitted");
  const drafts = pitches.filter((p) => p.status === "draft");
  const decided = pitches
    .filter((p) => ["passed", "failed", "executed"].includes(p.status))
    .sort((a, b) =>
      (b.closed_at ?? b.created_at).localeCompare(a.closed_at ?? a.created_at)
    );
  const nextVote = voting[0] ?? null;
  const nextScheduled = scheduled[0] ?? null;

  // The viewer's own ballots, for "You voted" and "Change vote" on the cards
  // (members read only their own votes under RLS), and which of the passed
  // pitches shown still have a trade ticket waiting to be executed.
  const votedIds = [...voting, ...decided].map((p) => p.id);
  const passedIds = decided
    .slice(0, DECIDED_SHOWN)
    .filter((p) => p.status === "passed")
    .map((p) => p.id);
  const [voteRes, ticketRes] = await Promise.all([
    votedIds.length > 0
      ? supabase
          .from("votes")
          .select("pitch_id, choice")
          .eq("voter_id", ctx.profile.id)
          .in("pitch_id", votedIds)
      : Promise.resolve({ data: null }),
    passedIds.length > 0
      ? supabase
          .from("trade_tickets")
          .select("pitch_id")
          .eq("status", "pending")
          .in("pitch_id", passedIds)
      : Promise.resolve({ data: null }),
  ]);
  const myVotes = new Map<string, VoteChoice>(
    (
      (voteRes.data as { pitch_id: string; choice: VoteChoice }[] | null) ?? []
    ).map((v) => [v.pitch_id, v.choice])
  );
  const tradePending = new Set(
    ((ticketRes.data as { pitch_id: string | null }[] | null) ?? []).map(
      (t) => t.pitch_id
    )
  );

  // The leader (or an officer) sees drafts as their own group, first, since
  // they are the ones who move them on. Everyone else sees drafts as part of
  // the way to a vote, as the Pitches page groups them.
  const pitchGroups = [
    { title: "Voting now", pitches: voting },
    ...(canSubmit
      ? [
          { title: "Drafts to submit", pitches: drafts },
          { title: "On the way to a vote", pitches: [...scheduled, ...submitted] },
        ]
      : [
          {
            title: "On the way to a vote",
            pitches: [...scheduled, ...submitted, ...drafts],
          },
        ]),
    { title: "Recently decided", pitches: decided.slice(0, DECIDED_SHOWN) },
  ].filter((g) => g.pitches.length > 0);
  const allPitchesHref = `/${ctx.fund.slug}/pitches?sector=${sector.slug}`;

  const weightPct = sectorWeight?.weightPct ?? 0;
  const targetPct = sectorWeight?.targetWeightPct ?? null;
  const benchmarkPct = sectorWeight?.benchmarkWeightPct ?? null;
  const overTarget = targetPct !== null ? weightPct - targetPct : null;

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

  const leaders = members.filter((m) => m.is_sector_leader);
  const analystCount = members.length - leaders.length;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        back={{ href: `/${ctx.fund.slug}/sectors`, label: "Sectors" }}
        title={sector.name}
        description={
          members.length === 0
            ? "No team assigned yet."
            : `${
                leaders.length > 0
                  ? `Led by ${leaders
                      .map((l) => l.profiles?.full_name ?? "Unnamed member")
                      .join(", ")}`
                  : "No leader assigned"
              } · ${analystCount} ${analystCount === 1 ? "analyst" : "analysts"}`
        }
        actions={
          <>
            {canOpenAdminSection(ctx, "sectors") && (
              <ManageLink href={`/${ctx.fund.slug}/admin/sectors#targets`}>
                Manage sectors
              </ManageLink>
            )}
            {canPitch && (
              <LinkButton
                href={`/${ctx.fund.slug}/pitches/new?sector=${sector.slug}`}
              >
                <Plus className="h-4 w-4" /> New pitch
              </LinkButton>
            )}
          </>
        }
      />

      {/* Where the sector stands, and what it pitches next */}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Weight in the fund</h2>
            {overTarget !== null && Math.abs(overTarget) >= 0.05 && (
              <Badge tone={overTarget > 0 ? "gain" : "loss"}>
                {overTarget > 0 ? "+" : ""}
                {overTarget.toFixed(1)}pp vs target
              </Badge>
            )}
          </div>
          <WeightTrio
            className="mt-3"
            weight={weightPct}
            target={targetPct}
            benchmark={benchmarkPct}
            showTargets={!sector.is_strategy_team}
          />
          <TargetsNote
            className="mt-3"
            fund={ctx.fund.slug}
            canSetTargets={canSetTargets}
            canDraft={can(ctx, "draft_pitch")}
            strategyTeamName={strategyTeamName}
            missing={targetPct === null || benchmarkPct === null}
            isStrategyTeam={sector.is_strategy_team}
          />
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              {nextVote ? "Voting now" : "Next pitch"}
            </h2>
            <Link
              href={allPitchesHref}
              className="text-sm font-medium text-accent-text hover:underline"
            >
              All {sector.name} pitches
            </Link>
          </div>
          {nextVote ? (
            <div className="mt-2">
              <p className="text-xl font-semibold tracking-tight">
                Closes {formatDateTime(nextVote.vote_closes_at)} ET
              </p>
              <Link
                href={`/${ctx.fund.slug}/pitches/${nextVote.id}${canVote ? "#vote" : ""}`}
                className="mt-0.5 inline-block text-sm hover:underline"
              >
                {nextVote.title}
              </Link>
            </div>
          ) : nextScheduled ? (
            <div className="mt-2">
              <p className="text-xl font-semibold tracking-tight">
                {nextScheduled.scheduled_for
                  ? formatDay(nextScheduled.scheduled_for)
                  : "Date to be set"}
              </p>
              <Link
                href={`/${ctx.fund.slug}/pitches/${nextScheduled.id}`}
                className="mt-0.5 inline-block text-sm hover:underline"
              >
                {nextScheduled.title}
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              No pitch on the calendar yet.
              {submitted.length > 0 &&
                ` ${submitted.length} submitted ${
                  submitted.length === 1 ? "pitch is" : "pitches are"
                } waiting for a class date.`}
            </p>
          )}
          {nextVote && nextScheduled && (
            <p className="mt-2 text-sm text-muted">
              Then{" "}
              <Link
                href={`/${ctx.fund.slug}/pitches/${nextScheduled.id}`}
                className="text-foreground hover:underline"
              >
                {nextScheduled.title}
              </Link>
              {nextScheduled.scheduled_for &&
                `, ${formatDay(nextScheduled.scheduled_for)}`}
            </p>
          )}
          {canSubmit && drafts.length > 0 && (
            <Link
              href="#pitches"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
            >
              {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}{" "}
              waiting for you to submit
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </Card>
      </div>

      {/* Team */}
      <section className="glass-card p-4 sm:p-6">
        <h2 className="mb-3 text-base font-semibold sm:text-lg">Team</h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted">
            Nobody is assigned to this sector yet.{" "}
            {canOpenAdminSection(ctx, "members") ? (
              <>
                Assign members on{" "}
                <Link
                  href={`/${ctx.fund.slug}/admin/members`}
                  className="font-medium text-accent-text hover:underline"
                >
                  Manage members
                </Link>
                .
              </>
            ) : (
              "An officer assigns members to sectors."
            )}
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
            scopeSectorId={sector.id}
            sectorSlugs={{ [sector.id]: sector.slug }}
          />
        )}
      </section>

      {/* Pitches */}
      <section id="pitches" className="scroll-mt-16 space-y-3 lg:scroll-mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-base font-semibold sm:text-lg">Pitches</h2>
          {pitchGroups.length > 0 && (
            <Link
              href={allPitchesHref}
              className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
            >
              All {sector.name} pitches
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
        {pitchGroups.length === 0 ? (
          <EmptyState
            title={pitches.length === 0 ? "No pitches yet" : "Nothing in progress"}
            hint={
              pitches.length > 0
                ? `Withdrawn pitches are listed under All ${sector.name} pitches.`
                : canPitch
                  ? "Start the sector's first pitch with the New pitch button."
                  : "Sector members start pitches from this page."
            }
            action={
              pitches.length > 0 ? (
                <Link
                  href={allPitchesHref}
                  className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
                >
                  All {sector.name} pitches
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : undefined
            }
          />
        ) : (
          pitchGroups.map((g) => (
            <div key={g.title} className="space-y-2">
              <h3 className="text-sm font-medium text-muted">
                {g.title}
                <span className="ml-1.5 tabular-nums">{g.pitches.length}</span>
              </h3>
              <div className="grid gap-3">
                {g.pitches.map((p) => (
                  <PitchCard
                    key={p.id}
                    pitch={p}
                    fund={ctx.fund.slug}
                    showSchedule={canSchedule}
                    showSubmit={canSubmit}
                    myVote={myVotes.get(p.id)}
                    canVote={canVote}
                    tradePending={tradePending.has(p.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
        {decided.length > DECIDED_SHOWN && (
          <p className="text-sm text-muted">
            Showing the latest {DECIDED_SHOWN} of {decided.length} decided
            pitches.
          </p>
        )}
      </section>

      {/* Breakdown */}
      {sectorHoldings.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-base font-semibold sm:text-lg">Breakdown</h2>
            <Link
              href={`/${ctx.fund.slug}/performance#sector-attribution`}
              className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
            >
              Sector attribution on Performance
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

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
            hint="This chart plots the sector's weight against its target and benchmark weight. It fills in after the nightly snapshot runs. Two nights of snapshots make the first line."
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
    </div>
  );
}
