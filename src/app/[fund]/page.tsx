// Fund dashboard (SPEC 11.2). Read top to bottom it answers, in order: is
// there anything I need to do (open votes, and for officers tickets to place
// and pitches to schedule), how is the fund doing (totals, day change, cash,
// value against the benchmark), what moved and where the money sits (movers
// beside sector allocation, with the next meeting and latest update under
// the movers), and what we own (the largest positions; the full table lives
// on /[fund]/holdings). Arch adds weighted duration/YTM, allocation by
// instrument type, and the Treasury rates strip. Server component — data
// comes straight from valueFund() and user-scoped Supabase queries; the
// chart card is a client island that fetches /api/[fund]/portfolio/history.

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  Vote,
} from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can, canExecute } from "@/lib/permissions";
import { valueFund } from "@/lib/valuation";
import { timeWeightedReturns } from "@/lib/performance";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { SecurityLogo } from "@/components/holdings/SecurityLogo";
import { SectorBarChart } from "@/components/charts/SectorBarChart";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { RatesStrip } from "@/components/charts/RatesStrip";
import { AlumniNotice } from "@/components/ui/AlumniNotice";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  easternDateString,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDay,
  formatNumber,
  formatPercent,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/format";
import type {
  CashMovement,
  FundSnapshot,
  FundUpdate,
  HoldingValuation,
  Meeting,
  Pitch,
  VoteChoice,
} from "@/types/domain";

const INSTRUMENT_LABELS: Record<string, string> = {
  equity: "Equities",
  etf: "ETFs",
  treasury: "Treasuries",
  corporate: "Corporates",
  agency_mbs: "Agency MBS",
  municipal: "Municipals",
  money_market: "Money market",
};

type VotingPitch = Pick<Pitch, "id" | "title" | "vote_closes_at">;

/** One line in the "waiting on you" panel. */
function AttentionRow({
  icon,
  children,
  action,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <span className="shrink-0 text-accent">{icon}</span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {action}
    </li>
  );
}

const ATTENTION_ACTION =
  "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover";
const ATTENTION_ACTION_QUIET =
  "rounded-lg px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent-soft";

