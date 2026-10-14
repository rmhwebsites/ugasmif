// Fund dashboard (SPEC 11.2). Read top to bottom it answers, in order: is
// there anything I need to do (open votes, a sector leader's drafts, and for
// officers the same to-dos as the Fund admin checklist, which the strip
// links to), how is the fund doing (totals, day change, cash, value against
// the benchmark), what moved and where the money sits (movers beside sector
// allocation, with the next meeting and latest update under the movers),
// and what we own (the largest positions; the full table lives on
// /[fund]/holdings). Arch adds weighted duration/YTM, allocation by
// instrument type, and the Treasury rates strip. Every summary links on to
// the page it summarises. Server component: data comes straight from
// valueFund() and user-scoped Supabase queries; the chart card is a client
// island that fetches /api/[fund]/portfolio/history.

import { Fragment } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FilePen,
  Vote,
} from "lucide-react";
import { getAuthState, getFundContext, isFundSlug } from "@/lib/fund";
import { FUND_SHORT_NAMES } from "@/components/layout/fundNav";
import {
  can,
  canExecute,
  canOpenAdminSection,
  hasFundAdminAccess,
  leadsSector,
} from "@/lib/permissions";
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
  TradeTicket,
  VoteChoice,
} from "@/types/domain";

// The fund layout's title template only reaches pages below it, not this
// one in its own segment, so the dashboard names its fund itself. The root
// template adds " · SMIF Hub": "Dashboard · Athena · SMIF Hub".
export async function generateMetadata({
  params,
}: {
  params: Promise<{ fund: string }>;
}): Promise<Metadata> {
  const { fund } = await params;
  return isFundSlug(fund)
    ? { title: `Dashboard · ${FUND_SHORT_NAMES[fund]}` }
    : {};
}

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
type AgendaPitch = Pick<Pitch, "id" | "title" | "status" | "scheduled_for">;
type DraftPitch = Pick<Pitch, "id" | "title">;
type TicketRow = Pick<TradeTicket, "id" | "action" | "symbol" | "name">;
// Never the notes column: officers keep internal notes there.
type MeetingRow = Pick<Meeting, "id" | "meeting_date" | "title">;

/** Imported titles carry stray double spaces ("Speaker:  David Braun"). */
function tidy(title: string | null): string {
  return title ? title.replace(/\s+/g, " ").trim() : "Fund meeting";
}

/** "closes today at 5:00 PM ET", or the full date when it isn't today. */
function closesLabel(iso: string | null, today: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (easternDateString(d) === today) {
    const time = d.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });
    return `closes today at ${time} ET`;
  }
  return `closes ${formatDateTime(iso)} ET`;
}

/** "1 ticket" / "3 tickets", for the counted rows in the strip. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const TEXT_LINK = "font-medium text-accent-text hover:underline";
/** A card's "All …" link: 40px tall to tap on a phone, same layout. */
const HEADER_LINK =
  "-my-2.5 py-2.5 text-sm font-medium text-accent-text hover:underline sm:my-0 sm:py-0";

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
      <span className="shrink-0 text-accent-text">{icon}</span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {action}
    </li>
  );
}

const ATTENTION_ACTION =
  "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover";
