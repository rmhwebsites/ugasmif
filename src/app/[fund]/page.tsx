// Fund dashboard (SPEC 11.2): totals, day change, cash, value-vs-benchmark
// chart, top/bottom movers, sector allocation, open-votes banner, next
// meeting, latest update. Arch adds weighted duration/YTM, allocation by
// instrument type, and the Treasury rates strip. Server component — data
// comes straight from valueFund() and user-scoped Supabase queries; the
// chart card is a client island that fetches /api/[fund]/portfolio/history.

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  Megaphone,
  Vote,
} from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { valueFund } from "@/lib/valuation";
import { timeWeightedReturns } from "@/lib/performance";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";
import { SectorBarChart } from "@/components/charts/SectorBarChart";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { RatesStrip } from "@/components/charts/RatesStrip";
import {
  easternDateString,
  formatCurrency,
  formatDate,
  formatDateTime,
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
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {h.holding.symbol ?? h.holding.name}
        </p>
        {h.holding.symbol && (
          <p className="truncate text-xs text-muted">{h.holding.name}</p>
        )}
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

  const { supabase } = await getAuthState();
  const fund = ctx.fund;
  const isFixedIncome = fund.asset_class === "fixed_income";

  const [v, snapshotsRes, flowsRes, votingRes, meetingRes, updateRes] =
    await Promise.all([
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
    ]);

  const snapshots = (snapshotsRes.data as FundSnapshot[] | null) ?? [];
  const flows = (flowsRes.data as CashMovement[] | null) ?? [];
  const votingPitches = (votingRes.data as VotingPitch[] | null) ?? [];
  const nextMeeting = ((meetingRes.data as Meeting[] | null) ?? [])[0] ?? null;
  const latestUpdate =
    ((updateRes.data as FundUpdate[] | null) ?? [])[0] ?? null;

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

  return (
    <div className="space-y-4">
      {votingPitches.length > 0 && (
        <div className="rounded-2xl border border-accent/30 bg-accent-soft p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <Vote className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-accent">
                {votingPitches.length === 1
                  ? "A vote is open"
                  : `${votingPitches.length} votes are open`}
              </p>
              <ul className="mt-1 space-y-0.5">
                {votingPitches.map((p) => (
                  <li key={p.id} className="text-sm">
                    <Link
                      href={`/${slug}/pitches/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.title}
                    </Link>{" "}
                    <span className="text-muted">
                      — closes {formatDateTime(p.vote_closes_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <Link
              href={`/${slug}/votes`}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Vote now
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{fund.name}</h1>
          <p className="text-xs text-muted sm:text-sm">
            As of {formatDateTime(v.asOf)} ET · Benchmark: {fund.benchmark_name}
          </p>
        </div>
        {v.anyStale && (
          <Badge
            tone="warn"
            title="Some prices are delayed or estimated — a live source was unavailable, so the latest saved values are shown."
          >
            <AlertTriangle className="h-3 w-3" /> Delayed
          </Badge>
        )}
      </div>

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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Today's movers"
            action={
              <Link
                href={`/${slug}/holdings`}
                className="text-xs font-medium text-accent hover:underline"
              >
                All holdings
              </Link>
            }
          />
          <div className="p-3 sm:p-4">
            {gainers.length === 0 && losers.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                {isFixedIncome
                  ? "Bond prices move with marks and the nightly snapshot — open Holdings for current prices and sources."
                  : "No live price moves yet. Check back during market hours, or add holdings under Fund Admin → Holdings."}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="px-2 pb-1 text-[11px] uppercase tracking-wider text-muted">
                    Top gainers
                  </p>
                  {gainers.length > 0 ? (
                    gainers.map((h) => (
                      <MoverRow key={h.holding.id} fund={slug} h={h} />
                    ))
                  ) : (
                    <p className="px-2 py-2 text-xs text-muted">
                      Nothing up today
                    </p>
                  )}
                </div>
                <div>
                  <p className="px-2 pb-1 text-[11px] uppercase tracking-wider text-muted">
                    Top losers
                  </p>
                  {losers.length > 0 ? (
                    losers.map((h) => (
                      <MoverRow key={h.holding.id} fund={slug} h={h} />
                    ))
                  ) : (
                    <p className="px-2 py-2 text-xs text-muted">
                      Nothing down today
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Sector allocation"
            action={
              <Link
                href={`/${slug}/sectors`}
                className="text-xs font-medium text-accent hover:underline"
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
                No sector data yet. Officers add sectors and set targets under
                Fund Admin → Sectors.
              </p>
            )}
          </div>
        </Card>
      </div>

      {isFixedIncome && (
        <Card>
          <CardHeader title="Allocation by instrument type" />
          <div className="p-4 sm:p-6">
            {donutData.length > 0 ? (
              <AllocationDonut data={donutData} fund={fund.slug} />
            ) : (
              <p className="py-8 text-center text-sm text-muted">
                No positions yet. The PM adds holdings under Fund Admin →
                Holdings.
              </p>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-accent" />
            <span className="text-[11px] uppercase tracking-wider text-muted sm:text-xs">
              Next meeting
            </span>
          </div>
          {nextMeeting ? (
            <div className="mt-2">
              <p className="font-semibold">
                {nextMeeting.title ?? "Fund meeting"}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {formatDate(nextMeeting.meeting_date)}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              No upcoming meeting on the calendar. Officers schedule meetings
              under Fund Admin → Attendance.
            </p>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-accent" />
              <span className="text-[11px] uppercase tracking-wider text-muted sm:text-xs">
                Latest update
              </span>
            </div>
            <Link
              href={`/${slug}/updates`}
              className="text-xs font-medium text-accent hover:underline"
            >
              All updates
            </Link>
          </div>
          {latestUpdate ? (
            <Link href={`/${slug}/updates`} className="mt-2 block">
              <p className="font-semibold hover:underline">
                {latestUpdate.title}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {formatDate(latestUpdate.published_at)}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">
                {latestUpdate.body_md.replace(/[#*_>`[\]]/g, "").slice(0, 160)}
              </p>
            </Link>
          ) : (
            <p className="mt-2 text-sm text-muted">
              No updates yet. Officers post the first one under Fund Admin →
              Updates.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
