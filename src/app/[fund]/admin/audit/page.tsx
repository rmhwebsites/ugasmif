// /[fund]/admin/audit — the audit log with filters (SPEC 11.3). Filters use
// plain names ("Membership change", "Members") from auditLabels, not the raw
// codes. Query params: action=<code> (exact for a known code, "contains"
// for anything else typed into the URL), entity=<table>, actor=<user id>,
// from/to=<date>, and entity_id=<id>[,<id>] for one record's history, which
// is what the "History" links on other pages open.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { AuditTable } from "@/components/tables/AuditTable";
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ENTITIES,
  auditActionLabel,
  auditEntityLabel,
  isKnownAuditAction,
} from "@/components/admin/auditLabels";
import type { AuditLogEntry, Membership, Profile } from "@/types/domain";
import { adminTitle } from "../admin-metadata";

export const generateMetadata = adminTitle("audit", "Audit log");

type MemberRow = Membership & {
  profiles: Pick<Profile, "id" | "full_name"> | null;
};

const PAGE_SIZE = 200;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<{
    action?: string;
    entity?: string;
    entity_id?: string;
    actor?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { fund: slug } = await params;
  const filters = await searchParams;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!can(ctx, "view_audit_log")) notFound();

  const supabase = await createSupabaseServerClient();

  // One record's history: its ids, e.g. a membership and its member's
  // account. Account-level rows (password resets) carry no fund, so that
  // view includes them; the policy shows them to app admins and the advisor.
  const recordIds = (filters.entity_id ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ID_PATTERN.test(s))
    .slice(0, 5);

  let query = supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (recordIds.length > 0) {
    query = query
      .in("entity_id", recordIds)
      .or(`fund_id.eq.${ctx.fund.id},fund_id.is.null`);
  } else {
    query = query.eq("fund_id", ctx.fund.id);
  }
  if (filters.action) {
    query = isKnownAuditAction(filters.action)
      ? query.eq("action", filters.action)
      : query.ilike("action", `%${filters.action}%`);
  }
  if (filters.entity) query = query.eq("entity", filters.entity);
  if (filters.actor) query = query.eq("actor_id", filters.actor);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59Z`);

  const [entriesRes, membersRes] = await Promise.all([
    query,
    supabase
      .from("memberships")
      .select("*, profiles(id, full_name)")
      .eq("fund_id", ctx.fund.id)
      .eq("academic_year_id", ctx.currentYear.id),
  ]);

  const entries = (entriesRes.data as AuditLogEntry[]) ?? [];
  const members = (membersRes.data as MemberRow[]) ?? [];
  const nameById = new Map(
    members
      .filter((m) => m.profiles)
      .map((m) => [m.profiles!.id, m.profiles!.full_name])
  );
  const actors = [...nameById.entries()].sort((a, b) =>
    a[1].localeCompare(b[1])
  );
  const filtered = Boolean(
    filters.action ||
      filters.entity ||
      filters.actor ||
      filters.from ||
      filters.to ||
      recordIds.length > 0
  );

  const inputClass =
    "w-full min-w-0 rounded-lg border border-input-border bg-input-bg px-3 py-1.5 text-sm outline-none focus:border-accent";
  const base = `/${ctx.fund.slug}/admin/audit`;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Audit log"
        description={`Every trade, vote, membership change and settings change in ${ctx.fund.name}, newest first.`}
      />

      {recordIds.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-accent-soft px-4 py-2 text-sm">
          <span>
            Showing one record&apos;s history
            {filters.entity ? ` in ${auditEntityLabel(filters.entity)}` : ""}.
          </span>
          <Link href={base} className="font-medium text-accent-text hover:underline">
            Show all activity
          </Link>
        </p>
      )}

      <form className="glass-card flex flex-wrap items-end gap-2 p-4">
        {recordIds.length > 0 && (
          <input type="hidden" name="entity_id" value={recordIds.join(",")} />
        )}
        <label className="min-w-[10rem] flex-1 text-xs text-muted">
          <span className="mb-1 block">What happened</span>
          <select
            name="action"
            defaultValue={filters.action ?? ""}
            className={inputClass}
          >
            <option value="">Anything</option>
            {filters.action && !isKnownAuditAction(filters.action) && (
              <option value={filters.action}>
                Contains &ldquo;{filters.action}&rdquo;
              </option>
            )}
            {AUDIT_ACTION_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.actions.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-muted">
          <span className="mb-1 block">Record</span>
          <select
            name="entity"
            defaultValue={filters.entity ?? ""}
            className={inputClass}
          >
            <option value="">Any record</option>
            {AUDIT_ENTITIES.map((e) => (
              <option key={e.code} value={e.code}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-muted">
          <span className="mb-1 block">Who</span>
          <select
            name="actor"
            defaultValue={filters.actor ?? ""}
            className={inputClass}
          >
            <option value="">Anyone</option>
            {actors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-muted">
          <span className="mb-1 block">From</span>
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ""}
            className={inputClass}
          />
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-muted">
          <span className="mb-1 block">To</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ""}
            className={inputClass}
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="cursor-pointer rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Filter
          </button>
          {filtered && (
            <Link
              href={base}
              className="text-sm text-muted hover:text-foreground hover:underline"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {entries.length === 0 ? (
        <EmptyState
          title="No audit entries match"
          hint="Every trade, membership change, and settings change lands here. Widen the filters or check back after the next class."
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <AuditTable
            entries={entries.map((e) => ({
              ...e,
              actorName: e.actor_id
                ? nameById.get(e.actor_id) ?? "(former member)"
                : "system",
              actionLabel: auditActionLabel(e.action),
              entityLabel: auditEntityLabel(e.entity),
            }))}
          />
          {entries.length === PAGE_SIZE && (
            <p className="border-t border-card-border px-4 py-2 text-xs text-muted">
              Showing the most recent {PAGE_SIZE} entries. Narrow the filters to
              see older activity.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
