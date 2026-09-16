// POST /api/[fund]/tickets/[id]/cancel — cancel a pending ticket with a
// required reason (SPEC 12: "cancel ticket"). The ticket goes to 'cancelled'
// with the reason in its notes; a linked passed pitch STAYS 'passed' and gets
// a "not executed" note in its settings. Audit-logged as 'ticket.cancel';
// the PM and the faculty advisor are emailed.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { sendEmail, sendToFund } from "@/lib/emails/send";
import { easternDateString } from "@/lib/format";
import type { TradeTicket } from "@/types/domain";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z
    .string({ error: "A cancellation reason is required." })
    .trim()
    .min(1, "A cancellation reason is required."),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canExecute(ctx)) {
    return NextResponse.json(
      {
        error:
          "Only the portfolio manager, faculty advisor, or an app admin can cancel trade tickets.",
      },
      { status: 403 }
    );
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }
  const reason = parsed.data.reason;

  const supabase = await createSupabaseServerClient();

  const { data: ticketRow } = await supabase
    .from("trade_tickets")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  const ticket = (ticketRow as TradeTicket) ?? null;
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (ticket.status !== "pending") {
    return NextResponse.json(
      {
        error: `Ticket is ${ticket.status}; only pending tickets can be cancelled.`,
      },
      { status: 400 }
    );
  }

  const cancelNote = `Cancelled by ${ctx.profile.full_name} on ${easternDateString()}: ${reason}`;
  const notes = ticket.notes ? `${ticket.notes}\n${cancelNote}` : cancelNote;

  const { data: updatedRow, error } = await supabase
    .from("trade_tickets")
    .update({ status: "cancelled", notes })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .single();
  if (error) {
    return NextResponse.json(
      { error: `Could not cancel the ticket: ${error.message}` },
      { status: 400 }
    );
  }
  const updated = updatedRow as TradeTicket;

  // The linked pitch stays 'passed' — record a "not executed" note on it.
  // Best-effort: an advisor may lack pitch-update rights under RLS, and the
  // note must never block the cancellation itself.
  if (ticket.pitch_id) {
    const { data: pitchRow } = await supabase
      .from("pitches")
      .select("id, status, settings")
      .eq("id", ticket.pitch_id)
      .maybeSingle();
    const pitch = pitchRow as {
      id: string;
      status: string;
      settings: Record<string, unknown> | null;
    } | null;
    if (pitch && pitch.status === "passed") {
      const { error: pitchError } = await supabase
        .from("pitches")
        .update({
          settings: {
            ...(pitch.settings ?? {}),
            not_executed_note: `Ticket cancelled: ${reason}`,
            ticket_cancelled_at: new Date().toISOString(),
          },
        })
        .eq("id", pitch.id);
      if (pitchError) {
        console.error(
          `ticket cancel: could not note pitch ${pitch.id}:`,
          pitchError.message
        );
      }
    }
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "ticket.cancel",
    entity: "trade_tickets",
    entityId: ticket.id,
    before: ticket,
    after: updated,
  });

  // Email the PM and the faculty advisor (spec 12 "cancel ticket").
  const emailContent = {
    subject: `Ticket cancelled: ${ticket.name}`,
    heading: `Ticket cancelled — ${ticket.name}`,
    bodyLines: [
      `${ctx.profile.full_name} cancelled the ${ticket.action} ticket for ${
        ticket.name
      }${ticket.symbol ? ` (${ticket.symbol})` : ""}.`,
      `Reason: ${reason}`,
      ...(ticket.pitch_id
        ? ["The linked pitch stays passed and is marked as not executed."]
        : []),
    ],
    ctaLabel: "View tickets",
    ctaPath: `/${ctx.fund.slug}/admin/tickets`,
  };
  await sendToFund(supabase, ctx.fund.id, {
    ...emailContent,
    roles: ["portfolio_manager"],
    essential: true,
  });
  // Advisors hold a global flag, not a membership, so they need a direct
  // send. Best-effort: RLS only exposes their profile rows to some callers.
  const { data: advisorRows } = await supabase
    .from("profiles")
    .select("email")
    .eq("is_faculty_advisor", true);
  const advisorEmails = ((advisorRows as { email: string | null }[]) ?? [])
    .map((a) => a.email)
    .filter((e): e is string => Boolean(e));
  if (advisorEmails.length > 0) {
    await sendEmail({
      to: advisorEmails,
      ...emailContent,
      fundSlug: ctx.fund.slug,
    });
  }

  return NextResponse.json({ ok: true, ticket: updated });
}
