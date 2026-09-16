// Bond price provider interface (SPEC 13.4). pricing_method picks the
// provider; a future paid feed is one new class and one new enum value.

import type { BondMark, Holding, TreasuryCurvePoint } from "@/types/domain";
import { priceTreasury } from "./treasury";

export interface BondPriceProvider {
  name: string;
  getPrice(input: {
    cusip?: string;
    isin?: string;
    asOf?: Date;
  }): Promise<{ cleanPrice: number; ytm?: number; asOf: Date; source: string } | null>;
}

/** Match a holding by CUSIP/ISIN; with neither given, a single holding wins. */
function findHolding(
  holdings: Holding[],
  input: { cusip?: string; isin?: string }
): Holding | undefined {
  if (input.cusip || input.isin) {
    return holdings.find(
      (h) =>
        (input.cusip !== undefined && h.cusip === input.cusip) ||
        (input.isin !== undefined && h.isin === input.isin)
    );
  }
  return holdings.length === 1 ? holdings[0] : undefined;
}

/**
 * Prices from manual `bond_marks` rows (entered by the Arch PM from the
 * Bloomberg terminals). Pass the marks up front; optionally pass holdings so
 * CUSIP/ISIN lookups can be resolved to a holding_id. Without holdings the
 * marks are assumed to belong to one security and the latest mark wins.
 */
export class ManualMarkProvider implements BondPriceProvider {
  readonly name = "manual";

  constructor(
    private readonly marks: BondMark[],
    private readonly holdings: Holding[] = []
  ) {}

  async getPrice(input: {
    cusip?: string;
    isin?: string;
    asOf?: Date;
  }): Promise<{ cleanPrice: number; ytm?: number; asOf: Date; source: string } | null> {
    let candidates = this.marks;
    if ((input.cusip || input.isin) && this.holdings.length > 0) {
      const holding = findHolding(this.holdings, input);
      if (!holding) return null;
      candidates = candidates.filter((m) => m.holding_id === holding.id);
    }
    const cutoff = input.asOf?.getTime();
    const eligible =
      cutoff === undefined
        ? candidates
        : candidates.filter((m) => new Date(m.marked_at).getTime() <= cutoff);
    if (eligible.length === 0) return null;

    const latest = eligible.reduce((a, b) =>
      new Date(a.marked_at).getTime() >= new Date(b.marked_at).getTime() ? a : b
    );
    return {
      cleanPrice: Number(latest.clean_price),
      ytm: latest.ytm !== null && latest.ytm !== undefined ? Number(latest.ytm) : undefined,
      asOf: new Date(latest.marked_at),
      source: "mark",
    };
  }
}

/**
 * Prices Treasuries off the daily par yield curve (approximation — see
 * priceTreasury). Pass the curve rows and the holdings the provider may be
 * asked about.
 */
export class TreasuryCurveProvider implements BondPriceProvider {
  readonly name = "treasury_curve";

  constructor(
    private readonly curve: TreasuryCurvePoint[],
    private readonly holdings: Holding[] = []
  ) {}

  async getPrice(input: {
    cusip?: string;
    isin?: string;
    asOf?: Date;
  }): Promise<{ cleanPrice: number; ytm?: number; asOf: Date; source: string } | null> {
    const holding = findHolding(this.holdings, input);
    if (!holding) return null;
    const asOf = input.asOf ?? new Date();
    const priced = priceTreasury(holding, this.curve, asOf);
    if (!priced) return null;
    return { cleanPrice: priced.cleanPrice, ytm: priced.ytm, asOf, source: "curve" };
  }
}

/**
 * Stub for Finnhub's paid bond price endpoint. Throws "not configured" unless
 * FINNHUB_API_KEY is set; the actual integration ships when the fund pays for
 * a tier (one class, one enum value — see SPEC 13.4).
 */
export class FinnhubProvider implements BondPriceProvider {
  readonly name = "finnhub";

  async getPrice(): Promise<{
    cleanPrice: number;
    ytm?: number;
    asOf: Date;
    source: string;
  } | null> {
    if (!process.env.FINNHUB_API_KEY) {
      throw new Error(
        "FinnhubProvider not configured: set FINNHUB_API_KEY to enable Finnhub bond pricing."
      );
    }
    // Paid-tier endpoint integration is not implemented yet.
    return null;
  }
}