function MoverRow({
  fund,
  h,
}: {
  fund: string;
  h: HoldingValuation;
}) {
  const pct = h.dayChangePct ?? 0;
  return (
    <Link
      href={`/${fund}/holdings/${h.holding.id}`}
      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-highlight"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <SecurityLogo
          symbol={h.holding.symbol}
          name={h.holding.name}
          size="md"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {h.holding.symbol ?? h.holding.name}
          </p>
          {h.holding.symbol && (
            <p className="truncate text-xs text-muted">{h.holding.name}</p>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`text-sm font-medium tabular-nums ${
            pct >= 0 ? "text-gain" : "text-loss"
          }`}
        >
          {formatSignedPercent(pct)}
        </p>
        <p className="text-xs tabular-nums text-muted">
          {formatSignedCurrency(h.dayChange)}
        </p>
      </div>
    </Link>
  );
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const { supabase, user } = await getAuthState();
  const fund = ctx.fund;
  const isFixedIncome = fund.asset_class === "fixed_income";
  const mayVote = can(ctx, "cast_vote");
  const mayExecute = canExecute(ctx);
  const maySchedule = can(ctx, "schedule_pitch");

  const [
    v,
    snapshotsRes,
    flowsRes,
    votingRes,
    meetingRes,
    updateRes,
    ticketsRes,
    submittedRes,
  ] = await Promise.all([
    valueFund(supabase, fund.id),
    supabase
      .from("fund_snapshots")
      .select("*")
      .eq("fund_id", fund.id)
      .order("snapshot_date", { ascending: true }),
    supabase
      .from("cash_movements")
      .select("*")
      .eq("fund_id", fund.id)
      .in("kind", ["contribution", "withdrawal"]),
    supabase
      .from("pitches")
      .select("id, title, vote_closes_at")
      .eq("fund_id", fund.id)
      .eq("status", "voting")
      .order("vote_closes_at", { ascending: true }),
    supabase
      .from("meetings")
      .select("*")
      .eq("fund_id", fund.id)
      .gte("meeting_date", easternDateString())
      .order("meeting_date", { ascending: true })
      .limit(1),
    supabase
      .from("fund_updates")
      .select("*")
      .eq("fund_id", fund.id)
      .order("published_at", { ascending: false })
      .limit(1),
    mayExecute
      ? supabase
          .from("trade_tickets")
          .select("id", { count: "exact", head: true })
          .eq("fund_id", fund.id)
          .eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    maySchedule
      ? supabase
          .from("pitches")
          .select("id", { count: "exact", head: true })
          .eq("fund_id", fund.id)
          .eq("status", "submitted")
      : Promise.resolve({ count: 0 }),
  ]);

  const snapshots = (snapshotsRes.data as FundSnapshot[] | null) ?? [];
  const flows = (flowsRes.data as CashMovement[] | null) ?? [];
  const votingPitches = (votingRes.data as VotingPitch[] | null) ?? [];
  const nextMeeting = ((meetingRes.data as Meeting[] | null) ?? [])[0] ?? null;
  const latestUpdate =
    ((updateRes.data as FundUpdate[] | null) ?? [])[0] ?? null;
  const pendingTickets = ticketsRes.count ?? 0;
  const awaitingSchedule = submittedRes.count ?? 0;

  // The viewer's own ballots on the open votes.
  const myVotes = new Map<string, VoteChoice>();
  if (mayVote && user && votingPitches.length > 0) {
    const { data: voteRows } = await supabase
      .from("votes")
      .select("pitch_id, choice")
      .eq("voter_id", user.id)
      .in(
        "pitch_id",
        votingPitches.map((p) => p.id)
      );
    for (const r of (voteRows as { pitch_id: string; choice: VoteChoice }[] | null) ?? []) {
      myVotes.set(r.pitch_id, r.choice);
    }
  }
  const actionable =
    votingPitches.some((p) => mayVote && !myVotes.has(p.id)) ||
    pendingTickets > 0 ||
    awaitingSchedule > 0;
  const showAttention =
    votingPitches.length > 0 || pendingTickets > 0 || awaitingSchedule > 0;

  const ytd = timeWeightedReturns(snapshots, flows, ["YTD"])[0];

  // Top / bottom movers today: positions with a real intraday move — for the
  // equity fund that means equities and ETFs (money market sits at par).
  const moverPool = v.holdings.filter(
    (h) =>
      h.dayChangePct !== null &&
      h.dayChangePct !== 0 &&
      (isFixedIncome ||
        h.holding.instrument_type === "equity" ||
        h.holding.instrument_type === "etf")
  );
  const sortedDesc = [...moverPool].sort(
    (a, b) => (b.dayChangePct ?? 0) - (a.dayChangePct ?? 0)
  );
  const gainers = sortedDesc.filter((h) => (h.dayChangePct ?? 0) > 0).slice(0, 3);
  const gainerIds = new Set(gainers.map((g) => g.holding.id));
  const losers = [...sortedDesc]
    .reverse()
    .filter((h) => (h.dayChangePct ?? 0) < 0 && !gainerIds.has(h.holding.id))
    .slice(0, 3);

  const sectorData = v.sectors
    .filter(
      (s) =>
        s.weightPct > 0 || s.targetWeightPct !== null || s.benchmarkWeightPct !== null
    )
    .map((s) => ({
      name: s.sectorName,
      weight: s.weightPct,
      target: s.targetWeightPct,
      benchmark: s.benchmarkWeightPct,
    }));

  const donutData = Object.entries(v.byInstrumentType)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      name: INSTRUMENT_LABELS[key] ?? key,
      value,
    }));
  if (v.cash > 0) donutData.push({ name: "Cash", value: v.cash });

  const cashWeight = v.totalValue > 0 ? (v.cash / v.totalValue) * 100 : 0;

  // The dashboard shows the ten largest positions; /[fund]/holdings has the
  // full table with filters and export.
  const topHoldings = [...v.holdings]
    .sort((a, b) => b.weightPct - a.weightPct)
    .slice(0, 10);

  const allHoldingsLink = (
    <Link
      href={`/${slug}/holdings`}
      className="text-sm font-medium text-accent hover:underline"
    >
      {v.holdings.length > topHoldings.length
        ? `All ${v.holdings.length} holdings`
        : "All holdings"}
    </Link>
  );

  // Club news: always shown, alumni included.
  const clubCards = (
    <>
      <Card className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Next meeting</h2>
          <Link
            href={`/${slug}/attendance`}
            className="text-sm font-medium text-accent hover:underline"
          >
            Calendar
          </Link>
        </div>
        {nextMeeting ? (
          <div className="mt-2">
            <p className="text-xl font-semibold tracking-tight">
              {formatDay(nextMeeting.meeting_date)}
            </p>
            <p className="mt-0.5 text-sm">
              {(nextMeeting.title ?? "Fund meeting").replace(/\s+/g, " ")}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Nothing on the calendar yet. Officers add sessions under Fund admin
            → Meetings.
          </p>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Latest update</h2>
          <Link
            href={`/${slug}/updates`}
            className="text-sm font-medium text-accent hover:underline"
          >
            All updates
          </Link>
        </div>
        {latestUpdate ? (
          <Link href={`/${slug}/updates`} className="mt-2 block">
            <p className="font-semibold hover:underline">{latestUpdate.title}</p>
            <p className="mt-0.5 text-xs text-muted">
              {formatDate(latestUpdate.published_at)}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-muted">
              {latestUpdate.body_md.replace(/[#*_>`[\]]/g, "").slice(0, 160)}
            </p>
          </Link>
        ) : (
          <p className="mt-2 text-sm text-muted">
            No updates yet. Officers post them from the Updates page.
          </p>
        )}
      </Card>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={fund.name}
        description={
          ctx.canViewCurrent
            ? `As of ${formatDateTime(v.asOf)} ET · Benchmark: ${fund.benchmark_name}`
            : `Benchmark: ${fund.benchmark_name}`
        }
        actions={
          ctx.canViewCurrent && v.anyStale ? (
            <Badge
              tone="warn"
              title="Some prices are delayed or estimated. A live source was unavailable, so the latest saved values are shown."
            >
              <AlertTriangle className="h-3 w-3" /> Delayed
            </Badge>
          ) : undefined
        }
      />

      {showAttention && (
        <section className="rounded-2xl bg-accent-soft px-4 py-3 sm:px-5">
          <h2 className="pt-1 font-semibold">
            {actionable ? "Waiting on you" : "Open votes"}
          </h2>
          <ul className="divide-y divide-accent/15">
            {votingPitches.map((p) => {
              const mine = myVotes.get(p.id);
              return (
                <AttentionRow
                  key={p.id}
                  icon={
                    mine ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Vote className="h-4 w-4" />
                    )
                  }
                  action={
                    mayVote ? (
                      <Link
                        href={`/${slug}/pitches/${p.id}`}
                        className={mine ? ATTENTION_ACTION_QUIET : ATTENTION_ACTION}
                      >
                        {mine ? "Change vote" : "Vote"}
                      </Link>
                    ) : (
                      <Link
                        href={`/${slug}/pitches/${p.id}`}
                        className={ATTENTION_ACTION_QUIET}
                      >
                        Open
                      </Link>
                    )
                  }
                >
                  <Link
                    href={`/${slug}/pitches/${p.id}`}
                    className="font-medium hover:underline"
                  >
                    {p.title}
                  </Link>
                  <span className="text-muted">
                    {" "}
                    · closes {formatDateTime(p.vote_closes_at)} ET
                    {mine ? ` · you voted ${mine}` : ""}
                  </span>
                </AttentionRow>
              );
            })}
            {pendingTickets > 0 && (
              <AttentionRow
                icon={<ArrowLeftRight className="h-4 w-4" />}
                action={
                  <Link href={`/${slug}/trades`} className={ATTENTION_ACTION}>
                    Place
                  </Link>
                }
              >
                {pendingTickets === 1
                  ? "1 trade ticket is waiting to be placed"
                  : `${pendingTickets} trade tickets are waiting to be placed`}
              </AttentionRow>
            )}
            {awaitingSchedule > 0 && (
              <AttentionRow
                icon={<CalendarClock className="h-4 w-4" />}
                action={
                  <Link
                    href={`/${slug}/admin/pitches`}
                    className={ATTENTION_ACTION}
                  >
                    Schedule
                  </Link>
                }
              >
                {awaitingSchedule === 1
                  ? "1 pitch is waiting for a class date"
                  : `${awaitingSchedule} pitches are waiting for a class date`}
              </AttentionRow>
            )}
          </ul>
        </section>
      )}

      {/* The live book. An alumnus of a fund that keeps current data to
          active members gets the notice in its place (SPEC 11.3). */}
      {ctx.canViewCurrent ? (
        <>
          <div
            className={`grid grid-cols-2 gap-3 sm:gap-4 ${
              isFixedIncome ? "sm:grid-cols-3" : "sm:grid-cols-4"
            }`}
          >
            <StatCard
              label="Total value"
              value={formatCurrency(v.totalValue)}
              sub={`${v.holdings.length} holdings`}
            />
            <StatCard
              label="Day change"
              value={
                <span className={v.dayChange >= 0 ? "text-gain" : "text-loss"}>
                  {formatSignedCurrency(v.dayChange)}
                </span>
              }
              sub={`${formatSignedPercent(v.dayChangePct)} today`}
              subClassName={v.dayChange >= 0 ? "text-gain" : "text-loss"}
            />
            <StatCard
              label="Cash"
              value={formatCurrency(v.cash)}
              sub={`${formatPercent(cashWeight)} of fund`}
            />
            <StatCard
              label="YTD vs benchmark"
              value={
                ytd.diff !== null ? (
                  <span className={ytd.diff >= 0 ? "text-gain" : "text-loss"}>
                    {formatSignedPercent(ytd.diff)}
                  </span>
                ) : (
                  "—"
                )
              }
              sub={
                ytd.fund !== null
                  ? `Fund ${formatSignedPercent(ytd.fund)} · ${
                      fund.benchmark_name
                    } ${formatSignedPercent(ytd.benchmark)}`
                  : "Awaiting nightly snapshots"
              }
            />
            {isFixedIncome && (
              <>
                <StatCard
                  label="Weighted duration"
                  value={
                    v.weightedDuration !== null
                      ? `${formatNumber(v.weightedDuration, 1)} yrs`
                      : "—"
                  }
                  sub="Market-value weighted, bonds only"
                />
                <StatCard
                  label="Weighted YTM"
                  value={
                    v.weightedYtm !== null
                      ? formatPercent(v.weightedYtm, 2)
                      : "—"
                  }
                  sub="Market-value weighted, bonds only"
                />
              </>
            )}
          </div>

          <DashboardCharts
            fund={fund.slug}
            totalValue={v.totalValue}
            dayChange={v.dayChange}
            dayChangePct={v.dayChangePct}
            benchmarkName={fund.benchmark_name}
          />

          {isFixedIncome && <RatesStrip />}

          <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            {/* Left: what moved today, then the club's news. */}
            <div className="space-y-4">
              <Card>
                <CardHeader
                  title="Today's movers"
                  action={
                    <Link
                      href={`/${slug}/holdings`}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      All holdings
                    </Link>
                  }
                />
                <div className="p-3 sm:p-4">
                  {gainers.length === 0 && losers.length === 0 ? (
                    <p className="px-2 py-4 text-sm text-muted">
                      {isFixedIncome
                        ? "Bond prices move with marks and the nightly snapshot. Holdings has current prices and where each one comes from."
                        : "No live price moves yet. Check back during market hours."}
                    </p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                      <div>
                        <h3 className="px-2 pb-1 text-sm font-medium text-muted">
                          Up the most
                        </h3>
                        {gainers.length > 0 ? (
                          gainers.map((h) => (
                            <MoverRow key={h.holding.id} fund={slug} h={h} />
                          ))
                        ) : (
                          <p className="px-2 py-2 text-sm text-muted">
                            Nothing up today
                          </p>
                        )}
                      </div>
                      <div>
                        <h3 className="px-2 pb-1 text-sm font-medium text-muted">
                          Down the most
                        </h3>
                        {losers.length > 0 ? (
                          losers.map((h) => (
                            <MoverRow key={h.holding.id} fund={slug} h={h} />
                          ))
                        ) : (
                          <p className="px-2 py-2 text-sm text-muted">
                            Nothing down today
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
              {clubCards}
            </div>

            {/* Right: where the money sits. */}
            <div className="space-y-4">
              <Card>
                <CardHeader
                  title="Sector allocation"
                  action={
                    <Link
                      href={`/${slug}/sectors`}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      All sectors
                    </Link>
                  }
                />
                <div className="p-4 sm:p-6">
                  {sectorData.length > 0 ? (
                    <SectorBarChart data={sectorData} fund={fund.slug} />
                  ) : (
                    <p className="py-8 text-center text-sm text-muted">
                      No sector data yet. Officers add sectors and set targets
                      under Fund admin → Sectors.
                    </p>
                  )}
                </div>
              </Card>

              {isFixedIncome && (
                <Card>
                  <CardHeader title="Allocation by instrument type" />
                  <div className="p-4 sm:p-6">
                    {donutData.length > 0 ? (
                      <AllocationDonut data={donutData} fund={fund.slug} />
                    ) : (
                      <p className="py-8 text-center text-sm text-muted">
                        No positions yet. The PM adds holdings under Fund admin
                        → Holdings.
                      </p>
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>

          <Card className="overflow-hidden">
            <CardHeader title="Largest positions" action={allHoldingsLink} />
            {topHoldings.length > 0 ? (
              <HoldingsTable
                holdings={topHoldings}
                fund={fund.slug}
                assetClass={fund.asset_class}
                compact
              />
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted">
                No positions yet. The PM adds holdings under Fund admin →
                Holdings.
              </p>
            )}
          </Card>
        </>
      ) : (
        <>
          <AlumniNotice fundName={fund.name} />
          <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            {clubCards}
          </div>
        </>
      )}
    </div>
  );
}
