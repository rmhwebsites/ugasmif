// /[fund]/holdings — full holdings table (SPEC 11.2). Server component:
// resolves the fund context, values the fund once via valueFund, renders the
// summary line (positions, securities value, cash, total) and the sortable,
// filterable HoldingsTable client component.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Holdings" };

export default async function HoldingsPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const supabase = await createSupabaseServerClient();
  const valuation = await valueFund(supabase, ctx.fund.id);
  const positions = valuation.holdings.length;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">Holdings</h1>
        <p className="text-xs text-muted">
          As of {formatDateTime(valuation.asOf)} ET
        </p>
      </div>

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
        <span className="text-muted">
          Cash{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatCurrency(valuation.cash)}
          </span>
        </span>
        <span className="text-muted">
          Total{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatCurrency(valuation.totalValue)}
          </span>
        </span>
        {valuation.anyStale && (
          <Badge
            tone="warn"
            title="At least one holding is priced from delayed data — a stale quote, an old mark, or a missing curve."
          >
            delayed data
          </Badge>
        )}
      </div>

      <HoldingsTable
        holdings={valuation.holdings}
        fund={ctx.fund.slug}
        assetClass={ctx.fund.asset_class}
      />
    </div>
  );
}