const ATTENTION_ACTION_QUIET =
  "rounded-lg px-3 py-1.5 text-sm font-medium text-accent-text transition-colors hover:bg-accent-soft";

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
  const today = easternDateString();
  const mayVote = can(ctx, "cast_vote");
  const mayExecute = canExecute(ctx);
  const maySchedule = can(ctx, "schedule_pitch");
  const adminAccess = hasFundAdminAccess(ctx);
  const takesAttendance = canOpenAdminSection(ctx, "attendance");
  // Officers who don't trade still see what is waiting on the PM, as on the
  // checklist.
  const seesTickets = mayExecute || adminAccess;
  // A sector leader moves their analysts' drafts on: only they (or an
  // officer) can submit one for a class date.
  const ledSector =
    ctx.sector && leadsSector(ctx, ctx.sector.id) ? ctx.sector : null;

  const [
    v,
    snapshotsRes,
    flowsRes,
    votingRes,
    meetingRes,
    updateRes,
    ticketsRes,
    submittedRes,
    agendaRes,
    draftsRes,
    lastMeetingRes,
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
    // Two, so an officer can be told when nothing follows today's meeting.
    supabase
      .from("meetings")
      .select("id, meeting_date, title")
      .eq("fund_id", fund.id)
      .gte("meeting_date", today)
      .order("meeting_date", { ascending: true })
      .limit(2),
    supabase
      .from("fund_updates")
      .select("*")
      .eq("fund_id", fund.id)
      .order("published_at", { ascending: false })
      .limit(1),
    seesTickets
      ? supabase
          .from("trade_tickets")
          .select("id, action, symbol, name")
          .eq("fund_id", fund.id)
          .eq("status", "pending")
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as TicketRow[] }),
    maySchedule
      ? supabase
          .from("pitches")
          .select("id", { count: "exact", head: true })
          .eq("fund_id", fund.id)
          .eq("status", "submitted")
      : Promise.resolve({ count: 0 }),
    // What is on the next meeting: pitches given that class date.
    supabase
      .from("pitches")
      .select("id, title, status, scheduled_for")
      .eq("fund_id", fund.id)
      .gte("scheduled_for", today)
      .in("status", ["scheduled", "voting", "passed", "failed", "executed"])
      .order("created_at", { ascending: true }),
    ledSector
      ? supabase
          .from("pitches")
          .select("id, title")
          .eq("fund_id", fund.id)
          .eq("sector_id", ledSector.id)
          .eq("status", "draft")
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] as DraftPitch[] }),
    // The latest meeting this year on or before today: the one whose
    // attendance should be in by now (the checklist asks the same).
    takesAttendance
      ? supabase
          .from("meetings")
          .select("id, meeting_date, title")
          .eq("fund_id", fund.id)
          .gte("meeting_date", ctx.currentYear.starts_on)
          .lte("meeting_date", today)
          .order("meeting_date", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] as MeetingRow[] }),
  ]);

  const snapshots = (snapshotsRes.data as FundSnapshot[] | null) ?? [];
  const flows = (flowsRes.data as CashMovement[] | null) ?? [];
  const votingPitches = (votingRes.data as VotingPitch[] | null) ?? [];
  const upcomingMeetings = (meetingRes.data as MeetingRow[] | null) ?? [];
  const nextMeeting = upcomingMeetings[0] ?? null;
  const latestUpdate =
    ((updateRes.data as FundUpdate[] | null) ?? [])[0] ?? null;
  const tickets = (ticketsRes.data as TicketRow[] | null) ?? [];
  const awaitingSchedule = submittedRes.count ?? 0;
  const agenda = nextMeeting
    ? ((agendaRes.data as AgendaPitch[] | null) ?? []).filter(
        (p) => p.scheduled_for === nextMeeting.meeting_date
      )
    : [];
  const drafts = (draftsRes.data as DraftPitch[] | null) ?? [];
  const lastMeeting =
    ((lastMeetingRes.data as MeetingRow[] | null) ?? [])[0] ?? null;

  // The viewer's own ballots on the open votes, and whether anyone has
  // taken attendance for the latest meeting.
  const myVotes = new Map<string, VoteChoice>();
  const [voteRowsRes, attendanceRes] = await Promise.all([
    mayVote && user && votingPitches.length > 0
      ? supabase
          .from("votes")
          .select("pitch_id, choice")
          .eq("voter_id", user.id)
          .in(
            "pitch_id",
            votingPitches.map((p) => p.id)
          )
      : Promise.resolve({ data: [] }),
    lastMeeting
      ? supabase
          .from("meeting_attendance")
          .select("id", { count: "exact", head: true })
          .eq("meeting_id", lastMeeting.id)
      : Promise.resolve({ count: null }),
  ]);
  for (const r of (voteRowsRes.data as { pitch_id: string; choice: VoteChoice }[] | null) ?? []) {
    myVotes.set(r.pitch_id, r.choice);
  }

  // Officer to-dos, the same ones the checklist shows and to the same people.
  const staleMarks =
    mayExecute && isFixedIncome
      ? v.holdings.filter(
          (h) => h.holding.pricing_method === "manual" && h.stale
        )
      : [];
  const missingAttendance =
    lastMeeting !== null && (attendanceRes.count ?? 0) === 0;
  const nothingAhead =
    takesAttendance && !upcomingMeetings.some((m) => m.meeting_date > today);

  const actionable =
    votingPitches.some((p) => mayVote && !myVotes.has(p.id)) ||
    drafts.length > 0 ||
    (mayExecute && tickets.length > 0) ||
    staleMarks.length > 0 ||
    awaitingSchedule > 0 ||
    missingAttendance ||
    nothingAhead;
  const hasRows =
    votingPitches.length > 0 ||
    drafts.length > 0 ||
    tickets.length > 0 ||
    staleMarks.length > 0 ||
    awaitingSchedule > 0 ||
    missingAttendance ||
    nothingAhead;
  // Officers always get the strip, so the way to the checklist is always in
  // the same place, even on a quiet day.
  const showAttention = hasRows || adminAccess;
  // Each pending ticket opens its own card: the execution form on Manage
  // tickets for whoever records fills, else the ticket on Trades. Both lists
  // run oldest first, so the row's button goes to the first one.
  const ticketHref = (id: string) =>
    mayExecute
      ? `/${slug}/admin/tickets#ticket-${id}`
      : `/${slug}/trades#ticket-${id}`;
  const ticketList = tickets.map((t, i) => (
    <Fragment key={t.id}>
      {i > 0 && ", "}
      <Link
        href={ticketHref(t.id)}
        className="hover:text-foreground hover:underline"
      >
        {t.action === "buy" ? "Buy" : "Sell"} {t.symbol ?? t.name}
      </Link>
    </Fragment>
  ));
  // Matches the "stale prices" filter on Holdings, which the badge opens.
  const staleCount = v.holdings.filter((h) => h.stale).length;

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
      slug: s.sectorSlug,
    }));
  // Sector names in the positions table open the sector.
  const sectorSlugs = Object.fromEntries(
    v.sectors.map((s) => [s.sectorId, s.sectorSlug])
  );

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
      className="text-sm font-medium text-accent-text hover:underline"
    >
      All holdings
    </Link>
  );
  const noPositions = (
    <>
      No positions yet.{" "}
      {mayExecute ? (
        <>
          Add them on{" "}
          <Link href={`/${slug}/admin/holdings`} className={TEXT_LINK}>
            Manage holdings
          </Link>
          .
        </>
      ) : (
        "The PM adds holdings."
      )}
    </>
  );

  // Club news: always shown, alumni included.
  const clubCards = (
    <>
      <Card className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Next meeting</h2>
          <Link
            href={`/${slug}/attendance`}
            className={HEADER_LINK}
          >
            All meetings
          </Link>
        </div>
        {nextMeeting ? (
          <div className="mt-2">
            <p className="text-xl font-semibold tracking-tight">
              {formatDay(nextMeeting.meeting_date)}
            </p>
            <p className="mt-0.5 text-sm">{tidy(nextMeeting.title)}</p>
            {agenda.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-muted">Pitches</p>
                <ul className="mt-0.5 space-y-0.5 text-sm">
                  {agenda.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/${slug}/pitches/${p.id}`}
                        className={TEXT_LINK}
                      >
                        {p.title}
                      </Link>
                      {p.status === "voting" && (
                        <span className="text-muted"> · voting open</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            No meetings scheduled yet.
            {takesAttendance && (
              <>
                {" "}
                Add them on{" "}
                <Link href={`/${slug}/admin/attendance`} className={TEXT_LINK}>
                  Manage meetings
                </Link>
                .
              </>
            )}
          </p>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Latest update</h2>
          <Link
            href={`/${slug}/updates`}
            className={HEADER_LINK}
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
            No updates yet.
            {canOpenAdminSection(ctx, "updates") && (
              <>
                {" "}
                <Link href={`/${slug}/admin/updates`} className={TEXT_LINK}>
                  Post an update
                </Link>
              </>
            )}
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
          ctx.canViewCurrent && staleCount > 0 ? (
            // Opens Holdings filtered to the positions behind the warning.
            <Link
              href={`/${slug}/holdings?price=stale`}
              title="Prices that are out of date: an old mark, a missing quote or no Treasury curve, so the last saved value is shown. Open the holdings affected."
              className="rounded-full transition-opacity hover:opacity-80"
            >
              <Badge tone="warn">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />{" "}
                <span className="tabular-nums">
                  {plural(staleCount, "stale price", "stale prices")}
                </span>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </Badge>
            </Link>
          ) : undefined
        }
      />

      {showAttention && (
        <section className="rounded-2xl bg-accent-soft px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-1">
            <h2 className="font-semibold">
              {actionable
                ? "Waiting on you"
                : votingPitches.length > 0 && !adminAccess
                ? "Open votes"
                : "Nothing waiting on you"}
            </h2>
            {adminAccess && (
              <Link
                href={`/${slug}/admin`}
                className={`inline-flex items-center gap-1 ${HEADER_LINK}`}
              >
                Open checklist
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>
          {hasRows && (
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
                          href={`/${slug}/pitches/${p.id}#vote`}
                          className={mine ? ATTENTION_ACTION_QUIET : ATTENTION_ACTION}
                        >
                          {mine ? "Change vote" : "Vote"}
                        </Link>
                      ) : (
                        <Link
                          href={`/${slug}/pitches/${p.id}#vote`}
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
                      · {closesLabel(p.vote_closes_at, today)}
                      {mine ? ` · you voted ${mine}` : ""}
                    </span>
                  </AttentionRow>
                );
              })}
              {ledSector &&
                (drafts.length <= 3 ? (
                  drafts.map((d) => (
                    <AttentionRow
                      key={d.id}
                      icon={<FilePen className="h-4 w-4" />}
                      action={
                        <Link
                          href={`/${slug}/pitches/${d.id}#actions`}
                          className={ATTENTION_ACTION}
                        >
                          Submit
                        </Link>
                      }
                    >
                      <Link
                        href={`/${slug}/pitches/${d.id}`}
                        className="font-medium hover:underline"
                      >
                        {d.title}
                      </Link>
                      <span className="text-muted">
                        {" "}
                        · draft in {ledSector.name}, waiting for you to submit
                      </span>
                    </AttentionRow>
                  ))
                ) : (
                  <AttentionRow
                    icon={<FilePen className="h-4 w-4" />}
                    action={
                      <Link
                        href={`/${slug}/sectors/${ledSector.slug}#pitches`}
                        className={ATTENTION_ACTION}
                      >
                        Review drafts
                      </Link>
                    }
                  >
                    {plural(drafts.length, "draft", "drafts")} in{" "}
                    {ledSector.name} waiting for you to submit
                  </AttentionRow>
                ))}
              {tickets.length > 0 &&
                (mayExecute ? (
                  <AttentionRow
                    icon={<ArrowLeftRight className="h-4 w-4" />}
                    action={
                      <Link
                        href={ticketHref(tickets[0].id)}
                        className={ATTENTION_ACTION}
                      >
                        Record execution
                      </Link>
                    }
                  >
                    {plural(tickets.length, "ticket", "tickets")} waiting to be
                    executed
                    <span className="text-muted">: {ticketList}</span>
                  </AttentionRow>
                ) : (
                  <AttentionRow
                    icon={<ArrowLeftRight className="h-4 w-4" />}
                    action={
                      <Link
                        href={ticketHref(tickets[0].id)}
                        className={ATTENTION_ACTION_QUIET}
                      >
                        View trades
                      </Link>
                    }
                  >
                    {plural(tickets.length, "ticket", "tickets")} waiting to be
                    executed
                    <span className="text-muted">: {ticketList}</span>
                  </AttentionRow>
                ))}
              {staleMarks.length > 0 && (
                <AttentionRow
                  icon={<AlertTriangle className="h-4 w-4" />}
                  action={
                    <Link
                      href={`/${slug}/admin/holdings?stale=1#marks`}
                      className={ATTENTION_ACTION}
                    >
                      Enter marks
                    </Link>
                  }
                >
                  {staleMarks.length === 1
                    ? "1 bond mark is stale"
                    : `${staleMarks.length} bond marks are stale`}
                </AttentionRow>
              )}
              {awaitingSchedule > 0 && (
                <AttentionRow
                  icon={<CalendarClock className="h-4 w-4" />}
                  action={
                    <Link
                      href={`/${slug}/admin/pitches#awaiting`}
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
              {missingAttendance && lastMeeting && (
                <AttentionRow
                  icon={<ClipboardCheck className="h-4 w-4" />}
                  action={
                    <Link
                      href={`/${slug}/admin/attendance?meeting=${lastMeeting.id}`}
                      className={ATTENTION_ACTION}
                    >
                      Take attendance
                    </Link>
                  }
                >
                  Attendance not taken for {formatDay(lastMeeting.meeting_date)}
                  <span className="text-muted">
                    {" "}
                    · {tidy(lastMeeting.title)}
                  </span>
                </AttentionRow>
              )}
              {nothingAhead && (
                <AttentionRow
                  icon={<CalendarPlus className="h-4 w-4" />}
                  action={
                    <Link
                      href={`/${slug}/admin/attendance#add-meeting`}
                      className={ATTENTION_ACTION}
                    >
                      Add meetings
                    </Link>
                  }
                >
                  No meetings scheduled after today
                </AttentionRow>
              )}
            </ul>
          )}
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
              href={mayExecute ? `/${slug}/admin/holdings#cash` : undefined}
              linkTitle="Record a cash movement on Manage holdings"
            />
            <StatCard
              label="YTD vs benchmark"
              href={`/${slug}/performance`}
              linkTitle="Open Performance"
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

          {/* On a phone the club's news comes right after the headline
              figures; from lg it sits under the movers. */}
          <div className="grid items-start gap-4 sm:grid-cols-2 lg:hidden [&>*]:min-w-0">
            {clubCards}
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
                      className="text-sm font-medium text-accent-text hover:underline"
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
              <div className="hidden space-y-4 lg:block">{clubCards}</div>
            </div>

            {/* Right: where the money sits. */}
            <div className="space-y-4">
              <Card>
                <CardHeader
                  title="Sector allocation"
                  action={
                    <Link
                      href={`/${slug}/sectors`}
                      className="text-sm font-medium text-accent-text hover:underline"
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
                      No sector data yet.{" "}
                      {canOpenAdminSection(ctx, "sectors") ? (
                        <>
                          Add sectors and targets on{" "}
                          <Link
                            href={`/${slug}/admin/sectors#targets`}
                            className={TEXT_LINK}
                          >
                            Manage sectors
                          </Link>
                          .
                        </>
                      ) : (
                        "Officers add sectors and set targets."
                      )}
                    </p>
                  )}
                </div>
              </Card>

              {isFixedIncome && (
                <Card>
                  <CardHeader
                    title="Allocation by instrument type"
                    action={allHoldingsLink}
                  />
                  <div className="p-4 sm:p-6">
                    {donutData.length > 0 ? (
                      <AllocationDonut data={donutData} fund={fund.slug} />
                    ) : (
                      <p className="py-8 text-center text-sm text-muted">
                        {noPositions}
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
                sectorSlugs={sectorSlugs}
                compact
              />
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted">
                {noPositions}
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
