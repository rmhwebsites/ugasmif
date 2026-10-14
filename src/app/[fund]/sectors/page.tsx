// /[fund]/sectors — card per sector: leader, analysts, weight vs target vs
// benchmark, holdings count, next and last pitch (SPEC 11.2). The viewer's
// own sector comes first, marked "your sector". The sector name stretches
// its link over the whole card; the pitch lines sit above it and open the
// pitch itself.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import { Badge } from "@/components/ui/Badge";
import { PitchStatusBadge } from "@/components/ui/Badge";
import { formatDay } from "@/lib/format";
import type { Membership, Pitch, Profile, Sector } from "@/types/domain";
import { ManageLink, PageHeader } from "@/components/ui/PageHeader";
import { can, canOpenAdminSection, inSector } from "@/lib/permissions";
import { TargetsNote, WeightTrio } from "./WeightTrio";

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

  // The viewer's own sector leads the list.
  const sectors = [...((sectorsRes.data as Sector[]) ?? [])].sort(
    (a, b) => Number(inSector(ctx, b.id)) - Number(inSector(ctx, a.id))
  );
  const members = (membersRes.data as MemberRow[]) ?? [];
  const pitches = (pitchesRes.data as Pitch[]) ?? [];
  const weightBySector = new Map(
    valuation.sectors.map((s) => [s.sectorId, s])
  );
  const strategyTeam = sectors.find((s) => s.is_strategy_team) ?? null;
  // Targets name ordinary sectors, so only those can be missing one.
  const targetMissing = sectors.some((s) => {
    if (s.is_strategy_team) return false;
    const w = weightBySector.get(s.id);
    return !w || w.targetWeightPct === null || w.benchmarkWeightPct === null;
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageHeader
          title="Sectors"
          description="Each sector team with its holdings, and its weight against target and benchmark."
          actions={
            canOpenAdminSection(ctx, "sectors") ? (
              <ManageLink href={`/${ctx.fund.slug}/admin/sectors#targets`}>
                Manage sectors
              </ManageLink>
            ) : undefined
          }
        />

        <TargetsNote
          fund={ctx.fund.slug}
          canSetTargets={can(ctx, "set_sector_targets")}
          canDraft={can(ctx, "draft_pitch")}
          strategyTeamName={strategyTeam?.name ?? null}
          missing={targetMissing}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        {sectors.map((sector) => {
          const w = weightBySector.get(sector.id);
          const leaders = members.filter(
            (m) => m.sector_id === sector.id && m.is_sector_leader
          );
          const analysts = members.filter(
            (m) => m.sector_id === sector.id && !m.is_sector_leader
          );
          const sectorPitches = pitches.filter(
            (p) => p.sector_id === sector.id
          );
          // Next: an open vote, else the soonest class date. Last: the most
          // recent decision.
          const nextPitch =
            sectorPitches.find((p) => p.status === "voting") ??
            sectorPitches
              .filter((p) => p.status === "scheduled")
              .sort((a, b) =>
                (a.scheduled_for ?? "9999").localeCompare(
                  b.scheduled_for ?? "9999"
                )
              )[0];
          const lastPitch = sectorPitches
            .filter((p) => ["passed", "failed", "executed"].includes(p.status))
            .sort((a, b) =>
              (b.closed_at ?? b.created_at).localeCompare(
                a.closed_at ?? a.created_at
              )
            )[0];
          const over =
            w && w.targetWeightPct !== null
              ? w.weightPct - w.targetWeightPct
              : null;
          const mine = inSector(ctx, sector.id);
          const pitchHref = (id: string) => `/${ctx.fund.slug}/pitches/${id}`;

          return (
            <div
              key={sector.id}
              className="glass-card relative min-w-0 p-4 transition-colors hover:bg-highlight sm:p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 font-semibold">
                  <Link
                    href={`/${ctx.fund.slug}/sectors/${sector.slug}`}
                    className="after:absolute after:inset-0 after:rounded-[inherit]"
                  >
                    {sector.name}
                  </Link>
                </h2>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {mine && <Badge tone="accent">your sector</Badge>}
                  {sector.is_strategy_team && (
                    <Badge tone="info">strategy team</Badge>
                  )}
                </div>
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

              <WeightTrio
                className="mt-3 text-center"
                weight={w?.weightPct ?? 0}
                target={w?.targetWeightPct ?? null}
                benchmark={w?.benchmarkWeightPct ?? null}
                showTargets={!sector.is_strategy_team}
              />

              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted">
                  {w?.holdingsCount ?? 0}{" "}
                  {(w?.holdingsCount ?? 0) === 1 ? "holding" : "holdings"}
                </span>
                {over !== null && Math.abs(over) >= 0.05 && (
                  <Badge
                    className="shrink-0 whitespace-nowrap"
                    tone={over > 0 ? "gain" : "loss"}
                  >
                    {over > 0 ? "+" : ""}
                    {over.toFixed(1)}pp vs target
                  </Badge>
                )}
              </div>

              {(nextPitch || lastPitch) && (
                <div className="mt-2 space-y-1.5 border-t border-card-border pt-2 text-xs text-muted">
                  {nextPitch && (
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={pitchHref(nextPitch.id)}
                        className="relative z-10 min-w-0 flex-1 truncate hover:text-foreground hover:underline"
                      >
                        Next pitch: {nextPitch.title}
                      </Link>
                      <span className="shrink-0">
                        {nextPitch.status === "voting" ? (
                          <PitchStatusBadge status="voting" />
                        ) : nextPitch.scheduled_for ? (
                          formatDay(nextPitch.scheduled_for)
                        ) : (
                          <PitchStatusBadge status="scheduled" />
                        )}
                      </span>
                    </div>
                  )}
                  {lastPitch && (
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={pitchHref(lastPitch.id)}
                        className="relative z-10 min-w-0 flex-1 truncate hover:text-foreground hover:underline"
                      >
                        Last pitch: {lastPitch.title}
                      </Link>
                      <span className="shrink-0">
                        <PitchStatusBadge status={lastPitch.status} />
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
