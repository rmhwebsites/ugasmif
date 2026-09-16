// Daily cron (06:00 UTC, vercel.json): close pitches whose vote window has
// expired via the close_pitch_vote RPC and email the result to the fund
// (plus "Ticket ready" to the PM and faculty advisor on a pass), then send
// reminder emails for votes closing within 24h to eligible members who have
// not voted (spec Sections 12, 13.6, 16). Bearer CRON_SECRET only.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, sendToFund } from "@/lib/emails/send";
import { formatDateTime, formatPercent } from "@/lib/format";
import type { AcademicYear, Fund, Pitch } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Shape of the close_pitch_vote RPC's jsonb result. */
interface CloseResult {
  status: string;
  result_pct: number | null;
  votes_yes: number;
  votes_no: number;
  eligible_voters?: number | null;
  already_closed?: boolean;
}

interface EligibleVoterRow {
  user_id: string;
  profiles: {
    email: string | null;
    email_prefs: { mute_reminders?: boolean } | null;
  } | null;
}

interface ClosedEntry {
  pitch: string;
  title: string;
  status: string;
  error?: string;
}

interface RemindedEntry {
  pitch: string;
  title: string;
  nonVoters: number;
  error?: string;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3_600_000);
  const closed: ClosedEntry[] = [];
  const reminded: RemindedEntry[] = [];

  try {
    const { data: pitchRows, error: pitchError } = await service
      .from("pitches")
      .select("*")
      .eq("status", "voting")
      .not("vote_closes_at", "is", null);
    if (pitchError) throw new Error(pitchError.message);
    const pitches = (pitchRows as Pitch[]) ?? [];

    const { data: fundRows, error: fundsError } = await service
      .from("funds")
      .select("*");
    if (fundsError) throw new Error(fundsError.message);
    const fundById = new Map(((fundRows as Fund[]) ?? []).map((f) => [f.id, f]));

    const { data: yearRow } = await service
      .from("academic_years")
      .select("*")
      .eq("is_current", true)
      .maybeSingle();
    const currentYear = (yearRow as AcademicYear | null) ?? null;

    // ── Close expired votes ────────────────────────────────────────────────
    const expired = pitches.filter(
      (p) => p.vote_closes_at !== null && new Date(p.vote_closes_at) < now
    );
    for (const pitch of expired) {
      const fund = fundById.get(pitch.fund_id);
      try {
        const { data, error } = await service.rpc("close_pitch_vote", {
          p_pitch_id: pitch.id,
        });
        if (error) throw new Error(error.message);
        const result = data as CloseResult;
        closed.push({ pitch: pitch.id, title: pitch.title, status: result.status });
        if (!fund || result.already_closed === true) continue;

        const passed = result.status === "passed";
        const pct = formatPercent(
          result.result_pct === null ? null : Number(result.result_pct)
        );

        // Result email to the whole fund — always sent (spec Section 16).
        await sendToFund(service, fund.id, {
          subject: `Vote result: ${pitch.title} ${passed ? `passed at ${pct}` : "did not pass"}`,
          heading: passed
            ? `${pitch.title} passed`
            : `${pitch.title} did not pass`,
          bodyLines: [
            `The vote closed with ${result.votes_yes} yes / ${result.votes_no} no (${pct} yes).`,
            passed
              ? pitch.action === "rebalance"
                ? "The rebalance passed. An officer will apply the new sector targets from the admin page."
                : "A trade ticket is ready for the portfolio manager to execute."
              : `It needed ${formatPercent(Number(fund.vote_pass_threshold_pct))} yes to pass.`,
          ],
          ctaLabel: "View the pitch",
          ctaPath: `/${fund.slug}/pitches/${pitch.id}`,
          essential: true,
        });

        // "Ticket ready" to the PM and the faculty advisor (spec Section 16).
        if (passed && pitch.action !== "rebalance") {
          const ticketContent = {
            subject: `Ticket ready: ${pitch.title}`,
            heading: "A trade ticket is ready",
            bodyLines: [
              `${pitch.title} passed at ${pct} (${result.votes_yes} yes / ${result.votes_no} no).`,
              "A pending ticket was created from the pitch. Record the execution once the trade is placed.",
            ],
            ctaLabel: "Open pending tickets",
            ctaPath: `/${fund.slug}/admin/tickets`,
          };
          await sendToFund(service, fund.id, {
            ...ticketContent,
            roles: ["portfolio_manager"],
            essential: true,
          });
          const { data: advisors } = await service
            .from("profiles")
            .select("email")
            .eq("is_faculty_advisor", true);
          const advisorEmails = ((advisors as { email: string | null }[]) ?? [])
            .map((a) => a.email)
            .filter((e): e is string => Boolean(e));
          if (advisorEmails.length > 0) {
            await sendEmail({
              to: advisorEmails,
              ...ticketContent,
              fundSlug: fund.slug,
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`cron votes: close failed for pitch ${pitch.id}:`, err);
        closed.push({
          pitch: pitch.id,
          title: pitch.title,
          status: "error",
          error: message,
        });
      }
    }

    // ── Reminders for votes closing within 24h ─────────────────────────────
    const closingSoon = pitches.filter((p) => {
      if (!p.vote_closes_at) return false;
      const closes = new Date(p.vote_closes_at);
      return closes >= now && closes <= in24h;
    });
    for (const pitch of closingSoon) {
      const fund = fundById.get(pitch.fund_id);
      if (!fund || !currentYear) continue;
      try {
        const { data: voteRows, error: votesError } = await service
          .from("votes")
          .select("voter_id")
          .eq("pitch_id", pitch.id);
        if (votesError) throw new Error(votesError.message);
        const voted = new Set(
          ((voteRows as { voter_id: string }[]) ?? []).map((v) => v.voter_id)
        );

        // Eligible voters: active members of the fund this year, role != viewer.
        const { data: memberRows, error: membersError } = await service
          .from("memberships")
          .select("user_id, profiles(email, email_prefs)")
          .eq("fund_id", fund.id)
          .eq("academic_year_id", currentYear.id)
          .eq("status", "active")
          .neq("role", "viewer");
        if (membersError) throw new Error(membersError.message);

        const to: string[] = [];
        for (const row of (memberRows as unknown as EligibleVoterRow[]) ?? []) {
          if (voted.has(row.user_id)) continue;
          const profile = row.profiles;
          if (!profile?.email) continue;
          // Reminders are non-essential — respect the mute (spec Section 16).
          if (profile.email_prefs?.mute_reminders === true) continue;
          to.push(profile.email);
        }
        if (to.length > 0) {
          await sendEmail({
            to,
            subject: `Vote reminder: ${pitch.title} closes ${formatDateTime(pitch.vote_closes_at)} ET`,
            heading: "You have not voted yet",
            bodyLines: [
              `Voting on "${pitch.title}" closes ${formatDateTime(pitch.vote_closes_at)} ET.`,
              "Your vote counts toward quorum. Casting it takes under a minute.",
            ],
            ctaLabel: "Cast your vote",
            ctaPath: `/${fund.slug}/pitches/${pitch.id}`,
            fundSlug: fund.slug,
          });
        }
        reminded.push({ pitch: pitch.id, title: pitch.title, nonVoters: to.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`cron votes: reminder failed for pitch ${pitch.id}:`, err);
        reminded.push({
          pitch: pitch.id,
          title: pitch.title,
          nonVoters: 0,
          error: message,
        });
      }
    }

    const summary = {
      ok: closed.every((c) => !c.error) && reminded.every((r) => !r.error),
      closed,
      reminded,
    };

    await service.from("audit_log").insert({
      actor_id: null,
      fund_id: null,
      action: "cron.votes",
      entity: "pitches",
      entity_id: null,
      after: summary,
    });

    return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("cron votes failed:", err);
    return NextResponse.json(
      { ok: false, error: message, closed, reminded },
      { status: 500 }
    );
  }
}
