// GET /api/market/history/[symbol]?period=1y — price history for charts.
// Requires a signed-in user; not fund-scoped.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/fund";
import { getHistory, type HistoryPeriod } from "@/lib/yahoo";

const HISTORY_PERIODS = [
  "1d",
  "5d",
  "1mo",
  "3mo",
  "6mo",
  "ytd",
  "1y",
  "5y",
  "max",
] as const satisfies readonly HistoryPeriod[];

const paramsSchema = z.object({
  symbol: z
    .string()
    .regex(/^[A-Za-z0-9^.\-=]{1,15}$/, "invalid symbol"),
  period: z.enum(HISTORY_PERIODS).default("1y"),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { symbol } = await params;
  const parsed = paramsSchema.safeParse({
    symbol: decodeURIComponent(symbol),
    period: request.nextUrl.searchParams.get("period") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const points = await getHistory(parsed.data.symbol, parsed.data.period);
  return NextResponse.json({ points });
}
