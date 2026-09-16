// /[fund]/admin/sectors — manage sectors and set target/benchmark weights
// (SPEC 11.3). Officers manage sectors; the strategy-team leader may also
// set targets.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can, isOfficer } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SectorsAdmin,
  SectorTargetsForm,
} from "@/components/admin/SectorsAdmin";
import { Card, CardHeader } from "@/components/ui/Card";
import type { Sector, SectorTarget } from "@/types/domain";

export const metadata: Metadata = { title: "Sectors Admin" };

export default async function SectorsAdminPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const supabase = await createSupabaseServerClient();
  const [sectorsRes, targetsRes] = await Promise.all([
    supabase
      .from("sectors")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .order("sort_order"),
    supabase
      .from("sector_targets")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .order("effective_on", { ascending: false }),
  ]);

  const sectors = (sectorsRes.data as Sector[]) ?? [];
  const targets = (targetsRes.data as SectorTarget[]) ?? [];
  const latestTargets: Record<string, SectorTarget> = {};
  for (const t of targets) {
    if (!latestTargets[t.sector_id]) latestTargets[t.sector_id] = t;
  }

  const strategySector = sectors.find(
    (s) =>
      s.is_strategy_team &&
      ctx.membership?.sector_id === s.id &&
      ctx.membership.is_sector_leader
  );
  const canSetTargets = can(ctx, "set_sector_targets", {
    sectorId: strategySector?.id,
    isStrategySector: strategySector !== undefined,
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Sectors Admin</h1>

      <Card>
        <CardHeader title="Sectors" />
        <div className="p-4 sm:p-6">
          <SectorsAdmin
            fund={ctx.fund.slug}
            sectors={sectors}
            canEditSectors={isOfficer(ctx)}
          />
        </div>
      </Card>

      {canSetTargets && (
        <Card>
          <CardHeader title="Target and benchmark weights" />
          <div className="p-4 sm:p-6">
            <SectorTargetsForm
              fund={ctx.fund.slug}
              sectors={sectors}
              latestTargets={latestTargets}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
