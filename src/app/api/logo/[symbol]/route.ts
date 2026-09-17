// GET /api/logo/[symbol] — company logo for a ticker.
//
// Proxied rather than hotlinked, for three reasons:
//   1. Privacy. A student's browser only ever talks to this domain, so the
//      fund's holdings are not handed to a third party on every page view.
//   2. Caching. Logos effectively never change, so this answers with a
//      one-year immutable cache header and the CDN serves it from the edge
//      after the first request. The upstream is hit once per symbol.
//   3. One place to change. If the provider disappears — as Clearbit's free
//      logo API did — only this file moves.
//
// A symbol with no logo returns 404 rather than a placeholder image, so the
// component can fall back to the ticker's initials in the fund accent.

import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** Long enough that the CDN keeps it; logos do not change. */
const CACHE = "public, max-age=31536000, s-maxage=31536000, immutable";
/** Don't hammer the CDN re-fetching a miss on every request either. */
const MISS_CACHE = "public, max-age=86400, s-maxage=86400";
const UPSTREAM_TIMEOUT_MS = 6_000;
const MAX_BYTES = 512 * 1024;

/** Tickers are short and alphanumeric; anything else is not one of ours. */
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: raw } = await params;
  const symbol = decodeURIComponent(raw).trim().toUpperCase();

  // Validate before building a URL from user input, so this cannot be used to
  // fetch arbitrary paths on the upstream host.
  if (!SYMBOL.test(symbol)) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": MISS_CACHE },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(
      `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`,
      { signal: controller.signal, cache: "no-store" }
    );
    if (!upstream.ok) {
      return new NextResponse(null, {
        status: 404,
        headers: { "Cache-Control": MISS_CACHE },
      });
    }

    const type = upstream.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      // An HTML error page dressed as a 200.
      return new NextResponse(null, {
        status: 404,
        headers: { "Cache-Control": MISS_CACHE },
      });
    }

    const body = await upstream.arrayBuffer();
    // A handful of bytes is a tracking pixel or an empty placeholder, not a
    // logo; the initials fallback looks better than a blank square.
    if (body.byteLength < 200 || body.byteLength > MAX_BYTES) {
      return new NextResponse(null, {
        status: 404,
        headers: { "Cache-Control": MISS_CACHE },
      });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(body.byteLength),
        "Cache-Control": CACHE,
      },
    });
  } catch {
    // Timeout or network failure: a short cache so the next page view retries
    // soon, rather than pinning the miss for a year.
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } finally {
    clearTimeout(timer);
  }
}
