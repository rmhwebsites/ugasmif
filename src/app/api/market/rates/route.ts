// GET /api/market/rates — Treasury yield strip for the Arch dashboard
// (^IRX 13W, ^FVX 5Y, ^TNX 10Y, ^TYX 30Y). Requires a signed-in user;
// not fund-scoped. No query params.

import { NextResponse } from "next/server";
import { getAuthState } from "@/lib/fund";
import { getRatesStrip } from "@/lib/yahoo";

export async function GET() {
  const { user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const rates = await getRatesStrip();
  return NextResponse.json({ rates });
}
