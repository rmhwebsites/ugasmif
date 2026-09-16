// /[fund]/admin/holdings — add/edit holdings, bond marks, CSV uploads, cash
// movements, snapshot history import (SPEC 11.3). canExecute for the write
// tools; the admin layout already gates to officers/advisor/admin.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HoldingsAdmin } from "@/components/admin/HoldingsAdmin";
import { HoldingForm } from "@/components/admin/HoldingForm";
import { CsvTool } from "@/components/admin/MarkEntry";
import { CashMovementForm } from "@/components/admin/CashMovementForm";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatCurrency } from "@/lib/format";
import type { BondMark, Holding, Sector } from "@/types/domain";

export const metadata: Metadata = { title: "Holdings Admin" };

export default async function HoldingsAdminPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  const writable = canExecute(ctx);

  const supabase = await createSupabaseServerClient();
  const [holdingsRes, sectorsRes, marksRes] = await Promise.all([
    supabase
      .from("holdings")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .order("is_active", { ascending: false })
      .order("name"),
    supabase
      .from("sectors")
      .select("id, name")
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("bond_marks")
      .select("*")
      .order("marked_at", { ascending: false }),
  ]);

  const holdings = (holdingsRes.data as Holding[]) ?? [];
  const sectors = (sectorsRes.data as Pick<Sector, "id" | "name">[]) ?? [];
  const holdingIds = new Set(holdings.map((h) => h.id));
  const latestMarks: Record<string, BondMark> = {};
  for (const m of (marksRes.data as BondMark[]) ?? []) {
    if (holdingIds.has(m.holding_id) && !latestMarks[m.holding_id]) {
      latestMarks[m.holding_id] = m;
    }
  }

  if (!writable) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="font-medium">Portfolio Manager tools</p>
        <p className="mt-1 text-sm text-muted">
          Only the fund&apos;s PM, the faculty advisor, or an app admin can
          manage holdings. You can view holdings on the member page.
        </p>
      </div>
    );
  }

  const isFixedIncome = ctx.fund.asset_class === "fixed_income";

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">Holdings Admin</h1>
        <p className="text-sm text-muted">
          Cash balance{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatCurrency(Number(ctx.fund.cash_balance))}
          </span>
        </p>
      </div>

      <HoldingsAdmin
        fund={ctx.fund.slug}
        holdings={holdings}
        sectors={sectors}
        latestMarks={latestMarks}
        staleDays={Number(ctx.fund.settings.stale_mark_days ?? 7)}
      />

      <Card>
        <CardHeader title="Add a holding" />
        <div className="p-4 sm:p-6">
          <HoldingForm fund={ctx.fund.slug} sectors={sectors} />
        </div>
      </Card>

      {isFixedIncome && (
        <Card>
          <CardHeader title="Upload marks CSV" />
          <div className="p-4 sm:p-6">
            <CsvTool
              title="Weekly Bloomberg marks"
              hint="Columns: cusip,clean_price,ytm,duration,source,marked_at — matched to holdings by CUSIP."
              placeholder={"cusip,clean_price,ytm,duration,source,marked_at\n26442CBD5,98.750,5.125,7.2,bloomberg,2026-09-12"}
              endpoint={`/api/${ctx.fund.slug}/marks/csv`}
              resultLabel={(r) => `Inserted ${r.inserted} marks.`}
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Cash movements" />
        <div className="p-4 sm:p-6">
          <CashMovementForm
            fund={ctx.fund.slug}
            holdings={holdings.filter((h) => h.is_active)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Import snapshot history" />
        <div className="p-4 sm:p-6">
          <CsvTool
            title="Backfill fund values"
            hint="Columns: date,total_value,cash — extends the performance chart with monthly values from old newsletters."
            placeholder={"date,total_value,cash\n2024-09-30,4321000,45000"}
            endpoint={`/api/${ctx.fund.slug}/snapshots/import`}
            resultLabel={(r) => `Imported ${r.imported} snapshots.`}
          />
        </div>
      </Card>
    </div>
  );
}
