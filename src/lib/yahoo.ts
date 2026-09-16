// Yahoo Finance market data with a two-layer cache (spec Section 13.1).
//
// Layer 1: module-memory cache per serverless instance — 5 min TTL while the
// market is open, 60 min otherwise.
// Layer 2: the price_snapshots table. Every fetched quote is persisted there
// fire-and-forget; on a Yahoo outage the latest snapshot row is returned with
// stale: true. getQuotes never throws — symbols with nothing available are
// simply absent from the Map.
//
// price_snapshots is service-role only for INSERT and session-gated for
// SELECT, so both directions use the service client; callers that already hold
// one (cron) can pass it instead.
//
// Server-only by convention (do not import from client components), but kept
// free of next-only imports at module scope so scripts can import it — the
// Supabase clients are loaded dynamically, inside try/catch, so a script or a
// missing service key degrades to "no snapshots" rather than throwing.
//
// NOTE: this is the one file where `any` is permitted (yahoo-finance2's
// response types are looser than its typings admit); every `any` is cast to a
// typed shape at the boundary.

import YahooFinance from "yahoo-finance2";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceSnapshot, Quote } from "@/types/domain";
import { isNyseHoliday } from "@/lib/holidays";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface HistoryPoint {
  time: string;
  close: number;
  adjClose: number | null;
}

export type HistoryPeriod =
  | "1d"
  | "5d"
  | "1mo"
  | "3mo"
  | "6mo"
  | "ytd"
  | "1y"
  | "5y"
  | "max";

// ── Market hours ────────────────────────────────────────────────────────────

