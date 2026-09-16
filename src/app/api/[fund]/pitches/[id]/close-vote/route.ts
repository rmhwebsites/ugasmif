// POST /api/[fund]/pitches/[id]/close-vote — voting → passed/failed via the
// close_pitch_vote RPC (atomic tally + ticket creation + audit, SPEC Section
// 12). Officers only here; the nightly cron closes expired votes through the
// service role. Emails the fund the result, and on a pass tells the PM and
// faculty advisor a ticket is ready.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { sendEmail, sendToFund } from "@/lib/emails/send";
import { formatPercent } from "@/lib/format";
import type { Pitch } from "@/types/domain";

/** Shape of the close_pitch_vote RPC's jsonb result. */
interface CloseResult {
  status: string;
  result_pct: number | null;
  votes_yes: number;
  votes_no: number;
  eligible_voters?: number | null;
  ticket_id?: string | null;
  already_closed?: boolean;
  /** The rule the vote was judged under, frozen when it opened (SPEC 12). */
  threshold_pct?: number | null;
  quorum_pct?: number | null;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "schedule_pitch")) {
    return NextResponse.json(
      { error: "Only fund officers can close a vote" },
      { status: 403 }
    );
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { supabase, user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: pitchRow } = await supabase
    .from("pitches")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!pitchRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const pitch = pitchRow as Pitch;

  if (pitch.status !== "voting") {
    return NextResponse.json(
      { error: `This pitch is ${pitch.status} — only open votes can be closed` },
      { status: 400 }
    );
  }

  // The RPC re-checks permissions, tallies, stores the result, creates the
  // pending ticket on a pass, and writes the audit row — all atomically.
  const { data, error } = await supabase.rpc("close_pitch_vote", {
    p_pitch_id: pitch.id,
  });
  if (error) {
    return NextResponse.json(
      { error: `The vote could not be closed: ${error.message}` },
      { status: 400 }
    );
  }
  const result = data as CloseResult;

  if (result.already_closed === true) {
    return NextResponse.json({ result, alreadyClosed: true });
  }

  const passed = result.status === "passed";
  const pct = formatPercent(
    result.result_pct === null ? null : Number(result.result_pct)
  );

  // Result email to the whole fund — always sent (SPEC Section 16).
  await sendToFund(supabase, ctx.fund.id, {
    subject: `Vote result: ${pitch.title} ${passed ? `passed at ${pct}` : "did not pass"}`,
    heading: passed ? `${pitch.title} passed` : `${pitch.title} did not pass`,
    bodyLines: [
      `The vote closed with ${result.votes_yes} yes / ${result.votes_no} no (${pct} yes).`,
      passed
        ? pitch.action === "rebalance"
          ? "The rebalance passed. An officer will apply the new sector targets from the admin page."
          : "A trade ticket is ready for the portfolio manager to execute."
        : `It needed ${formatPercent(
            Number(result.threshold_pct ?? ctx.fund.vote_pass_threshold_pct)
          )} yes to pass.`,
    ],
    ctaLabel: "View the pitch",
    ctaPath: `/${ctx.fund.slug}/pitches/${pitch.id}`,
    essential: true,
  });

  // "Ticket ready" to the PM and the faculty advisor on a pass.
  if (passed && pitch.action !== "rebalance") {
    const ticketContent = {
      subject: `Ticket ready: ${pitch.title}`,
      heading: "A trade ticket is ready",
      bodyLines: [
        `${pitch.title} passed at ${pct} (${result.votes_yes} yes / ${result.votes_no} no).`,
        "A pending ticket was created from the pitch. Record the execution once the trade is placed.",
      ],
      ctaLabel: "Open pending tickets",
      ctaPath: `/${ctx.fund.slug}/admin/tickets`,
    };
    await sendToFund(supabase, ctx.fund.id, {
      ...ticketContent,
      roles: ["portfolio_manager"],
      essential: true,
    });
    // Advisor profiles are visible here only when RLS allows (e.g. the
    // advisor holds a membership). The nightly cron covers the service-role
    // path; this is best-effort for officer-closed votes.
    const { data: advisors } = await supabase
      .from("profiles")
      .select("email")
      .eq("is_faculty_advisor", true);
    const advisorEmails = ((advisors as { email: string | null }[] | null) ?? [])
      .map((a) => a.email)
      .filter((e): e is string => Boolean(e));
    if (advisorEmails.length > 0) {
      await sendEmail({
        to: advisorEmails,
        ...ticketContent,
        fundSlug: ctx.fund.slug,
      });
    }
  }

  return NextResponse.json({ result });
}
