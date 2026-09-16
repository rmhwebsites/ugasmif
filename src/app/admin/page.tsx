// /admin — cross-fund app admin: users and global flags, backup runs,
// environment health (SPEC 11.3).

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  UsersTable,
  HealthPanel,
  type AdminUserRow,
} from "@/components/admin/AppAdminTools";
import { RunBackupButton } from "@/components/admin/RunBackupButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/format";
import type {
  AcademicYear,
  BackupRun,
  Fund,
  Membership,
  Profile,
} from "@/types/domain";

export const metadata: Metadata = { title: "App Admin" };

type MembershipRow = Membership & {
  funds: Pick<Fund, "name" | "slug"> | null;
  academic_years: Pick<AcademicYear, "label"> | null;
};

export default async function AppAdminPage() {
  const { user, profile, supabase: authClient } = await getAuthState();
  if (!user || !profile) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const [profilesRes, membershipsRes, runsRes, fundsRes] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    supabase
      .from("memberships")
      .select("*, funds(name, slug), academic_years(label)"),
    supabase
      .from("backup_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10),
    authClient.from("funds").select("*").order("slug"),
  ]);

  const profiles = (profilesRes.data as Profile[]) ?? [];
  const memberships = (membershipsRes.data as MembershipRow[]) ?? [];
  const runs = (runsRes.data as BackupRun[]) ?? [];
  const funds = (fundsRes.data as Fund[]) ?? [];

  const users: AdminUserRow[] = profiles.map((p) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    is_app_admin: p.is_app_admin,
    is_faculty_advisor: p.is_faculty_advisor,
    memberships: memberships
      .filter((m) => m.user_id === p.id && m.status === "active")
      .map(
        (m) =>
          `${m.funds?.name ?? "?"} ${m.academic_years?.label ?? ""} (${m.role.replace("_", " ")})`
      ),
  }));

  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">App Admin</h1>

      <div className="flex flex-wrap gap-2">
        {funds.map((f) => (
          <Link
            key={f.id}
            href={`/${f.slug}/admin`}
            className="rounded-lg border border-input-border bg-input-bg px-4 py-2 text-sm font-medium transition-colors hover:bg-highlight"
          >
            {f.name} admin →
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader title="Users and global flags" />
        <div className="p-4 sm:p-6">
          <p className="mb-3 text-sm text-muted">
            App admins get full access to both funds and every admin tool (but
            never vote). The faculty advisor reads everything and can execute
            trades.
          </p>
          <UsersTable users={users} currentUserId={user.id} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Environment health" />
        <div className="p-4 sm:p-6">
          <HealthPanel />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Backup runs"
          action={<RunBackupButton />}
        />
        <div className="p-4 sm:p-6">
          {runs.length === 0 ? (
            <p className="text-sm text-muted">
              No backup has run yet. The nightly cron runs at 08:00 UTC, or run
              one now.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-highlight px-3 py-2 text-sm"
                >
                  <span>
                    {formatDateTime(r.started_at)}
                    <span className="text-muted">
                      {" "}
                      · {r.triggered_by === "cron" ? "cron" : "manual"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {r.rows_written !== null && (
                      <span className="text-xs text-muted tabular-nums">
                        {r.tabs_written} tabs · {r.rows_written} rows
                      </span>
                    )}
                    <Badge
                      tone={
                        r.status === "ok"
                          ? "gain"
                          : r.status === "failed"
                          ? "loss"
                          : "neutral"
                      }
                      title={r.error ?? undefined}
                    >
                      {r.status}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
