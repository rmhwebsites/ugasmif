// /[fund]/pitches/[id] — the pitch page (SPEC 11.2 / Section 12): thesis
// rendered as basic markdown (tiny in-file renderer, no dependency), files
// with signed URLs, the proposed trade, the paired bear pitch, the vote
// panel, and the outcome (ticket, trade and position) once it passes. Who
// sees which vote data is decided here and passed down as props.
//
// The vote, actions and outcome cards carry id="vote", "actions" and
// "outcome", so links from lists and the dashboard land on them (ScrollToHash
// covers client-side navigation), and a strip under the title says what the
// pitch needs from you next and links there.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ExternalLink,
  History,
  Link2,
  Pencil,
  Receipt,
} from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { voteRule } from "@/lib/votes";
import { getKeyStats, getQuote } from "@/lib/yahoo";
import {
  can,
  canExecute,
  inSector,
  isActiveVoter,
  isOfficer,
  leadsSector,
} from "@/lib/permissions";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, PitchStatusBadge } from "@/components/ui/Badge";
import { LinkButton, PageHeader } from "@/components/ui/PageHeader";
import { SectorLink } from "@/components/ui/SectorLink";
import { VotePanel } from "@/components/pitch/VotePanel";
import { ScheduleControls } from "@/components/pitch/ScheduleControls";
import { pitchActionLine } from "@/components/pitch/PitchCard";
import { PitchFiles } from "@/components/pitch/PitchFiles";
import { ScrollToHash } from "@/components/pitch/ScrollToHash";
import { StockChart } from "@/components/holdings/StockChart";
import { KeyStatsCard } from "@/components/holdings/KeyStats";
import { SecurityLogo } from "@/components/holdings/SecurityLogo";
import type { TallyVoter } from "@/components/pitch/TallyCard";
import {
  easternDateString,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPercent,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/format";
import type {
  Holding,
  Meeting,
  PitchFile,
  Trade,
  TradeTicket,
  VoteChoice,
} from "@/types/domain";
import { isPitchId, loadPitch } from "./load-pitch";

// Individual bonds have no Yahoo symbol to chart; a pitch for one carries a
// CUSIP instead. Everything else with a symbol gets the price chart.
const BOND_TYPES = new Set([
  "treasury",
  "corporate",
  "agency_mbs",
  "municipal",
]);

// ── Tiny markdown → JSX (headings, bold, italics, code, lists, quotes) ──────

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**")) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-highlight px-1 py-0.5 text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(" ");
    blocks.push(
      <p key={`p-${key++}`} className="text-sm leading-relaxed">
        {renderInline(text, `p-${key}`)}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items;
    const cls = "my-1 space-y-1 pl-5 text-sm leading-relaxed";
    blocks.push(
      list.ordered ? (
        <ol key={`l-${key++}`} className={`list-decimal ${cls}`}>
          {items.map((it, i) => (
            <li key={i}>{renderInline(it, `li-${key}-${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={`l-${key++}`} className={`list-disc ${cls}`}>
          {items.map((it, i) => (
            <li key={i}>{renderInline(it, `li-${key}-${i}`)}</li>
          ))}
        </ul>
      )
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);

    if (line.trim() === "") {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const content = renderInline(heading[2], `h-${key}`);
      blocks.push(
        level <= 2 ? (
          <h3
            key={`h-${key++}`}
            className="mt-5 border-b border-card-border pb-1 text-base font-semibold first:mt-0"
          >
            {content}
          </h3>
        ) : (
          <h4 key={`h-${key++}`} className="mt-4 text-sm font-semibold">
            {content}
          </h4>
        )
      );
    } else if (bullet) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
    } else if (quote) {
      flushPara();
      flushList();
      blocks.push(
        <blockquote
          key={`q-${key++}`}
          className="border-l-2 border-accent pl-3 text-sm italic text-muted"
        >
          {renderInline(quote[1], `q-${key}`)}
        </blockquote>
      );
    } else {
      if (list) flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

// ── Data shapes ─────────────────────────────────────────────────────────────

interface VoteRow {
  voter_id: string;
  choice: VoteChoice;
  comment: string | null;
  cast_at: string;
  voter: { full_name: string } | null;
}

type HoldingLink = Pick<Holding, "id" | "symbol" | "name">;

/** A line under the title: where the pitch stands and the next step. */
interface NextStep {
  text: string;
  links: { href: string; label: string }[];
}

/** "Buy GD · Industrials · by Ana" with the dots only between parts. */
function withDots(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [" · ", part]));
}

function isPdf(name: string): boolean {
  return /\.pdf$/i.test(name.trim());
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}): Promise<Metadata> {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) return {};
  const pitch = await loadPitch(ctx.fund.id, id);
  return pitch ? { title: pitch.title } : {};
}

export default async function PitchDetailPage({
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
  const settings = (pitch.settings ?? {}) as {
    paired_pitch_id?: string;
    cusip?: string;
  };

  // Equity/ETF pitches get a live quote, price chart and key stats. A pitch
  // for an individual bond has no Yahoo symbol to look up.
  const rawSymbol = (pitch.symbol ?? "").trim();
  const chartSymbol =
    rawSymbol !== "" && !BOND_TYPES.has(pitch.instrument_type ?? "")
      ? rawSymbol.toUpperCase()
      : null;

  const canViewIndividual = can(ctx, "view_individual_votes");
  const showOutcome = pitch.status === "passed" || pitch.status === "executed";

  // The position this pitch is about: the holding it names, or else the one
  // with the same symbol (or CUSIP for a bond), the way a holding's page
  // finds its pitches. A new buy has none until the trade goes through.
  const holdingQuery = supabase
    .from("holdings")
    .select("id, symbol, name")
    .eq("fund_id", ctx.fund.id);
  const holdingPromise = pitch.holding_id
    ? holdingQuery.eq("id", pitch.holding_id).limit(1)
    : rawSymbol !== ""
      ? holdingQuery
          .eq("symbol", rawSymbol.toUpperCase())
          .order("is_active", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
      : settings.cusip
        ? holdingQuery
            .eq("cusip", settings.cusip)
            .order("is_active", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(1)
        : Promise.resolve({ data: null });

  const [
    filesRes,
    votesRes,
    pairedRes,
    reverseRes,
    ticketRes,
    meetingsRes,
    ballotCountRes,
    holdingRes,
    quote,
    keyStats,
  ] = await Promise.all([
      supabase
        .from("pitch_files")
        .select("*")
        .eq("pitch_id", pitch.id)
        .order("created_at"),
      // RLS: members get back only their own ballot; officers/advisor get all.
      supabase
        .from("votes")
        .select("voter_id, choice, comment, cast_at, voter:profiles!voter_id(full_name)")
        .eq("pitch_id", pitch.id)
        .order("cast_at"),
      settings.paired_pitch_id
        ? supabase
            .from("pitches")
            .select("id, title, status")
            .eq("id", settings.paired_pitch_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("pitches")
        .select("id, title, status")
        .eq("fund_id", ctx.fund.id)
        .contains("settings", { paired_pitch_id: pitch.id })
        .limit(1),
      showOutcome
        ? supabase
            .from("trade_tickets")
            .select("*")
            .eq("pitch_id", pitch.id)
            .order("created_at", { ascending: false })
            .limit(1)
        : Promise.resolve({ data: null }),
      supabase
        .from("meetings")
        .select("meeting_date")
        .eq("fund_id", ctx.fund.id)
        .gte("meeting_date", easternDateString())
        .order("meeting_date")
        .limit(6),
      // Members may see how many ballots are in while a vote is open, never
      // the split (SPEC Section 12). RLS hides other members' rows, so the
      // total comes from the security-definer RPC; officers already have
      // every row and count them below.
      pitch.status === "voting" && !canViewIndividual
        ? supabase.rpc("pitch_vote_count", { p_pitch_id: pitch.id })
        : Promise.resolve({ data: null }),
      holdingPromise,
      // Yahoo is outside our control, so a failure here degrades the market
      // card rather than taking the pitch page down with it.
      chartSymbol
        ? getQuote(chartSymbol).catch(() => null)
        : Promise.resolve(null),
      chartSymbol
        ? getKeyStats(chartSymbol).catch(() => ({}))
        : Promise.resolve({}),
    ]);

  // Only what the viewer needs — it links through our own route, which signs
  // a storage URL per request, so no storage path reaches the browser.
  const files = ((filesRes.data as PitchFile[] | null) ?? []).map((f) => ({
    id: f.id,
    kind: f.kind,
    file_name: f.file_name,
  }));
  // The deck gets a button by the title, so nobody has to scroll for it.
  const deck =
    files.find((f) => f.kind === "deck") ??
    files.find((f) => isPdf(f.file_name)) ??
    null;
  const deckHref = deck
    ? `/api/${encodeURIComponent(slug)}/pitches/${encodeURIComponent(
        pitch.id
      )}/files/${encodeURIComponent(deck.id)}`
    : null;

  // Distance from the last price to the pitch's target. Signed rather than
  // "upside" because a trim or sell pitch targets a price below the market.
  const lastPrice = quote?.price ?? null;
  const targetPrice =
    pitch.target_price === null ? null : Number(pitch.target_price);
  const toTargetPct =
    lastPrice !== null && lastPrice > 0 && targetPrice !== null
      ? ((targetPrice - lastPrice) / lastPrice) * 100
      : null;

  const voteRows = (votesRes.data as unknown as VoteRow[] | null) ?? [];
  const myVoteRow = voteRows.find((v) => v.voter_id === user?.id) ?? null;
  const liveYes = voteRows.filter((v) => v.choice === "yes").length;
  const liveNo = voteRows.filter((v) => v.choice === "no").length;
  const voters: TallyVoter[] = voteRows.map((v) => ({
    name: v.voter?.full_name ?? "Member",
    choice: v.choice,
    comment: v.comment,
    castAt: v.cast_at,
  }));
  const rpcBallots = ballotCountRes.data;
  const ballotsCast = typeof rpcBallots === "number" ? rpcBallots : null;

  const { thresholdPct, quorumPct } = voteRule(pitch, ctx.fund);

  const paired =
    (pairedRes.data as { id: string; title: string; status: string } | null) ??
    ((reverseRes.data as { id: string; title: string; status: string }[] | null) ??
      [])[0] ??
    null;

  const holding =
    ((holdingRes.data as HoldingLink[] | null) ?? [])[0] ?? null;
  const ticket = ((ticketRes.data as TradeTicket[] | null) ?? [])[0] ?? null;

  // The trade the ticket became, or, when no ticket is linked (pitches
  // decided before tickets were tracked here), the position's latest trade.
  const [ticketTradeRes, latestTradeRes] = await Promise.all([
    ticket && ticket.status === "executed"
      ? supabase.from("trades").select("*").eq("ticket_id", ticket.id).limit(1)
      : Promise.resolve({ data: null }),
    showOutcome && !ticket && holding && pitch.action !== "rebalance"
      ? supabase
          .from("trades")
          .select("*")
          .eq("holding_id", holding.id)
          .order("trade_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
  ]);
  const ticketTrade =
    ((ticketTradeRes.data as Trade[] | null) ?? [])[0] ?? null;
  const latestTrade =
    ((latestTradeRes.data as Trade[] | null) ?? [])[0] ?? null;

  // ── Permissions for the action buttons ────────────────────────────────
  const officer = isOfficer(ctx);
  const editable = officer
    ? ["draft", "submitted", "scheduled"].includes(pitch.status)
    : leadsSector(ctx, pitch.sector_id)
      ? ["draft", "submitted"].includes(pitch.status)
      : pitch.author_id === user?.id && pitch.status === "draft";
  const canSubmit =
    pitch.status === "draft" && can(ctx, "submit_pitch", { sectorId: pitch.sector_id });
  const canWithdraw =
    (pitch.author_id === user?.id && pitch.status === "draft") ||
    can(ctx, "withdraw_pitch", { sectorId: pitch.sector_id });
  const canSchedule = can(ctx, "schedule_pitch");
  const hasActions =
    (canSubmit ||
      (canWithdraw && ["draft", "submitted", "scheduled"].includes(pitch.status)) ||
      (canSchedule && ["submitted", "scheduled", "voting"].includes(pitch.status)));
  // Recording a fill happens on Manage tickets, which only these people open.
  const mayExecute = canExecute(ctx);
  // The pitch's audit trail, for the people who can open the audit log. No
  // entity filter: ballots are logged as "votes" rows under the pitch's id
  // and uploads under each file's own id, so the pitch id plus the ids of
  // the files it has now (the audit page takes five) cover drafting,
  // scheduling, every ballot and those files' uploads.
  const historyIds = [pitch.id, ...files.slice(0, 4).map((f) => f.id)];
  const historyHref = can(ctx, "view_audit_log")
    ? `/${slug}/admin/audit?entity_id=${historyIds.join(",")}`
    : null;

  // ── Vote eligibility (clear reason when blocked) ──────────────────────
  const sectorBlocked =
    ctx.fund.settings?.sector_can_vote_on_own_pitch === false &&
    inSector(ctx, pitch.sector_id);
  let voteBlockedReason: string | null = null;
  if (!isActiveVoter(ctx)) {
    voteBlockedReason = ctx.isAppAdmin
      ? "App admins are not students and do not vote."
      : ctx.isFacultyAdvisor && !ctx.membership
        ? "The faculty advisor does not vote."
        : "Only active members (not viewers or alumni) can vote.";
  } else if (sectorBlocked) {
    voteBlockedReason =
      "This fund does not let the pitching sector vote on its own pitch.";
  }
  const canVoteNow = pitch.status === "voting" && voteBlockedReason === null;

  const security = pitch.symbol ?? pitch.instrument_name;
  const positionLabel = holding?.symbol ?? security ?? holding?.name ?? "";
  const ticketHref = ticket
    ? mayExecute
      ? `/${slug}/admin/tickets#ticket-${ticket.id}`
      : `/${slug}/trades#ticket-${ticket.id}`
    : null;

  // ── What this pitch needs next, said once under the title ─────────────
  // The vote, the actions and the outcome sit in the side column, which on
  // a phone comes after the chart, the thesis and the deck. This line says
  // where things stand and links straight to the card that matters.
  const result =
    pitch.result_pct === null
      ? ""
      : ` with ${formatPercent(Number(pitch.result_pct))} yes (${pitch.votes_yes} to ${pitch.votes_no})`;
  let nextStep: NextStep | null = null;
  if (pitch.status === "voting") {
    nextStep = {
      text: `Voting is open until ${formatDateTime(pitch.vote_closes_at)} ET.${
        canVoteNow && myVoteRow ? ` You voted ${myVoteRow.choice}.` : ""
      }`,
      links: [
        {
          href: "#vote",
          label: canVoteNow
            ? myVoteRow
              ? "Change your vote"
              : "Cast your vote"
            : "See the vote",
        },
        ...(canSchedule ? [{ href: "#actions", label: "Close the vote" }] : []),
      ],
    };
  } else if (pitch.status === "draft" && canSubmit) {
    nextStep = {
      text: "This pitch is a draft. Submit it when it's ready for a class date.",
      links: [{ href: "#actions", label: "Submit for scheduling" }],
    };
  } else if (pitch.status === "draft" && editable) {
    nextStep = {
      text: "This pitch is a draft. Your sector leader submits it for a class date when it's ready.",
      links: [],
    };
  } else if (pitch.status === "submitted" && canSchedule) {
    nextStep = {
      text: "Submitted and waiting for a class date.",
      links: [{ href: "#actions", label: "Schedule it" }],
    };
  } else if (pitch.status === "scheduled" && canSchedule) {
    nextStep = {
      text: `Scheduled for ${formatDate(pitch.scheduled_for)}.`,
      links: [{ href: "#actions", label: "Open the vote" }],
    };
  } else if (showOutcome) {
    nextStep = {
      text: `Passed${result}.${
        ticket?.status === "pending" ? " The trade is waiting to be executed." : ""
      }`,
      links: [
        { href: "#outcome", label: "See the outcome" },
        ...(ticket?.status === "pending" && mayExecute && ticketHref
          ? [{ href: ticketHref, label: "Record execution" }]
          : []),
      ],
    };
  } else if (pitch.status === "failed") {
    nextStep = {
      text: `Failed${result}.`,
      links: [{ href: "#vote", label: "See the vote" }],
    };
  }

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: `/${slug}/pitches`, label: "Pitches" }}
        title={pitch.title}
        description={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <PitchStatusBadge status={pitch.status} />
            {pitch.pitch_type === "bear" && <Badge tone="loss">bear case</Badge>}
            <span>
              {withDots(
                [
                  pitchActionLine(pitch),
                  pitch.sector ? (
                    <SectorLink
                      key="sector"
                      fund={slug}
                      slug={pitch.sector.slug}
                      name={pitch.sector.name}
                    />
                  ) : null,
                  pitch.author?.full_name ? `by ${pitch.author.full_name}` : null,
                  `drafted ${formatDate(pitch.created_at)}`,
                  pitch.scheduled_for
                    ? `scheduled for ${formatDate(pitch.scheduled_for)}`
                    : null,
                ].filter((part) => part !== null)
              )}
            </span>
          </span>
        }
        actions={
          deckHref || editable || historyHref ? (
            <>
              {deck && deckHref && (
                <a
                  href={deckHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-highlight px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card-border"
                >
                  <ExternalLink className="h-4 w-4" />
                  {isPdf(deck.file_name) ? "View deck" : "Download deck"}
                </a>
              )}
              {editable && (
                <LinkButton
                  href={`/${slug}/pitches/${pitch.id}/edit`}
                  variant="secondary"
                >
                  <Pencil className="h-4 w-4" /> Edit pitch
                </LinkButton>
              )}
              {historyHref && (
                <LinkButton href={historyHref} variant="secondary">
                  <History className="h-4 w-4" aria-hidden="true" />
                  History
                </LinkButton>
              )}
            </>
          ) : undefined
        }
      />

      {nextStep && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-highlight px-3 py-2 text-sm">
          <span className="text-muted">{nextStep.text}</span>
          {nextStep.links.map((l) =>
            l.href.startsWith("#") ? (
              <a
                key={l.href}
                href={l.href}
                className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
              >
                {l.label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <Link
                key={l.href}
                href={l.href}
                className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
              >
                {l.label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* ── Main column ────────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-2">
          {chartSymbol && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border px-4 py-3 sm:px-6 sm:py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <SecurityLogo
                    symbol={chartSymbol}
                    name={pitch.instrument_name}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight">{chartSymbol}</p>
                    <p className="truncate text-xs text-muted">
                      {quote?.name ?? pitch.instrument_name ?? "Live market data"}
                    </p>
                  </div>
                </div>
                {quote && (
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums sm:text-xl">
                      {formatCurrency(quote.price)}
                    </p>
                    <p
                      className={`text-xs font-medium tabular-nums ${
                        (quote.change ?? 0) >= 0 ? "text-gain" : "text-loss"
                      }`}
                    >
                      {formatSignedCurrency(quote.change)} (
                      {formatSignedPercent(quote.changePercent)})
                    </p>
                  </div>
                )}
              </div>

              {targetPrice !== null && (
                <dl className="grid grid-cols-2 divide-x divide-card-border border-b border-card-border text-center">
                  <div className="px-2 py-3">
                    <dt className="text-xs font-medium text-muted">
                      Target price
                    </dt>
                    <dd className="mt-0.5 text-sm font-medium tabular-nums">
                      {formatCurrency(targetPrice)}
                    </dd>
                  </div>
                  <div className="px-2 py-3">
                    <dt className="text-xs font-medium text-muted">
                      To target
                    </dt>
                    <dd
                      className={`mt-0.5 text-sm font-medium tabular-nums ${
                        toTargetPct === null
                          ? ""
                          : toTargetPct >= 0
                            ? "text-gain"
                            : "text-loss"
                      }`}
                    >
                      {toTargetPct === null
                        ? "—"
                        : formatSignedPercent(toTargetPct)}
                    </dd>
                  </div>
                </dl>
              )}

              <div className="p-4 sm:p-6">
                <StockChart symbol={chartSymbol} fund={ctx.fund.slug} />
              </div>

              {quote?.stale && (
                <p className="border-t border-card-border px-4 py-2 text-xs text-muted sm:px-6">
                  Live quote unavailable. Showing the last stored price from{" "}
                  {formatDateTime(quote.asOf)}.
                </p>
              )}
            </Card>
          )}

          {chartSymbol && (
            <KeyStatsCard stats={keyStats} symbol={chartSymbol} />
          )}

          <Card>
            <CardHeader title="Thesis" />
            <div className="space-y-2 p-4 sm:p-6">
              {pitch.thesis_md && pitch.thesis_md.trim() !== "" ? (
                renderMarkdown(pitch.thesis_md)
              ) : (
                <p className="text-sm text-muted">
                  No thesis written yet.{" "}
                  {editable
                    ? "Open the editor and write it under the Business / Thesis / Valuation / Risks / Catalysts headings."
                    : "The author hasn't filled it in."}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Files" />
            <div className="p-4 sm:p-6">
              {files.length > 0 ? (
                <PitchFiles files={files} fund={slug} pitchId={pitch.id} />
              ) : (
                <p className="text-sm text-muted">
                  No deck or model attached yet.{" "}
                  {editable
                    ? "Add them from the editor: decks are PDF or PPTX, models XLSX, 25MB max."
                    : "The sector team uploads them from the editor."}
                </p>
              )}
            </div>
          </Card>

          {paired && (
            <Card className="p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-accent-text" />
                <span className="text-xs font-medium text-muted">
                  Paired {settings.paired_pitch_id ? "bear" : "bull"} pitch
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Link
                  href={`/${slug}/pitches/${paired.id}`}
                  className="font-medium hover:underline"
                >
                  {paired.title}
                </Link>
                <PitchStatusBadge status={paired.status} />
              </div>
              <p className="mt-1 text-xs text-muted">
                Bull and bear cases are presented together; the vote runs on the
                buy proposal.
              </p>
            </Card>
          )}
        </div>

        {/* ── Side column ────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Proposed trade" />
            <dl className="space-y-2 p-4 text-sm sm:p-5">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Action</dt>
                <dd className="text-right font-medium">{pitchActionLine(pitch)}</dd>
              </div>
              {security && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Security</dt>
                  <dd className="min-w-0 truncate text-right font-medium">
                    {holding ? (
                      <Link
                        href={`/${slug}/holdings/${holding.id}`}
                        className="text-accent-text hover:underline"
                      >
                        {security}
                      </Link>
                    ) : (
                      security
                    )}
                  </dd>
                </div>
              )}
              {settings.cusip && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">CUSIP</dt>
                  <dd className="text-right font-medium tabular-nums">
                    {settings.cusip}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Target price</dt>
                <dd className="text-right font-medium tabular-nums">
                  {formatCurrency(
                    pitch.target_price === null ? null : Number(pitch.target_price)
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Proposed amount</dt>
                <dd className="text-right font-medium tabular-nums">
                  {formatCurrency(
                    pitch.proposed_amount === null
                      ? null
                      : Number(pitch.proposed_amount)
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Proposed weight</dt>
                <dd className="text-right font-medium tabular-nums">
                  {formatPercent(
                    pitch.proposed_weight_pct === null
                      ? null
                      : Number(pitch.proposed_weight_pct)
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Funding</dt>
                <dd className="text-right font-medium">
                  {pitch.funding_source ?? "—"}
                </dd>
              </div>
            </dl>
          </Card>

          <VotePanel
            fund={slug}
            pitchId={pitch.id}
            status={pitch.status}
            voteClosesAt={pitch.vote_closes_at}
            votesYes={pitch.votes_yes}
            votesNo={pitch.votes_no}
            resultPct={pitch.result_pct === null ? null : Number(pitch.result_pct)}
            eligibleVoters={pitch.eligible_voters}
            thresholdPct={thresholdPct}
            quorumPct={quorumPct}
            canVote={canVoteNow}
            voteBlockedReason={voteBlockedReason}
            canViewIndividual={canViewIndividual}
            myVote={
              myVoteRow
                ? { choice: myVoteRow.choice, comment: myVoteRow.comment }
                : null
            }
            ballotsCast={ballotsCast}
            liveYes={canViewIndividual ? liveYes : null}
            liveNo={canViewIndividual ? liveNo : null}
            voters={canViewIndividual ? voters : null}
          />

          {hasActions && (
            <div id="actions" className="scroll-mt-20 lg:scroll-mt-6">
              <Card>
                <CardHeader title="Actions" />
                <div className="p-4 sm:p-5">
                  <ScheduleControls
                    fund={slug}
                    pitchId={pitch.id}
                    status={pitch.status}
                    scheduledFor={pitch.scheduled_for}
                    voteClosesAt={pitch.vote_closes_at}
                    defaultWindowHours={Number(ctx.fund.vote_default_window_hours)}
                    canSubmit={canSubmit}
                    canWithdraw={canWithdraw}
                    canSchedule={canSchedule}
                    meetingDates={(
                      (meetingsRes.data as Pick<Meeting, "meeting_date">[] | null) ??
                      []
                    ).map((m) => m.meeting_date)}
                  />
                </div>
              </Card>
            </div>
          )}

          {showOutcome && (
            <div id="outcome" className="scroll-mt-20 lg:scroll-mt-6">
              <Card>
                <CardHeader title="Outcome" />
                <div className="space-y-2 p-4 text-sm sm:p-5">
                  {pitch.action === "rebalance" ? (
                    <p className="text-muted">
                      The rebalance passed.{" "}
                      {can(ctx, "set_sector_targets") ? (
                        <>
                          Apply the new sector targets on{" "}
                          <Link
                            href={`/${slug}/admin/sectors#targets`}
                            className="text-accent-text hover:underline"
                          >
                            Manage sectors
                          </Link>
                          .
                        </>
                      ) : (
                        "An officer applies the new sector targets."
                      )}
                    </p>
                  ) : (
                    <>
                      {ticket ? (
                        <>
                          <p className="flex items-center gap-2">
                            <Receipt className="h-4 w-4 text-accent-text" />
                            Trade ticket{" "}
                            <Badge
                              tone={
                                ticket.status === "executed"
                                  ? "gain"
                                  : ticket.status === "cancelled"
                                    ? "loss"
                                    : "info"
                              }
                            >
                              {ticket.status}
                            </Badge>
                          </p>
                          {ticket.status === "pending" && ticketHref && (
                            <p className="text-muted">
                              Waiting to be executed by the portfolio
                              manager.{" "}
                              <Link
                                href={ticketHref}
                                className="text-accent-text hover:underline"
                              >
                                {mayExecute ? "Record execution" : "View trades"}
                              </Link>
                            </p>
                          )}
                          {ticket.status === "cancelled" && (
                            <p className="text-muted">
                              The ticket was cancelled, so the pitch passed but
                              was not traded{ticket.notes ? `: ${ticket.notes}` : "."}
                            </p>
                          )}
                          {ticketTrade && (
                            <p className="text-muted">
                              {ticketTrade.action === "buy" ? "Bought" : "Sold"}{" "}
                              <span className="font-medium text-foreground tabular-nums">
                                {Number(ticketTrade.quantity).toLocaleString("en-US")}
                              </span>{" "}
                              {positionLabel || ticket.name} at{" "}
                              <span className="font-medium text-foreground tabular-nums">
                                {formatCurrency(Number(ticketTrade.price))}
                              </span>{" "}
                              on {formatDate(ticketTrade.trade_date)}.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-muted">
                          Passed {formatDate(pitch.closed_at)}. No trade ticket
                          is linked to this pitch.
                          {latestTrade && (
                            <>
                              {" "}The latest {positionLabel} trade:{" "}
                              {latestTrade.action === "buy" ? "bought" : "sold"}{" "}
                              <span className="font-medium text-foreground tabular-nums">
                                {Number(latestTrade.quantity).toLocaleString("en-US")}
                              </span>{" "}
                              at{" "}
                              <span className="font-medium text-foreground tabular-nums">
                                {formatCurrency(Number(latestTrade.price))}
                              </span>{" "}
                              on {formatDate(latestTrade.trade_date)}.
                            </>
                          )}
                        </p>
                      )}
                      {holding && (
                        <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                          <Link
                            href={`/${slug}/holdings/${holding.id}`}
                            className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
                          >
                            {positionLabel} position
                            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </Link>
                          <Link
                            href={`/${slug}/trades?symbol=${encodeURIComponent(
                              holding.symbol ?? holding.name
                            )}`}
                            className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
                          >
                            {positionLabel} trades
                            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </Link>
                        </p>
                      )}
                    </>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
      <ScrollToHash />
    </div>
  );
}