interface EasternClock {
  isoDate: string; // YYYY-MM-DD in America/New_York
  weekday: number; // 0 Sun … 6 Sat
  minutes: number; // minutes since midnight ET
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function easternClock(now: Date): EasternClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS.indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** Mon–Fri 9:30–16:00 ET, minus NYSE holidays. */
export function isMarketOpen(now: Date = new Date()): boolean {
  const et = easternClock(now);
  if (et.weekday < 1 || et.weekday > 5) return false;
  if (isNyseHoliday(et.isoDate)) return false;
  return et.minutes >= 9 * 60 + 30 && et.minutes < 16 * 60;
}

// ── Quote cache (layer 1: module memory) ────────────────────────────────────

const quoteCache = new Map<string, { quote: Quote; cachedAt: number }>();

function cacheTtlMs(): number {
  return isMarketOpen() ? 5 * 60 * 1000 : 60 * 60 * 1000;
}

// ── Quotes ──────────────────────────────────────────────────────────────────

interface RawYahooQuote {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketTime?: Date | number;
}

function toQuote(raw: RawYahooQuote): Quote | null {
  if (typeof raw.regularMarketPrice !== "number") return null;
  const asOf =
    raw.regularMarketTime instanceof Date
      ? raw.regularMarketTime.toISOString()
      : typeof raw.regularMarketTime === "number"
        ? new Date(raw.regularMarketTime * 1000).toISOString()
        : new Date().toISOString();
  return {
    symbol: raw.symbol,
    name: raw.shortName || raw.longName || raw.symbol,
    price: raw.regularMarketPrice,
    previousClose: raw.regularMarketPreviousClose ?? null,
    change: raw.regularMarketChange ?? null,
    changePercent: raw.regularMarketChangePercent ?? null,
    stale: false,
    asOf,
  };
}

/**
 * Service-role client for price_snapshots, resolved once per instance. The
 * import is dynamic (and the failure cached) because @/lib/supabase/service is
 * server-only: outside a Next server runtime — scripts, tests — this answers
 * null and the snapshot layer simply does nothing.
 */
let snapshotClientPromise: Promise<SupabaseClient | null> | null = null;

function snapshotClient(): Promise<SupabaseClient | null> {
  snapshotClientPromise ??= (async () => {
    try {
      const { createServiceClient } = await import("@/lib/supabase/service");
      return createServiceClient();
    } catch (err) {
      console.error("price_snapshots: no service-role client available:", err);
      return null;
    }
  })();
  return snapshotClientPromise;
}

/** Fire-and-forget insert into price_snapshots (policy: service role only). */
function persistSnapshots(quotes: Quote[], client?: SupabaseClient): void {
  if (quotes.length === 0) return;
  const rows = quotes.map((q) => ({
    symbol: q.symbol,
    price: q.price,
    previous_close: q.previousClose,
    change_pct: q.changePercent,
    source: "yahoo",
    as_of: q.asOf,
  }));
  void (async () => {
    try {
      const db = client ?? (await snapshotClient());
      if (!db) return;
      const { error } = await db.from("price_snapshots").insert(rows);
      if (error) console.error("price_snapshots insert failed:", error.message);
    } catch (err) {
      console.error("price_snapshots insert failed:", err);
    }
  })();
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/**
 * Layer-2 fallback: latest price_snapshots row per symbol, marked stale.
 * Prefers the service-role client: the SELECT policy requires an authenticated
 * user, and the cron has no cookie, so the anon client would read nothing.
 * Dynamic imports keep this module importable outside a Next request scope.
 */
async function snapshotFallback(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  if (symbols.length === 0) return out;
  try {
    let supabase = await snapshotClient();
    if (!supabase) {
      const { createSupabaseServerClient } = await import("@/lib/supabase/server");
      supabase = await createSupabaseServerClient();
    }
    await Promise.all(
      symbols.map(async (symbol) => {
        const { data } = await supabase
          .from("price_snapshots")
          .select("*")
          .eq("symbol", symbol)
          .order("as_of", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!data) return;
        const row = data as PriceSnapshot;
        // numeric columns can arrive as strings from PostgREST — coerce.
        const price = Number(row.price);
        if (!Number.isFinite(price)) return;
        const previousClose =
          row.previous_close === null ? null : Number(row.previous_close);
        const changePercent =
          row.change_pct === null ? null : Number(row.change_pct);
        out.set(symbol, {
          symbol,
          name: symbol,
          price,
          previousClose,
          change:
            previousClose !== null ? price - previousClose : null,
          changePercent,
          stale: true,
          staleMinutes: minutesSince(row.as_of),
          asOf: row.as_of,
        });
      })
    );
  } catch (err) {
    console.error("price_snapshots fallback failed:", err);
  }
  return out;
}

/**
 * Batch quotes: one yf.quote() call for every symbol not freshly cached.
 * Fetched quotes are written to price_snapshots fire-and-forget (SPEC 13.1);
 * `opts.persist` supplies the client when the caller already holds a
 * service-role one. Never throws; symbols with nothing available (no Yahoo, no
 * cache, no snapshot) are absent.
 */
export async function getQuotes(
  symbols: string[],
  opts?: { persist?: SupabaseClient }
): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const wanted = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  if (wanted.length === 0) return out;

  const ttl = cacheTtlMs();
  const toFetch: string[] = [];
  for (const symbol of wanted) {
    const cached = quoteCache.get(symbol);
    if (cached && Date.now() - cached.cachedAt < ttl) {
      out.set(symbol, cached.quote);
    } else {
      toFetch.push(symbol);
    }
  }
  if (toFetch.length === 0) return out;

  const fetched: Quote[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any = await yf.quote(toFetch);
    const list: RawYahooQuote[] = Array.isArray(results)
      ? (results as RawYahooQuote[])
      : results
        ? [results as RawYahooQuote]
        : [];
    for (const raw of list) {
      const quote = toQuote(raw);
      if (!quote) continue;
      // Key by the symbol the caller asked for (Yahoo echoes it uppercased).
      const requested =
        toFetch.find((s) => s.toUpperCase() === quote.symbol.toUpperCase()) ??
        quote.symbol;
      quoteCache.set(requested, { quote, cachedAt: Date.now() });
      out.set(requested, quote);
      fetched.push(quote);
    }
  } catch (err) {
    console.error("yahoo quote batch failed:", err);
  }

  persistSnapshots(fetched, opts?.persist);

  // Anything still missing: expired memory cache first, then price_snapshots.
  const missing = toFetch.filter((s) => !out.has(s));
  const needDb: string[] = [];
  for (const symbol of missing) {
    const expired = quoteCache.get(symbol);
    if (expired) {
      out.set(symbol, {
        ...expired.quote,
        stale: true,
        staleMinutes: minutesSince(expired.quote.asOf),
      });
    } else {
      needDb.push(symbol);
    }
  }
  if (needDb.length > 0) {
    const fallback = await snapshotFallback(needDb);
    for (const [symbol, quote] of fallback) {
      // Cache the fallback too so an outage doesn't hammer the DB per render.
      quoteCache.set(symbol, { quote, cachedAt: Date.now() });
      out.set(symbol, quote);
    }
  }
  return out;
}

export async function getQuote(symbol: string): Promise<Quote | null> {
  const quotes = await getQuotes([symbol]);
  return quotes.get(symbol.trim()) ?? null;
}

// ── History ─────────────────────────────────────────────────────────────────

type ChartInterval = "5m" | "15m" | "1h" | "1d" | "1wk";

const INTERVALS: Record<HistoryPeriod, ChartInterval> = {
  "1d": "5m",
  "5d": "15m",
  "1mo": "1h",
  "3mo": "1d",
  "6mo": "1d",
  ytd: "1d",
  "1y": "1d",
  "5y": "1wk",
  max: "1wk",
};

function historyStart(period: HistoryPeriod, now: Date): Date {
  const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  switch (period) {
    case "1d":
      return days(1);
    case "5d":
      return days(7);
    case "1mo":
      return days(31);
    case "3mo":
      return days(92);
    case "6mo":
      return days(183);
    case "ytd": {
      // Jan 1 of the current Eastern year.
      const year = easternClock(now).isoDate.slice(0, 4);
      return new Date(`${year}-01-01T05:00:00Z`);
    }
    case "1y":
      return days(366);
    case "5y":
      return days(5 * 365 + 2);
    case "max":
      return new Date("1990-01-01T00:00:00Z");
  }
}

interface RawChartQuote {
  date: Date | string | number;
  close: number | null;
  adjclose?: number | null;
}

function chartQuoteTime(raw: RawChartQuote, intraday: boolean): string | null {
  const date =
    raw.date instanceof Date
      ? raw.date
      : typeof raw.date === "number"
        ? new Date(raw.date * 1000)
        : new Date(raw.date);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return intraday ? iso : iso.slice(0, 10);
}

async function fetchChart(
  symbol: string,
  period1: Date,
  interval: ChartInterval
): Promise<HistoryPoint[]> {
  const intraday = interval !== "1d" && interval !== "1wk";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await yf.chart(symbol, { period1, interval });
    const quotes: RawChartQuote[] = (result?.quotes as RawChartQuote[]) ?? [];
    const points: HistoryPoint[] = [];
    for (const q of quotes) {
      if (typeof q.close !== "number") continue;
      const time = chartQuoteTime(q, intraday);
      if (!time) continue;
      points.push({
        time,
        close: q.close,
        // adjclose is absent for intraday intervals — null then.
        adjClose: typeof q.adjclose === "number" ? q.adjclose : null,
      });
    }
    return points;
  } catch (err) {
    console.error(`yahoo chart failed for ${symbol}:`, err);
    return [];
  }
}

