// /[fund]/admin/year — academic year rollover (SPEC 17.2). Acts on both
// funds; roster managers only.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { YearRollover } from "@/components/admin/YearRollover";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import type { AcademicYear } from "@/types/domain";

export const metadata: Metadata = { title: "Academic Year" };

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

  if (!can(ctx, "manage_roster")) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="font-medium">Academic year rollover</p>
        <p className="mt-1 text-sm text-muted">
          The president, vice president, alumni relations director, and app
          admins run the yearly rollover.
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
      <h1 className="text-2xl font-bold sm:text-3xl">Academic Year</h1>

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
            />
          </div>
        </Card>
      )}
    </div>
  );
}
