// GET /api/market/search?q= — symbol lookup for the pitch editor and the
// add-holding form. Requires a signed-in user; not fund-scoped.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/fund";
import { searchSymbols } from "@/lib/yahoo";

const querySchema = z.object({
  q: z.string().trim().max(80, "query too long").default(""),
});

export async function GET(request: NextRequest) {
  const { user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 }
    );
  }

  // An empty query is a valid "nothing typed yet" state, not an error.
  if (!parsed.data.q) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchSymbols(parsed.data.q);
  return NextResponse.json({ results });
}