export async function getHistory(
  symbol: string,
  period: HistoryPeriod
): Promise<HistoryPoint[]> {
  const now = new Date();
  return fetchChart(symbol, historyStart(period, now), INTERVALS[period]);
}

/** Daily bars from `from`, with adjclose, for benchmark total-return math. */
export async function getDailyHistory(
  symbol: string,
  from: Date
): Promise<HistoryPoint[]> {
  return fetchChart(symbol, from, "1d");
}

// ── Search ──────────────────────────────────────────────────────────────────

interface RawSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  exchange?: string;
  quoteType?: string;
  isYahooFinance?: boolean;
}

/** Symbol search for the pitch editor and add-holding form (equity/ETF only). */
export async function searchSymbols(
  q: string
): Promise<{ symbol: string; name: string; exchange: string; type: string }[]> {
  const query = q.trim();
  if (!query) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await yf.search(query);
    const quotes: RawSearchQuote[] = (result?.quotes as RawSearchQuote[]) ?? [];
    return quotes
      .filter(
        (item): item is RawSearchQuote & { symbol: string; quoteType: string } =>
          typeof item.symbol === "string" &&
          (item.quoteType === "EQUITY" || item.quoteType === "ETF")
      )
      .map((item) => ({
        symbol: item.symbol,
        name: item.shortname || item.longname || item.symbol,
        exchange: item.exchDisp || item.exchange || "",
        type: item.quoteType === "ETF" ? "etf" : "equity",
      }));
  } catch (err) {
    console.error("yahoo search failed:", err);
    return [];
  }
}

// ── Rates strip (Arch) ──────────────────────────────────────────────────────

const RATE_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: "^IRX", label: "13W" },
  { symbol: "^FVX", label: "5Y" },
  { symbol: "^TNX", label: "10Y" },
  { symbol: "^TYX", label: "30Y" },
];

/** Treasury yield strip. The Yahoo "price" of these indices IS the yield in percent. */
export async function getRatesStrip(): Promise<
  { symbol: string; label: string; yieldPct: number | null; change: number | null }[]
> {
  const quotes = await getQuotes(RATE_SYMBOLS.map((r) => r.symbol));
  return RATE_SYMBOLS.map(({ symbol, label }) => {
    const quote = quotes.get(symbol);
    return {
      symbol,
      label,
      yieldPct: quote?.price ?? null,
      change: quote?.change ?? null,
    };
  });
}

// ── Key stats (stock detail page) ───────────────────────────────────────────

/**
 * quoteSummary subset for the equity detail page. dividendYield is converted
 * from Yahoo's fraction to percent. Returns {} on any failure.
 */
export async function getKeyStats(
  symbol: string
): Promise<Record<string, number | string | null>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await yf.quoteSummary(symbol, {
      modules: ["summaryDetail", "defaultKeyStatistics", "price"],
    });
    const summary = (result?.summaryDetail ?? {}) as Record<string, unknown>;
    const stats = (result?.defaultKeyStatistics ?? {}) as Record<string, unknown>;
    const price = (result?.price ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const dividendYield = num(summary.dividendYield);
    return {
      marketCap: num(price.marketCap) ?? num(summary.marketCap),
      trailingPE: num(summary.trailingPE),
      forwardPE: num(stats.forwardPE) ?? num(summary.forwardPE),
      dividendYield: dividendYield !== null ? dividendYield * 100 : null,
      beta: num(summary.beta) ?? num(stats.beta),
      fiftyTwoWeekHigh: num(summary.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(summary.fiftyTwoWeekLow),
      averageVolume: num(summary.averageVolume),
    };
  } catch (err) {
    console.error(`yahoo quoteSummary failed for ${symbol}:`, err);
    return {};
  }
}
