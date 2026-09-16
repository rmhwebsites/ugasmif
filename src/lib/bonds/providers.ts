// Bond price provider interface (SPEC 13.4). pricing_method picks the
// provider; a future paid feed is one new class and one new enum value.

import type {
  BondMark,
  Holding,
  PricingMethod,
  TreasuryCurvePoint,
} from "@/types/domain";
import { easternDateString } from "@/lib/format";
import { estimateBondPrice } from "./estimate";
import { priceTreasury } from "./treasury";

export interface BondPriceRequest {
  cusip?: string;
  isin?: string;
  asOf?: Date;
}

/**
 * `duration` and `accrued` extend the Section 13.4 shape (both optional, so
 * any provider still satisfies it): valuation.ts needs modified duration for
 * the fund's weighted duration, and a provider that already computed accrued
 * dollars should not have them recomputed.
 */
export interface BondPrice {
  cleanPrice: number;
  ytm?: number;
  duration?: number;
  accrued?: number;
  asOf: Date;
  source: string;
}

export interface BondPriceProvider {
  name: string;
  getPrice(input: BondPriceRequest): Promise<BondPrice | null>;
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
 * Curve rows needed to age a mark forward (SPEC 13.3). `curveAtMark` is keyed
 * by the mark's Eastern date, matching valuation.ts's lookup.
 */
export interface MarkDrift {
  curveNow: TreasuryCurvePoint[] | null;
  curveAtMark: Map<string, TreasuryCurvePoint[] | null>;
}

/**
 * Prices from manual `bond_marks` rows (entered by the Arch PM from the
 * Bloomberg terminals). Pass the marks up front; optionally pass holdings so
 * CUSIP/ISIN lookups can be resolved to a holding_id. Without holdings the
 * marks are assumed to belong to one security and the latest mark wins.
 * With `drift` the mark is aged forward by the curve move since it was taken
 * and the source becomes "estimate"; without it the mark is returned as is.
 */
export class ManualMarkProvider implements BondPriceProvider {
  readonly name = "manual";

  constructor(
    private readonly marks: BondMark[],
    private readonly holdings: Holding[] = [],
    private readonly drift?: MarkDrift
  ) {}

  async getPrice(input: BondPriceRequest): Promise<BondPrice | null> {
    const holding = findHolding(this.holdings, input);
    let candidates = this.marks;
    if ((input.cusip || input.isin) && this.holdings.length > 0) {
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
    const markedAt = new Date(latest.marked_at);

    if (this.drift && holding) {
      const est = estimateBondPrice(
        holding,
        latest,
        this.drift.curveAtMark.get(easternDateString(markedAt)) ?? null,
        this.drift.curveNow
      );
      return {
        cleanPrice: est.cleanPrice,
        ytm: est.ytm ?? undefined,
        duration: est.duration ?? undefined,
        asOf: markedAt,
        source: est.source,
      };
    }

    return {
      cleanPrice: Number(latest.clean_price),
      ytm: latest.ytm !== null && latest.ytm !== undefined ? Number(latest.ytm) : undefined,
      duration:
        latest.duration !== null && latest.duration !== undefined
          ? Number(latest.duration)
          : undefined,
      asOf: markedAt,
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

  async getPrice(input: BondPriceRequest): Promise<BondPrice | null> {
    const holding = findHolding(this.holdings, input);
    if (!holding) return null;
    const asOf = input.asOf ?? new Date();
    const priced = priceTreasury(holding, this.curve, asOf);
    if (!priced) return null;
    return {
      cleanPrice: priced.cleanPrice,
      ytm: priced.ytm,
      duration: priced.duration,
      accrued: priced.accrued,
      asOf,
      source: "curve",
    };
  }
}

/**
 * Stub for Finnhub's paid bond price endpoint. Throws "not configured" unless
 * FINNHUB_API_KEY is set; the actual integration ships when the fund pays for
 * a tier (one class, one enum value — see SPEC 13.4).
 */
export class FinnhubProvider implements BondPriceProvider {
  readonly name = "finnhub";

  async getPrice(): Promise<BondPrice | null> {
    if (!process.env.FINNHUB_API_KEY) {
      throw new Error(
        "FinnhubProvider not configured: set FINNHUB_API_KEY to enable Finnhub bond pricing."
      );
    }
    // Paid-tier endpoint integration is not implemented yet.
    return null;
  }
}

/** Everything a provider may need; each one reads only the parts it uses. */
export interface ProviderContext {
  /** Candidate marks — pass only the ones relevant to the request. */
  marks?: BondMark[];
  /** Holdings the provider may be asked about (CUSIP/ISIN resolution). */
  holdings?: Holding[];
  /** Curve rows for the pricing date. */
  curve?: TreasuryCurvePoint[] | null;
  /** Enables between-marks drift on ManualMarkProvider. */
  drift?: MarkDrift;
}

/**
 * `pricing_method` picks the provider (SPEC 13.4). "live" has no bond provider
 * — equities and ETFs are quoted through @/lib/yahoo. Adding a paid feed is a
 * new class above, a new `pricing_method` enum value in the migration, and one
 * more case here.
 */
export function providerFor(
  method: PricingMethod,
  ctx: ProviderContext = {}
): BondPriceProvider | null {
  switch (method) {
    case "manual":
      return new ManualMarkProvider(ctx.marks ?? [], ctx.holdings ?? [], ctx.drift);
    case "treasury_curve":
      return new TreasuryCurveProvider(ctx.curve ?? [], ctx.holdings ?? []);
    case "live":
      return null;
  }
}
