// GET /api/[fund]/holdings/export — CSV of the current holdings table
// (SPEC 11.2 "Export CSV"). Any member of the fund (or advisor/admin) may
// export; the user-scoped client keeps RLS in force. Columns mirror the
// on-screen table for the fund's asset class; numbers are raw (no $ or %)
// so the file drops straight into Excel/Sheets.
//
// The table's filters ride along as query parameters (sector=<id> or
// "unassigned", type=, price=stale, q=), applied by the same function the
// table uses, so the file holds exactly the rows on screen. A sector page's
// table always sends its sector.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import { toCsv } from "@/lib/csv";
import { easternDateString } from "@/lib/format";
import {
  filterHoldings,
  type HoldingsFilter,
} from "@/components/holdings/holdingsFilter";
import type { HoldingValuation } from "@/types/domain";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ fund: z.enum(["athena", "arch"]) });

/** The table's filters from the query string; anything malformed is ignored. */
function filterFrom(search: URLSearchParams): HoldingsFilter {
  const text = (key: string, max: number) =>
    (search.get(key) ?? "").trim().slice(0, max);
  return {
    q: text("q", 100),
    sector: text("sector", 64),
    type: text("type", 32),
    staleOnly: search.get("price") === "stale",
  };
}

/** Round to `digits` decimals, empty cell for null/NaN. */
function num(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function gainPct(v: HoldingValuation): number | null {
  return v.costBasis > 0 ? (v.unrealizedGain / v.costBasis) * 100 : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const slug = parsed.data.fund;

  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "view_fund")) {
    return NextResponse.json(
      { error: "You must be a member of this fund to export holdings." },
      { status: 403 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const valuation = await valueFund(supabase, ctx.fund.id);
  const filter = filterFrom(request.nextUrl.searchParams);
  const holdings = filterHoldings(valuation.holdings, filter);
  const filtered = holdings.length !== valuation.holdings.length;

  let headers: string[];
  let rows: (string | number | null)[][];

  if (ctx.fund.asset_class === "equity") {
    headers = [
      "Symbol",
      "Name",
      "Sector",
      "Type",
      "Shares",
      "Price",
      "Day Change",
      "Day Change %",
      "Market Value",
      "Weight %",
      "Cost Basis",
      "Unrealized Gain",
      "Unrealized Gain %",
      "Price Source",
      "Stale",
    ];
    rows = holdings.map((v) => [
      v.holding.symbol,
      v.holding.name,
      v.sectorName,
      v.holding.instrument_type,
      num(Number(v.holding.quantity), 4),
      num(v.price),
      num(v.dayChange),
      num(v.dayChangePct, 2),
      num(v.marketValue),
      num(v.weightPct, 2),
      num(v.costBasis),
      num(v.unrealizedGain),
      num(gainPct(v), 2),
      v.priceSource,
      v.stale ? "yes" : "",
    ]);
  } else {
    headers = [
      "Symbol",
      "Name",
      "Type",
      "Sector",
      "CUSIP",
      "Face",
      "Coupon %",
      "Maturity",
      "Clean Price",
      "Price Source",
      "Marked At",
      "Accrued Interest",
      "Market Value",
      "Weight %",
      "Cost Basis",
      "Unrealized Gain",
      "YTM %",
      "Duration",
      "Rating",
      "Stale",
    ];
    rows = holdings.map((v) => [
      v.holding.symbol,
      v.holding.name,
      v.holding.instrument_type,
      v.sectorName,
      v.holding.cusip,
      num(Number(v.holding.quantity)),
      v.holding.coupon_rate !== null
        ? num(Number(v.holding.coupon_rate), 3)
        : null,
      v.holding.maturity_date,
      num(v.price, 3),
      v.priceSource,
      v.markedAt ? easternDateString(new Date(v.markedAt)) : null,
      num(v.accruedInterest),
      num(v.marketValue),
      num(v.weightPct, 2),
      num(v.costBasis),
      num(v.unrealizedGain),
      num(v.ytm, 2),
      num(v.duration, 2),
      v.holding.rating,
      v.stale ? "yes" : "",
    ]);
  }

  const csv = toCsv(headers, rows);
  const filename = `smif-${slug}-holdings${filtered ? "-filtered" : ""}-${easternDateString()}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
