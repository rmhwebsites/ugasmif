// /[fund]/admin/year — academic year rollover (SPEC 17.2). The year is
// club-wide: rolling over here ends it for both funds, so the page says so
// up front. Roster managers only; the next step (importing the new roster)
// is a link away.

import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can, hasFundAdminAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { YearRollover } from "@/components/admin/YearRollover";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, ViewLink } from "@/components/ui/PageHeader";
import { formatDate } from "@/lib/format";
import type { AcademicYear } from "@/types/domain";
import { adminTitle } from "../admin-metadata";

// Titled only for the people who can roll the year over. Other officers
// still get the page, with a notice in place of the controls, under the
// fund's plain title.
export const generateMetadata = adminTitle("year", "Academic year");

function nextYearLabel(current: string): string | null {
  const m = current.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return `${Number(m[1]) + 1}-${String((Number(m[2]) + 1) % 100).padStart(2, "0")}`;
}

export default async function YearAdminPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!hasFundAdminAccess(ctx)) notFound();

  if (!can(ctx, "manage_roster")) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <PageHeader
          title="Academic year"
          actions={
            <ViewLink href={`/${ctx.fund.slug}/team`}>View team</ViewLink>
          }
        />
        <p className="glass-card p-6 text-sm text-muted">
          The president, vice president, director of alumni relations, and
          app admins start each new year for both funds.
        </p>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: yearRows } = await supabase
    .from("academic_years")
    .select("*")
    .order("starts_on", { ascending: false });
  const years = (yearRows as AcademicYear[]) ?? [];
  const next = nextYearLabel(ctx.currentYear.label);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Academic year"
        description="Shared by both funds. Starting a new year here starts it for Athena and Arch at once."
      />

      <Card>
        <CardHeader title="Years" />
        <div className="p-4 sm:p-6">
          <ul className="space-y-1.5">
            {years.map((y) => (
              <li
                key={y.id}
                className="flex items-center justify-between rounded-lg bg-highlight px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{y.label}</span>
                  <span className="text-muted">
                    {" "}
                    · {formatDate(y.starts_on)} to {formatDate(y.ends_on)}
                  </span>
                </span>
                {y.is_current && <Badge tone="accent">current</Badge>}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {next && (
        <Card>
          <CardHeader title={`Start ${next}`} />
          <div className="p-4 sm:p-6">
            <YearRollover
              fund={ctx.fund.slug}
              currentLabel={ctx.currentYear.label}
              nextLabel={next}
              rosterImportHref={`/${ctx.fund.slug}/admin/members#roster-import`}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
