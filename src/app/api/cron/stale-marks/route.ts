// Weekly cron (Mon 12:00 UTC, vercel.json): find manually priced holdings
// whose latest bond mark is older than the fund's stale threshold
// (settings.stale_mark_days, default 7) — or that have never been marked —
// and email that fund's portfolio manager the list (spec 13.3, 13.6, 16).
// Bearer CRON_SECRET only.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendToFund } from "@/lib/emails/send";
import { formatDate } from "@/lib/format";
import type { BondMark, Fund, Holding } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_STALE_DAYS = 7;
const DAY_MS = 86_400_000;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const nowMs = Date.now();
  const results: Array<{
    fund: string;
    staleDays: number;
    manualHoldings: number;
    stale: number;
  }> = [];

  try {
    const { data: fundRows, error: fundsError } = await service
      .from("funds")
      .select("*")
      .order("slug");
    if (fundsError) throw new Error(fundsError.message);
    const funds = (fundRows as Fund[]) ?? [];

    for (const fund of funds) {
      const configured = Number(fund.settings?.stale_mark_days);
      const staleDays =
        Number.isFinite(configured) && configured > 0
          ? configured
          : DEFAULT_STALE_DAYS;

      const { data: holdingRows, error: holdingsError } = await service
        .from("holdings")
        .select("*")
        .eq("fund_id", fund.id)
        .eq("is_active", true)
        .eq("pricing_method", "manual")
        .order("name");
      if (holdingsError) throw new Error(holdingsError.message);
      const holdings = (holdingRows as Holding[]) ?? [];
      if (holdings.length === 0) {
        results.push({ fund: fund.slug, staleDays, manualHoldings: 0, stale: 0 });
        continue;
      }

      const { data: markRows, error: marksError } = await service
        .from("bond_marks")
        .select("holding_id, marked_at")
        .in(
          "holding_id",
          holdings.map((h) => h.id)
        )
        .order("marked_at", { ascending: false });
      if (marksError) throw new Error(marksError.message);
      const latestMarkAt = new Map<string, string>();
      for (const m of (markRows as Pick<BondMark, "holding_id" | "marked_at">[]) ??
        []) {
        if (!latestMarkAt.has(m.holding_id)) {
          latestMarkAt.set(m.holding_id, m.marked_at);
        }
      }

      const staleLines: string[] = [];
      for (const h of holdings) {
        const label = `${h.name}${h.cusip ? ` (${h.cusip})` : ""}`;
        const markedAt = latestMarkAt.get(h.id);
        if (!markedAt) {
          staleLines.push(`${label} — never marked.`);
          continue;
        }
        const ageMs = nowMs - new Date(markedAt).getTime();
        if (ageMs > staleDays * DAY_MS) {
          const ageDays = Math.floor(ageMs / DAY_MS);
          staleLines.push(
            `${label} — last marked ${formatDate(markedAt)} (${ageDays} days ago).`
          );
        }
      }

      if (staleLines.length > 0) {
        await sendToFund(service, fund.id, {
          subject: `Stale bond marks: ${staleLines.length} ${
            staleLines.length === 1 ? "holding needs" : "holdings need"
          } a fresh price`,
          heading: `${staleLines.length} bond ${
            staleLines.length === 1 ? "mark is" : "marks are"
          } older than ${staleDays} days`,
          bodyLines: [
            `These manually priced holdings in ${fund.name} have no mark newer than ${staleDays} days, so the fund is valued off rate-adjusted estimates until they are re-marked:`,
            ...staleLines,
            "Enter marks from the Bloomberg terminals on the holdings admin page — one at a time or via the CSV upload.",
          ],
          ctaLabel: "Enter marks",
          ctaPath: `/${fund.slug}/admin/holdings`,
          roles: ["portfolio_manager"],
          category: "reminders",
        });
      }

      results.push({
        fund: fund.slug,
        staleDays,
        manualHoldings: holdings.length,
        stale: staleLines.length,
      });
    }

    const summary = { ok: true, funds: results };

    await service.from("audit_log").insert({
      actor_id: null,
      fund_id: null,
      action: "cron.stale-marks",
      entity: "bond_marks",
      entity_id: null,
      after: summary,
    });

    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("cron stale-marks failed:", err);
    return NextResponse.json(
      { ok: false, error: message, funds: results },
      { status: 500 }
    );
  }
}
