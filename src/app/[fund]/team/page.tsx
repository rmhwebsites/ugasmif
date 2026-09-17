// /[fund]/team — roster grouped by sector with roles; past years selectable
// (SPEC 11.2). Laid out as a portrait grid: a roster is people, and a wall of
// names in rows reads like a spreadsheet. Members who haven't uploaded a photo
// get a generated stand-in (see components/ui/Avatar).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { roleLabel, OFFICER_ROLES } from "@/lib/permissions";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import type {
  AcademicYear,
  Membership,
  Profile,
  Sector,
} from "@/types/domain";

export const metadata: Metadata = { title: "Team" };

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name" | "email" | "avatar_url"> | null;
};

/** One person in the roster grid. */
function MemberTile({
  member,
  subtitle,
}: {
  member: MemberRow;
  subtitle: ReactNode;
}) {
  const name = member.profiles?.full_name ?? "Unnamed member";
  return (
    <li className="flex flex-col items-center rounded-xl bg-highlight p-3 text-center transition-colors hover:bg-accent-soft sm:p-4">
      <Avatar
        src={member.profiles?.avatar_url}
        seed={member.user_id}
        name={name}
        size="lg"
        className={`sm:h-20 sm:w-20 ${
          member.is_sector_leader ? "ring-2 ring-accent" : ""
        }`}
      />
      <p className="mt-2 text-sm font-medium leading-snug text-balance">
        {name}
      </p>
      <div className="mt-1 text-xs leading-snug">{subtitle}</div>
    </li>
  );
}

const GRID =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5";

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { fund: slug } = await params;
  const { year: yearParam } = await searchParams;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: yearRows } = await supabase
    .from("academic_years")
    .select("*")
    .order("starts_on", { ascending: false });
  const years = (yearRows as AcademicYear[]) ?? [];
  const selectedYear =
    years.find((y) => y.label === yearParam) ?? ctx.currentYear;
  const isCurrentYear = selectedYear.id === ctx.currentYear.id;

  const [membersRes, sectorsRes] = await Promise.all([
    supabase
      .from("memberships")
      .select("*, profiles(full_name, email, avatar_url)")
      .eq("fund_id", ctx.fund.id)
      .eq("academic_year_id", selectedYear.id)
      .order("created_at"),
    supabase
      .from("sectors")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .order("sort_order"),
  ]);

  const members = (membersRes.data as MemberRow[]) ?? [];
  const sectors = (sectorsRes.data as Sector[]) ?? [];
  const officers = members.filter((m) =>
    OFFICER_ROLES.includes(m.role)
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Team</h1>
        <div className="flex gap-1.5">
          {years.map((y) => (
            <Link
              key={y.id}
              href={`/${ctx.fund.slug}/team${
                y.id === ctx.currentYear.id ? "" : `?year=${y.label}`
              }`}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                y.id === selectedYear.id
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-highlight hover:text-foreground"
              }`}
            >
              {y.label}
            </Link>
          ))}
        </div>
      </div>

      {!isCurrentYear && (
        <p className="rounded-lg bg-highlight px-4 py-2 text-sm text-muted">
          Viewing the {selectedYear.label} roster. These members are alumni
          now.
        </p>
      )}

      {members.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="font-medium">No roster for {selectedYear.label}</p>
          <p className="mt-1 text-sm text-muted">
            Officers import the roster from the members admin page.
          </p>
        </div>
      ) : (
        <>
          {/* Officers */}
          <section className="glass-card p-4 sm:p-6">
            <h2 className="mb-3 text-base font-semibold sm:text-lg">
              Officers
            </h2>
            {officers.length === 0 ? (
              <p className="text-sm text-muted">No officers recorded.</p>
            ) : (
              <ul className={GRID}>
                {officers.map((m) => (
                  <MemberTile
                    key={m.id}
                    member={m}
                    subtitle={
                      <span className="text-accent">
                        {roleLabel(m.role, m.title_override)}
                      </span>
                    }
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Sector groups */}
          {sectors.map((sector) => {
            const group = members
              .filter((m) => m.sector_id === sector.id)
              .sort(
                (a, b) =>
                  Number(b.is_sector_leader) - Number(a.is_sector_leader)
              );
            if (group.length === 0) return null;
            return (
              <section key={sector.id} className="glass-card p-4 sm:p-6">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-base font-semibold sm:text-lg">
                    {sector.name}
                  </h2>
                  {sector.is_strategy_team && (
                    <Badge tone="info">strategy team</Badge>
                  )}
                </div>
                <ul className={GRID}>
                  {group.map((m) => (
                    <MemberTile
                      key={m.id}
                      member={m}
                      subtitle={
                        m.is_sector_leader ? (
                          <Badge tone="accent">leader</Badge>
                        ) : (
                          <span className="text-muted">
                            {roleLabel(m.role, m.title_override)}
                          </span>
                        )
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
