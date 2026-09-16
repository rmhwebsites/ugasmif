// GET /api/market/quotes?symbols=A,B — batch quotes for any signed-in user.
// Not fund-scoped: quotes are public market data, but we still require auth
// so the endpoint can't be scraped anonymously.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/fund";
import { getQuotes } from "@/lib/yahoo";
import type { Quote } from "@/types/domain";

const querySchema = z.object({
  symbols: z
    .string()
    .min(1, "symbols is required")
    .max(1000)
    .transform((value) =>
      [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))]
    )
    .refine((list) => list.length > 0, "symbols is required")
    .refine((list) => list.length <= 60, "at most 60 symbols per request")
    .refine(
      (list) => list.every((s) => /^[A-Za-z0-9^.\-=]{1,15}$/.test(s)),
      "invalid symbol"
    ),
});

export async function GET(request: NextRequest) {
  const { user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    symbols: request.nextUrl.searchParams.get("symbols") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 }
    );
  }

  const map = await getQuotes(parsed.data.symbols);
  const quotes: Quote[] = parsed.data.symbols
    .map((symbol) => map.get(symbol))
    .filter((q): q is Quote => q !== undefined);

  return NextResponse.json({ quotes });
}
