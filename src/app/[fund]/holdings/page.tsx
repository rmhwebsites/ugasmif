// /[fund]/holdings — full holdings table (SPEC 11.2). Server component:
// resolves the fund context, values the fund once via valueFund, renders the
// portfolio value chart (the same card as the dashboard's, so the book's
// value over time sits right above what it is made of), the summary line
// (positions, securities value, cash, total) and the sortable, filterable
// HoldingsTable client component.
//
// The summary's figures lead somewhere: the PM's cash figure opens the cash
// form on Manage holdings, and a stale-price count filters the table to the
// stale rows (?price=stale), with a way to the marks for the people who
// enter them.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";
import { AlumniNotice } from "@/components/ui/AlumniNotice";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { ManageLink, PageHeader } from "@/components/ui/PageHeader";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Holdings" };

export default async function HoldingsPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!ctx.canViewCurrent) {
    return (
      <div className="space-y-6">
        <PageHeader title="Holdings" />
        <AlumniNotice fundName={ctx.fund.name} />
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const valuation = await valueFund(supabase, ctx.fund.id);
  const positions = valuation.holdings.length;
  const fund = ctx.fund.slug;
  const manages = can(ctx, "manage_holdings");
  const adminHref = `/${fund}/admin/holdings`;

  const sectorSlugs = Object.fromEntries(
    valuation.sectors.map((s) => [s.sectorId, s.sectorSlug])
  );

  const stale = valuation.holdings.filter((v) => v.stale);
  // Manual marks are the stale prices someone fixes by hand, and the ones
  // Manage holdings lists under ?stale=1. A live quote that did not come
  // through fixes itself on the next refresh.
  const staleMarks = stale.filter(
    (v) => v.holding.pricing_method === "manual"
  ).length;

  const header = (
    <PageHeader
      title="Holdings"
      description={`Every position the fund holds, as of ${formatDateTime(valuation.asOf)} ET.`}
      actions={
        manages ? (
          <ManageLink href={adminHref}>Manage holdings</ManageLink>
        ) : undefined
      }
    />
  );

  if (positions === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          title="No holdings yet"
          hint={
            manages
              ? "Open a position with a buy ticket, which records the trade and the cash, or add one directly in Manage holdings."
              : "Positions appear here once the portfolio manager records a trade."
          }
          action={
            manages ? (
              <ManageLink href={adminHref}>Manage holdings</ManageLink>
            ) : undefined
          }
        />
      </div>
    );
  }

  const cashFigure = (
    <span className="font-semibold text-foreground tabular-nums">
      {formatCurrency(valuation.cash)}
    </span>
  );

  return (
    <div className="space-y-6">
      {header}

      <DashboardCharts
        fund={fund}
        totalValue={valuation.totalValue}
        dayChange={valuation.dayChange}
        dayChangePct={valuation.dayChangePct}
        benchmarkName={ctx.fund.benchmark_name}
      />

      {/* Summary line */}
      <div className="glass-card flex flex-wrap items-center gap-x-6 gap-y-1.5 px-4 py-3 text-sm sm:px-6">
        <span className="tabular-nums">
          <span className="font-semibold">{positions}</span>{" "}
          <span className="text-muted">
            {positions === 1 ? "position" : "positions"}
          </span>
        </span>
        <span className="text-muted">
          Securities{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatCurrency(valuation.securitiesValue)}
          </span>
        </span>
        {manages ? (
          <Link
            href={`${adminHref}#cash`}
            title="Record a cash movement in Manage holdings"
            className="group text-muted transition-colors hover:text-foreground"
          >
            Cash{" "}
            <span className="underline decoration-muted/60 decoration-dotted underline-offset-4 group-hover:decoration-accent">
              {cashFigure}
            </span>
          </Link>
        ) : (
          <span className="text-muted">Cash {cashFigure}</span>
        )}
        <span className="text-muted">
          Total{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatCurrency(valuation.totalValue)}
          </span>
        </span>
        {stale.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <Link
              href={`/${fund}/holdings?price=stale`}
              scroll={false}
              title="Prices that are out of date: an old mark, a missing quote or no Treasury curve. Show only those holdings."
              className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 font-medium text-yellow-500 transition-colors hover:bg-yellow-500/25"
            >
              <span className="tabular-nums">{stale.length}</span>
              {stale.length === 1 ? "stale price" : "stale prices"}
            </Link>
            {manages && staleMarks > 0 && (
              <Link
                href={`${adminHref}?stale=1`}
                className="font-medium text-accent-text hover:underline"
              >
                Enter marks
              </Link>
            )}
          </span>
        )}
      </div>

      <HoldingsTable
        holdings={valuation.holdings}
        fund={fund}
        assetClass={ctx.fund.asset_class}
        sectorSlugs={sectorSlugs}
      />
    </div>
  );
}
