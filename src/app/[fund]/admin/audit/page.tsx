// /[fund]/admin/audit — the audit log with filters (SPEC 11.3).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDateTime } from "@/lib/format";
import type { AuditLogEntry, Membership, Profile } from "@/types/domain";

export const metadata: Metadata = { title: "Audit Log" };

type MemberRow = Membership & {
  profiles: Pick<Profile, "id" | "full_name"> | null;
};

const PAGE_SIZE = 200;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<{
    action?: string;
    entity?: string;
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

  let query = supabase
    .from("audit_log")
    .select("*")
    .eq("fund_id", ctx.fund.id)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (filters.action) query = query.ilike("action", `%${filters.action}%`);
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
  const entities = [...new Set(entries.map((e) => e.entity))].sort();

  const inputClass =
    "w-full min-w-0 rounded-lg border border-input-border bg-input-bg px-3 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Audit Log</h1>

      <form className="glass-card flex flex-wrap items-end gap-2 p-4">
        <label className="min-w-[8rem] flex-1 text-xs text-muted">
          <span className="mb-1 block">Action contains</span>
          <input
            name="action"
            defaultValue={filters.action ?? ""}
            className={inputClass}
            placeholder="trade.execute"
          />
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-muted">
          <span className="mb-1 block">Entity</span>
          <select
            name="entity"
            defaultValue={filters.entity ?? ""}
            className={inputClass}
          >
            <option value="">All</option>
            {entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-muted">
          <span className="mb-1 block">Actor</span>
          <select
            name="actor"
            defaultValue={filters.actor ?? ""}
            className={inputClass}
          >
            <option value="">Anyone</option>
            {[...nameById.entries()].map(([id, name]) => (
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
        <button
          type="submit"
          className="cursor-pointer rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Filter
        </button>
      </form>

      {entries.length === 0 ? (
        <EmptyState
          title="No audit entries match"
          hint="Every trade, roster change, and password reset lands here. Widen the filters or check back after the next class."
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 700 }}>
              <thead>
                <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Actor</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 font-medium">Entity</th>
                  <th className="px-3 py-2.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-card-border/50 align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                      {formatDateTime(e.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      {e.actor_id
                        ? nameById.get(e.actor_id) ?? "(former member)"
                        : "system"}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{e.action}</td>
                    <td className="px-3 py-2.5 text-muted">{e.entity}</td>
                    <td className="px-3 py-2.5">
                      {(e.before || e.after) && (
                        <details>
                          <summary className="cursor-pointer text-xs text-accent">
                            before / after
                          </summary>
                          <pre className="mt-1 max-w-md overflow-x-auto rounded bg-highlight p-2 text-[10px] leading-relaxed">
{JSON.stringify({ before: e.before, after: e.after }, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
