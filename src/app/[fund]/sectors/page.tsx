// /[fund]/sectors — card per sector: leader, analysts, weight vs target vs
// benchmark, holdings count, last pitch (SPEC 11.2).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import { Badge } from "@/components/ui/Badge";
import { PitchStatusBadge } from "@/components/ui/Badge";
import { formatPercent } from "@/lib/format";
import type { Membership, Pitch, Profile, Sector } from "@/types/domain";

export const metadata: Metadata = { title: "Sectors" };

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name"> | null;
};

export default async function SectorsPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const supabase = await createSupabaseServerClient();
  const [valuation, sectorsRes, membersRes, pitchesRes] = await Promise.all([
    valueFund(supabase, ctx.fund.id),
    supabase
      .from("sectors")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("memberships")
      .select("*, profiles(full_name)")
      .eq("fund_id", ctx.fund.id)
      .eq("academic_year_id", ctx.currentYear.id)
      .eq("status", "active"),
    supabase
      .from("pitches")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const sectors = (sectorsRes.data as Sector[]) ?? [];
  const members = (membersRes.data as MemberRow[]) ?? [];
  const pitches = (pitchesRes.data as Pitch[]) ?? [];
  const weightBySector = new Map(
    valuation.sectors.map((s) => [s.sectorId, s])
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Sectors</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        {sectors.map((sector) => {
          const w = weightBySector.get(sector.id);
          const leaders = members.filter(
            (m) => m.sector_id === sector.id && m.is_sector_leader
          );
          const analysts = members.filter(
            (m) => m.sector_id === sector.id && !m.is_sector_leader
          );
          const lastPitch = pitches.find((p) => p.sector_id === sector.id);
          const over =
            w && w.targetWeightPct !== null
              ? w.weightPct - w.targetWeightPct
              : null;

          return (
            <Link
              key={sector.id}
              href={`/${ctx.fund.slug}/sectors/${sector.slug}`}
              className="glass-card block p-4 transition-colors hover:bg-highlight sm:p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{sector.name}</h2>
                {sector.is_strategy_team && (
                  <Badge tone="info">strategy team</Badge>
                )}
              </div>

              <p className="mt-1 text-sm text-muted">
                {leaders.length > 0
                  ? `Led by ${leaders
                      .map((l) => l.profiles?.full_name ?? "—")
                      .join(", ")}`
                  : "No leader assigned"}
                {" · "}
                {analysts.length}{" "}
                {analysts.length === 1 ? "analyst" : "analysts"}
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm tabular-nums">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted">
                    Weight
                  </p>
                  <p className="font-semibold">
                    {formatPercent(w?.weightPct ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted">
                    Target
                  </p>
                  <p className="font-semibold">
                    {formatPercent(w?.targetWeightPct ?? null)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted">
                    Benchmark
                  </p>
                  <p className="font-semibold">
                    {formatPercent(w?.benchmarkWeightPct ?? null)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted">
                  {w?.holdingsCount ?? 0}{" "}
                  {(w?.holdingsCount ?? 0) === 1 ? "holding" : "holdings"}
                </span>
                {over !== null && Math.abs(over) >= 0.05 && (
                  <Badge tone={over > 0 ? "gain" : "loss"}>
                    {over > 0 ? "+" : ""}
                    {over.toFixed(1)}pp vs target
                  </Badge>
                )}
              </div>

              {lastPitch && (
                <div className="mt-2 flex items-center gap-2 border-t border-card-border pt-2 text-xs text-muted">
                  <span className="truncate">Last pitch: {lastPitch.title}</span>
                  <PitchStatusBadge status={lastPitch.status} />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
