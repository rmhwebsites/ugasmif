// Outbound email via Resend (spec Section 16). `sendEmail` never throws —
// failures are logged and swallowed so email problems can never break a
// route. When RESEND_API_KEY is unset every send is silently skipped.

import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FundSlug, MembershipRole } from "@/types/domain";
import { renderEmail } from "@/lib/emails/templates";

export interface SendEmailOptions {
  to: string[];
  subject: string;
  heading: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaPath?: string;
  fundSlug?: FundSlug;
  /** Optional reply-to (the fund president's address, from fund settings). */
  replyTo?: string;
}

const BATCH_SIZE = 100; // Resend batch endpoint limit

/**
 * Sends one branded email to each address. Multiple recipients are sent as
 * individual messages through `resend.batch` (no shared To/CC/BCC line), so
 * members never see each other's addresses. Never throws.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return; // not configured: skip silently

    const to = [
      ...new Set(
        opts.to.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))
      ),
    ];
    if (to.length === 0) return;

    const from = process.env.EMAIL_FROM ?? "SMIF Hub <onboarding@resend.dev>";
    const { html, text } = renderEmail({
      heading: opts.heading,
      bodyLines: opts.bodyLines,
      ctaLabel: opts.ctaLabel,
      ctaPath: opts.ctaPath,
      fundSlug: opts.fundSlug,
    });

    const resend = new Resend(apiKey);
    const base = {
      from,
      subject: opts.subject,
      html,
      text,
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    };

    if (to.length === 1) {
      const { error } = await resend.emails.send({ ...base, to });
      if (error) console.error("sendEmail: resend error:", error);
      return;
    }

    for (let i = 0; i < to.length; i += BATCH_SIZE) {
      const chunk = to.slice(i, i + BATCH_SIZE);
      const { error } = await resend.batch.send(
        chunk.map((address) => ({ ...base, to: [address] }))
      );
      if (error) console.error("sendEmail: resend batch error:", error);
    }
  } catch (err) {
    console.error("sendEmail failed:", err);
  }
}

interface FundRecipientRow {
  role: MembershipRole;
  profiles: {
    email: string | null;
    full_name: string | null;
    email_prefs: { mute_updates?: boolean; mute_reminders?: boolean } | null;
  } | null;
}

export interface SendToFundOptions {
  subject: string;
  heading: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaPath?: string;
  /** true = always sent (vote opened/result, trade executed); mutes ignored. */
  essential?: boolean;
  /** Restrict to these membership roles (e.g. ["portfolio_manager"]). */
  roles?: MembershipRole[];
  /**
   * Which mute flag applies when not essential. Defaults to respecting both
   * mute_updates and mute_reminders.
   */
  category?: "updates" | "reminders";
}

/**
 * Emails the active members of a fund (optionally filtered to roles).
 * Non-essential mail respects `profiles.email_prefs` mute flags. Never throws.
 */
export async function sendToFund(
  supabase: SupabaseClient,
  fundId: string,
  opts: SendToFundOptions
): Promise<void> {
  try {
    let query = supabase
      .from("memberships")
      .select("role, profiles(email, full_name, email_prefs)")
      .eq("fund_id", fundId)
      .eq("status", "active");
    if (opts.roles && opts.roles.length > 0) {
      query = query.in("role", opts.roles);
    }
    const { data, error } = await query;
    if (error) {
      console.error("sendToFund: membership query failed:", error.message);
      return;
    }

    const rows = (data as unknown as FundRecipientRow[]) ?? [];
    const to: string[] = [];
    for (const row of rows) {
      const profile = row.profiles;
      if (!profile?.email) continue;
      if (opts.essential !== true) {
        const prefs = profile.email_prefs ?? {};
        const muted =
          opts.category === "updates"
            ? prefs.mute_updates === true
            : opts.category === "reminders"
              ? prefs.mute_reminders === true
              : prefs.mute_updates === true || prefs.mute_reminders === true;
        if (muted) continue;
      }
      to.push(profile.email);
    }
    if (to.length === 0) return;

    const { data: fundRow } = await supabase
      .from("funds")
      .select("slug, settings")
      .eq("id", fundId)
      .maybeSingle();
    const fund = fundRow as {
      slug: FundSlug;
      settings: { reply_to_email?: string } | null;
    } | null;

    await sendEmail({
      to,
      subject: opts.subject,
      heading: opts.heading,
      bodyLines: opts.bodyLines,
      ctaLabel: opts.ctaLabel,
      ctaPath: opts.ctaPath,
      fundSlug: fund?.slug,
      replyTo: fund?.settings?.reply_to_email,
    });
  } catch (err) {
    console.error("sendToFund failed:", err);
  }
}
