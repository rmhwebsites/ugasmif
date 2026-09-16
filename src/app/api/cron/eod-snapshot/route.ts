// Daily cron (21:45 UTC weekdays, vercel.json): value each fund after the
// close and upsert a fund_snapshots row with the benchmark's close and
// adjusted close (spec 13.6). Drives every performance chart. Bearer
// CRON_SECRET only.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { valueFund } from "@/lib/valuation";
import { getDailyHistory } from "@/lib/yahoo";
import { easternDateString } from "@/lib/format";
import type { Fund } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const snapshotDate = easternDateString();
  const results: Array<{
    fund: string;
    totalValue: number;
    benchmarkClose: number | null;
    error?: string;
  }> = [];

  try {
    const { data: fundRows, error: fundsError } = await service
      .from("funds")
      .select("*")
      .order("slug");
    if (fundsError) throw new Error(fundsError.message);
    const funds = (fundRows as Fund[]) ?? [];

    for (const fund of funds) {
      try {
        const valuation = await valueFund(service, fund.id);

        // Benchmark: last daily bar within the past week (weekends/holidays).
        const from = new Date(Date.now() - 7 * 86_400_000);
        const history = await getDailyHistory(fund.benchmark_symbol, from);
        const last = history.length > 0 ? history[history.length - 1] : null;

        const detail = {
          holdings: valuation.holdings.map((h) => ({
            id: h.holding.id,
            symbol: h.holding.symbol,
            name: h.holding.name,
            instrument_type: h.holding.instrument_type,
            price: h.price,
            priceSource: h.priceSource,
            marketValue: round2(h.marketValue),
            weightPct: h.weightPct,
          })),
          sectors: valuation.sectors.map((s) => ({
            sectorId: s.sectorId,
            sectorName: s.sectorName,
            marketValue: round2(s.marketValue),
            weightPct: s.weightPct,
            targetWeightPct: s.targetWeightPct,
            benchmarkWeightPct: s.benchmarkWeightPct,
          })),
          weightedDuration: valuation.weightedDuration,
          weightedYtm: valuation.weightedYtm,
          byInstrumentType: valuation.byInstrumentType,
          anyStale: valuation.anyStale,
        };

        const { error: upsertError } = await service.from("fund_snapshots").upsert(
          {
            fund_id: fund.id,
            snapshot_date: snapshotDate,
            market_value: round2(valuation.securitiesValue),
            cash: round2(valuation.cash),
            total_value: round2(valuation.totalValue),
            benchmark_symbol: fund.benchmark_symbol,
            benchmark_close: last?.close ?? null,
            benchmark_adj_close: last?.adjClose ?? null,
            detail,
          },
          { onConflict: "fund_id,snapshot_date" }
        );
        if (upsertError) throw new Error(upsertError.message);

        results.push({
          fund: fund.slug,
          totalValue: round2(valuation.totalValue),
          benchmarkClose: last?.close ?? null,
        });
      } catch (fundErr) {
        const message =
          fundErr instanceof Error ? fundErr.message : String(fundErr);
        console.error(`cron eod-snapshot: ${fund.slug} failed:`, fundErr);
        results.push({
          fund: fund.slug,
          totalValue: 0,
          benchmarkClose: null,
          error: message,
        });
      }
    }

    const summary = {
      ok: results.every((r) => !r.error),
      snapshotDate,
      funds: results,
    };

    await service.from("audit_log").insert({
      actor_id: null,
      fund_id: null,
      action: "cron.eod-snapshot",
      entity: "fund_snapshots",
      entity_id: snapshotDate,
      after: summary,
    });

    return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("cron eod-snapshot failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
