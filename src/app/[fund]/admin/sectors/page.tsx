// /[fund]/admin/sectors — manage sectors and set target/benchmark weights
// (SPEC 11.3). Officers manage the sectors themselves; the strategy-team
// leader (Equity Strategies / Macro) reaches this page for the targets form
// and nothing else. The targets come first, at #targets, because setting
// them is what most visits are for.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can, isOfficer, leadsStrategyTeam } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SectorsAdmin,
  SectorTargetsForm,
} from "@/components/admin/SectorsAdmin";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader, ViewLink } from "@/components/ui/PageHeader";
import type { Sector, SectorTarget } from "@/types/domain";
import { adminTitle } from "../admin-metadata";

export const generateMetadata = adminTitle("sectors", "Manage sectors");

export default async function SectorsAdminPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const canSetTargets = can(ctx, "set_sector_targets", {
    isStrategyLeader: leadsStrategyTeam(ctx),
  });
  // The sector list itself is officer business; the advisor reads it.
  const showSectorList = isOfficer(ctx) || ctx.isFacultyAdvisor;
  if (!showSectorList && !canSetTargets) notFound();

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

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Manage sectors"
        description={
          showSectorList
            ? "Set target and benchmark weights, and add, rename or reorder sectors."
            : "Set the fund's target and benchmark weights."
        }
        actions={
          <ViewLink href={`/${ctx.fund.slug}/sectors`}>View sectors</ViewLink>
        }
      />

      {canSetTargets && (
        <section id="targets" className="scroll-mt-20 lg:scroll-mt-6">
          <Card>
            <CardHeader title="Target and benchmark weights" />
            <div className="space-y-4 p-4 sm:p-6">
              <p className="text-sm text-muted">
                The target is the share of the fund each sector should hold.
                The benchmark is that sector&apos;s share of the index the
                fund is measured against. Members see both on{" "}
                <Link
                  href={`/${ctx.fund.slug}/sectors`}
                  className="font-medium text-accent-text hover:underline"
                >
                  Sectors
                </Link>
                . Saving starts a new set from the date you pick.
              </p>
              <SectorTargetsForm
                fund={ctx.fund.slug}
                sectors={sectors}
                latestTargets={latestTargets}
              />
            </div>
          </Card>
        </section>
      )}

      {showSectorList && (
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
      )}
    </div>
  );
}
