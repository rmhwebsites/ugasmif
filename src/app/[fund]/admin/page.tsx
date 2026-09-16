// /[fund]/admin — the officer checklist (SPEC 11.3): pending tickets, stale
// marks, pitches awaiting scheduling, votes closing today, last backup.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { hasFundAdminAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/Badge";
import { RunBackupButton } from "@/components/admin/RunBackupButton";
import { formatDate, formatDateTime } from "@/lib/format";
import type {
  BackupRun,
  BondMark,
  Holding,
  Membership,
  Pitch,
  Profile,
  TradeTicket,
} from "@/types/domain";

export const metadata: Metadata = { title: "Fund Admin" };

type MemberRow = Membership & { profiles: Pick<Profile, "full_name" | "created_at"> | null };

export default async function AdminChecklistPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!hasFundAdminAccess(ctx)) notFound();

  const supabase = await createSupabaseServerClient();
  const staleDays = Number(ctx.fund.settings.stale_mark_days ?? 7);
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);

  const [ticketsRes, pitchesRes, votingRes, holdingsRes, marksRes, backupRes, recentMembersRes] =
    await Promise.all([
      supabase
        .from("trade_tickets")
        .select("*")
        .eq("fund_id", ctx.fund.id)
        .eq("status", "pending")
        .order("created_at"),
      supabase
        .from("pitches")
        .select("*")
        .eq("fund_id", ctx.fund.id)
        .eq("status", "submitted")
        .order("created_at"),
      supabase
        .from("pitches")
        .select("*")
        .eq("fund_id", ctx.fund.id)
        .eq("status", "voting")
        .order("vote_closes_at"),
      supabase
        .from("holdings")
        .select("*")
        .eq("fund_id", ctx.fund.id)
        .eq("is_active", true)
        .eq("pricing_method", "manual"),
      supabase.from("bond_marks").select("*").order("marked_at", { ascending: false }),
      supabase
        .from("backup_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1),
      supabase
        .from("memberships")
        .select("*, profiles(full_name, created_at)")
        .eq("fund_id", ctx.fund.id)
        .eq("academic_year_id", ctx.currentYear.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const tickets = (ticketsRes.data as TradeTicket[]) ?? [];
  const submitted = (pitchesRes.data as Pitch[]) ?? [];
  const voting = (votingRes.data as Pitch[]) ?? [];
  const manualHoldings = (holdingsRes.data as Holding[]) ?? [];
  const marks = (marksRes.data as BondMark[]) ?? [];
  const lastBackup = ((backupRes.data as BackupRun[]) ?? [])[0] ?? null;
  const recentMembers = (recentMembersRes.data as MemberRow[]) ?? [];

  const latestMarkByHolding = new Map<string, BondMark>();
  for (const m of marks) {
    if (!latestMarkByHolding.has(m.holding_id)) {
      latestMarkByHolding.set(m.holding_id, m);
    }
  }
  const staleCutoff = now.getTime() - staleDays * 24 * 60 * 60 * 1000;
  const staleMarks = manualHoldings
    .map((h) => ({ holding: h, mark: latestMarkByHolding.get(h.id) ?? null }))
    .filter(
      ({ mark }) => !mark || new Date(mark.marked_at).getTime() < staleCutoff
    );

  const closingToday = voting.filter(
    (p) => p.vote_closes_at && new Date(p.vote_closes_at) <= endOfToday
  );
  const invitedRecently = recentMembers.filter((m) => {
    const created = m.profiles?.created_at;
    return created
      ? now.getTime() - new Date(created).getTime() < 30 * 24 * 60 * 60 * 1000
      : false;
  });

  const items = [
    {
      title: "Pending trade tickets",
      count: tickets.length,
      href: `/${ctx.fund.slug}/admin/tickets`,
      detail:
        tickets.length > 0
          ? tickets.map((t) => `${t.action} ${t.symbol ?? t.name}`).join(", ")
          : "Nothing waiting on the PM.",
      urgent: tickets.length > 0,
    },
    {
      title: "Stale bond marks",
      count: staleMarks.length,
      href: `/${ctx.fund.slug}/admin/holdings`,
      detail:
        staleMarks.length > 0
          ? `Older than ${staleDays} days: ${staleMarks
              .slice(0, 4)
              .map(({ holding }) => holding.name)
              .join(", ")}${staleMarks.length > 4 ? "…" : ""}`
          : "All manual marks are fresh.",
      urgent: staleMarks.length > 0,
      hidden: ctx.fund.asset_class !== "fixed_income",
    },
    {
      title: "Pitches awaiting scheduling",
      count: submitted.length,
      href: `/${ctx.fund.slug}/admin/pitches`,
      detail:
        submitted.length > 0
          ? submitted.map((p) => p.title).join(", ")
          : "No submitted pitches in the queue.",
      urgent: submitted.length > 0,
    },
    {
      title: "Votes closing today",
      count: closingToday.length,
      href: `/${ctx.fund.slug}/admin/pitches`,
      detail:
        closingToday.length > 0
          ? closingToday
              .map(
                (p) => `${p.title} at ${formatDateTime(p.vote_closes_at)}`
              )
              .join(", ")
          : voting.length > 0
          ? `${voting.length} open ${voting.length === 1 ? "vote" : "votes"}, none closing today.`
          : "No open votes.",
      urgent: closingToday.length > 0,
    },
  ].filter((i) => !i.hidden);

  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Fund Admin</h1>

      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        {items.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="glass-card block p-4 transition-colors hover:bg-highlight sm:p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{item.title}</h2>
              <Badge tone={item.urgent ? "accent" : "neutral"}>
                {item.count}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted">
              {item.detail}
            </p>
          </Link>
        ))}
      </div>

      {/* Backup status */}
      <section className="glass-card flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">Nightly backup</h2>
          <p className="mt-0.5 text-sm text-muted">
            {lastBackup ? (
              <>
                Last run {formatDateTime(lastBackup.started_at)} ·{" "}
                <span
                  className={
                    lastBackup.status === "ok"
                      ? "text-gain"
                      : lastBackup.status === "failed"
                      ? "text-loss"
                      : ""
                  }
                >
                  {lastBackup.status}
                </span>
                {lastBackup.rows_written !== null && (
                  <> · {lastBackup.rows_written} rows</>
                )}
              </>
            ) : (
              "No backup has run yet."
            )}
          </p>
        </div>
        <RunBackupButton />
      </section>

      {/* Recently invited */}
      <section className="glass-card p-4 sm:p-5">
        <h2 className="font-semibold">Recently invited members</h2>
        <p className="mt-0.5 text-sm text-muted">
          Accounts created in the last 30 days. If someone can&apos;t sign in,
          resend their invite from the members page.
        </p>
        {invitedRecently.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {invitedRecently.map((m) => (
              <li key={m.id} className="rounded-lg bg-highlight px-3 py-1">
                {m.profiles?.full_name ?? "—"}
                <span className="text-muted">
                  {" "}
                  · {formatDate(m.profiles?.created_at ?? null)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">None.</p>
        )}
      </section>
    </div>
  );
}
