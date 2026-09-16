// GET /api/[fund]/roster/export — current roster in the import format
// (SPEC 17.1) so next year's officers start from it.

import { NextResponse, type NextRequest } from "next/server";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { easternDateString } from "@/lib/format";
import type { Membership, Profile, Sector } from "@/types/domain";

export const dynamic = "force-dynamic";

type MemberRow = Membership & {
  profiles: Pick<Profile, "email" | "full_name"> | null;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "manage_roster")) {
    return NextResponse.json(
      { error: "Only roster managers can export the roster." },
      { status: 403 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const [membersRes, sectorsRes] = await Promise.all([
    supabase
      .from("memberships")
      .select("*, profiles(email, full_name)")
      .eq("fund_id", ctx.fund.id)
      .eq("academic_year_id", ctx.currentYear.id)
      .order("role"),
    supabase.from("sectors").select("*").eq("fund_id", ctx.fund.id),
  ]);

  const members = (membersRes.data as MemberRow[]) ?? [];
  const sectors = new Map(
    ((sectorsRes.data as Sector[]) ?? []).map((s) => [s.id, s.name])
  );

  const csv = toCsv(
    [
      "email",
      "full_name",
      "fund",
      "role",
      "sector",
      "is_sector_leader",
      "title_override",
    ],
    members.map((m) => [
      m.profiles?.email ?? "",
      m.profiles?.full_name ?? "",
      ctx.fund.slug,
      m.role,
      m.sector_id ? sectors.get(m.sector_id) ?? "" : "",
      m.is_sector_leader,
      m.title_override ?? "",
    ])
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="smif-${ctx.fund.slug}-roster-${easternDateString()}.csv"`,
    },
  });
}
