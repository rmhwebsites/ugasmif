// GET /api/[fund]/portfolio/history?period=1mo|3mo|ytd|1y|all
// Fund value + benchmark series for the dashboard chart, read from
// fund_snapshots under the caller's RLS. Benchmark points use adjusted
// close (total return) and fall back to close; rows without either are
// skipped so the line never dips to zero.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { easternDateString } from "@/lib/format";
import type { ChartPoint } from "@/types/domain";

const querySchema = z.object({
  period: z.enum(["1mo", "3mo", "ytd", "1y", "all"]).default("3mo"),
});

interface SnapshotRow {
  snapshot_date: string;
  total_value: number | string;
  benchmark_close: number | string | null;
  benchmark_adj_close: number | string | null;
}

/** `today` (YYYY-MM-DD) shifted back n months; day clamps to 28 for safety. */
function monthsAgo(today: string, n: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, Math.min(d, 28)))
    .toISOString()
    .slice(0, 10);
}

function rangeStart(period: string, today: string): string | null {
  switch (period) {
    case "1mo":
      return monthsAgo(today, 1);
    case "3mo":
      return monthsAgo(today, 3);
    case "ytd":
      return `${today.slice(0, 4)}-01-01`;
    case "1y":
      return monthsAgo(today, 12);
    default:
      return null; // all
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "view_fund")) {
    return NextResponse.json(
      { error: "You do not have access to this fund" },
      { status: 403 }
    );
  }

  const parsed = querySchema.safeParse({
    period: request.nextUrl.searchParams.get("period") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid period — use 1mo, 3mo, ytd, 1y or all" },
      { status: 400 }
    );
  }

  const { supabase } = await getAuthState();
  const start = rangeStart(parsed.data.period, easternDateString());

  let query = supabase
    .from("fund_snapshots")
    .select("snapshot_date, total_value, benchmark_close, benchmark_adj_close")
    .eq("fund_id", ctx.fund.id)
    .order("snapshot_date", { ascending: true });
  if (start) query = query.gte("snapshot_date", start);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Could not load snapshot history" },
      { status: 500 }
    );
  }

  const rows = (data as SnapshotRow[] | null) ?? [];
  const points: ChartPoint[] = [];
  const benchmark: ChartPoint[] = [];

  for (const row of rows) {
    const time = row.snapshot_date.slice(0, 10);
    const value = Number(row.total_value);
    if (Number.isFinite(value)) points.push({ time, value });

    const benchRaw = row.benchmark_adj_close ?? row.benchmark_close;
    if (benchRaw !== null) {
      const benchValue = Number(benchRaw);
      if (Number.isFinite(benchValue) && benchValue > 0) {
        benchmark.push({ time, value: benchValue });
      }
    }
  }

  return NextResponse.json({ points, benchmark });
}
