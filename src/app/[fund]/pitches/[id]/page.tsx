// /[fund]/pitches/[id] — the pitch page (SPEC 11.2 / Section 12): thesis
// rendered as basic markdown (tiny in-file renderer, no dependency), files
// with signed URLs, the proposed trade, the paired bear pitch, the vote
// panel, and the outcome (ticket + trade) once executed. Who sees which vote
// data is decided here and passed down as props.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Link2,
  Paperclip,
  Pencil,
  Receipt,
} from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { voteRule } from "@/lib/votes";
import {
  can,
  inSector,
  isActiveVoter,
  isOfficer,
  leadsSector,
} from "@/lib/permissions";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, PitchStatusBadge } from "@/components/ui/Badge";
import { VotePanel } from "@/components/pitch/VotePanel";
import { ScheduleControls } from "@/components/pitch/ScheduleControls";
import { pitchActionLine } from "@/components/pitch/PitchCard";
import type { TallyVoter } from "@/components/pitch/TallyCard";
import {
  easternDateString,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPercent,
} from "@/lib/format";
import type {
  Meeting,
  Pitch,
  PitchFile,
  Trade,
  TradeTicket,
  VoteChoice,
} from "@/types/domain";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

interface PitchDetail extends Pitch {
  sector: { name: string } | null;
  author: { full_name: string } | null;
}

interface VoteRow {
  voter_id: string;
  choice: VoteChoice;
  comment: string | null;
  cast_at: string;
  voter: { full_name: string } | null;
}

export default async function PitchDetailPage({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!UUID_RE.test(id)) notFound();

  const { supabase, user } = await getAuthState();
  const { data: pitchRow } = await supabase
    .from("pitches")
    .select("*, sector:sectors(name), author:profiles!author_id(full_name)")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!pitchRow) notFound();
  const pitch = pitchRow as unknown as PitchDetail;
  const settings = (pitch.settings ?? {}) as {
    paired_pitch_id?: string;
    cusip?: string;
  };

  const canViewIndividual = can(ctx, "view_individual_votes");
  const closedOrDone = ["passed", "failed", "executed"].includes(pitch.status);

  const [
    filesRes,
    votesRes,
    pairedRes,
    reverseRes,
    ticketRes,
    meetingsRes,
    ballotCountRes,
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
      pitch.status === "passed" || pitch.status === "executed"
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
    ]);

  const files = (filesRes.data as PitchFile[] | null) ?? [];
  const signedFiles = await Promise.all(
    files.map(async (f) => {
      const { data } = await supabase.storage
        .from("pitch-files")
        .createSignedUrl(f.storage_path, 3600);
      return { ...f, url: data?.signedUrl ?? null };
    })
  );

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

  const ticket = ((ticketRes.data as TradeTicket[] | null) ?? [])[0] ?? null;
  let trade: Trade | null = null;
  if (ticket && ticket.status === "executed") {
    const { data: tradeRows } = await supabase
      .from("trades")
      .select("*")
      .eq("ticket_id", ticket.id)
      .limit(1);
    trade = ((tradeRows as Trade[] | null) ?? [])[0] ?? null;
  }

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

  const security = pitch.symbol ?? pitch.instrument_name;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/${slug}/pitches`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All pitches
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold sm:text-2xl">{pitch.title}</h1>
          <PitchStatusBadge status={pitch.status} />
          {pitch.pitch_type === "bear" && <Badge tone="loss">bear case</Badge>}
          {editable && (
            <Link
              href={`/${slug}/pitches/${pitch.id}/edit`}
              className="inline-flex items-center gap-1 rounded-lg border border-input-border bg-input-bg px-2.5 py-1 text-xs font-medium transition-colors hover:bg-highlight"
            >
              <Pencil className="h-3 w-3" /> Edit
            </Link>
          )}
        </div>
        <p className="mt-1 text-xs text-muted sm:text-sm">
          {pitchActionLine(pitch)}
          {pitch.sector?.name ? ` · ${pitch.sector.name}` : ""}
          {pitch.author?.full_name ? ` · by ${pitch.author.full_name}` : ""}
          {` · drafted ${formatDate(pitch.created_at)}`}
          {pitch.scheduled_for
            ? ` · scheduled for ${formatDate(pitch.scheduled_for)}`
            : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Main column ────────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-2">
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
              {signedFiles.length > 0 ? (
                <ul className="space-y-2">
                  {signedFiles.map((f) => (
                    <li key={f.id}>
                      {f.url ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 rounded-lg bg-highlight px-3 py-2 text-sm transition-colors hover:bg-accent-soft"
                        >
                          {f.kind === "deck" ? (
                            <FileText className="h-4 w-4 shrink-0 text-accent" />
                          ) : f.kind === "model" ? (
                            <FileSpreadsheet className="h-4 w-4 shrink-0 text-accent" />
                          ) : (
                            <Paperclip className="h-4 w-4 shrink-0 text-accent" />
                          )}
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {f.file_name}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider text-muted">
                            {f.kind}
                          </span>
                        </a>
                      ) : (
                        <span className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
                          <Paperclip className="h-4 w-4" /> {f.file_name} (link
                          unavailable)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">
                  No deck or model attached yet.{" "}
                  {editable
                    ? "Add them from the editor — decks are PDF/PPTX, models XLSX, 25MB max."
                    : "The sector team uploads them from the editor."}
                </p>
              )}
            </div>
          </Card>

          {paired && (
            <Card className="p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-accent" />
                <span className="text-[11px] uppercase tracking-wider text-muted">
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
                    {pitch.holding_id ? (
                      <Link
                        href={`/${slug}/holdings/${pitch.holding_id}`}
                        className="text-accent hover:underline"
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
            canVote={pitch.status === "voting" && voteBlockedReason === null}
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
          )}

          {closedOrDone && pitch.status !== "failed" && (
            <Card>
              <CardHeader title="Outcome" />
              <div className="space-y-2 p-4 text-sm sm:p-5">
                {pitch.action === "rebalance" ? (
                  <p className="text-muted">
                    The rebalance passed — an officer applies the new sector
                    targets under Fund Admin → Sectors.
                  </p>
                ) : ticket ? (
                  <>
                    <p className="flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-accent" />
                      Ticket{" "}
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
                    {ticket.status === "pending" && (
                      <p className="text-muted">
                        Waiting on the portfolio manager to record the fill
                        {canSchedule ? (
                          <>
                            {" — "}
                            <Link
                              href={`/${slug}/admin/tickets`}
                              className="text-accent hover:underline"
                            >
                              open pending tickets
                            </Link>
                          </>
                        ) : (
                          "."
                        )}
                      </p>
                    )}
                    {ticket.status === "cancelled" && (
                      <p className="text-muted">
                        The ticket was cancelled — the pitch passed but was not
                        executed{ticket.notes ? `: ${ticket.notes}` : "."}
                      </p>
                    )}
                    {trade && (
                      <p className="text-muted">
                        {trade.action === "buy" ? "Bought" : "Sold"}{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {Number(trade.quantity).toLocaleString("en-US")}
                        </span>{" "}
                        {pitch.symbol ?? ticket.name} at{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {formatCurrency(Number(trade.price))}
                        </span>{" "}
                        on {formatDate(trade.trade_date)} ·{" "}
                        <Link
                          href={`/${slug}/trades`}
                          className="text-accent hover:underline"
                        >
                          view in the ledger
                        </Link>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-muted">
                    Passed {formatDateTime(pitch.closed_at)} — the trade ticket
                    will appear here once created.
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
