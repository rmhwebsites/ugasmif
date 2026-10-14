"use client";

// Inline roster editing (SPEC 11.3 /admin/members): role, sector, leader
// flag, status, title. Each change PATCHes immediately. The same controls
// sit on one member's page (MembershipControls), which the names link to.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useScrollToHash } from "@/components/admin/HoldingsAdmin";
import {
  SortButton,
  useSortedRows,
  type SortableColumn,
} from "@/components/ui/SortableTable";
import type {
  Membership,
  MembershipRole,
  MembershipStatus,
  Profile,
  Sector,
} from "@/types/domain";

export interface RosterRow extends Membership {
  profiles: Pick<
    Profile,
    "id" | "full_name" | "email" | "onboarded_at"
  > | null;
}

type MembershipFields = Pick<
  Membership,
  "id" | "role" | "sector_id" | "is_sector_leader" | "status"
>;

const ROLES: MembershipRole[] = [
  "president",
  "vice_president",
  "portfolio_manager",
  "alumni_relations",
  "sector_leader",
  "analyst",
  "viewer",
];

const STATUSES: MembershipStatus[] = ["active", "alumni", "inactive"];

const HEADERS: { key: string; label: string; align?: "center" }[] = [
  { key: "member", label: "Member" },
  { key: "role", label: "Role" },
  { key: "sector", label: "Sector" },
  { key: "leader", label: "Leads sector", align: "center" },
  { key: "status", label: "Status" },
];

const selectClass =
  "rounded-lg border border-input-border bg-input-bg px-2 py-1 text-xs outline-none transition-colors focus:border-accent";

/** Where role and leadership are set, said once for the list and the
 *  member page alike. */
export const LEADER_HINT =
  "Leads sector is what lets a member submit pitches for their sector. The sector leader role and this box stay in step: setting one sets the other.";

/**
 * The PATCH body for one change. Role and the leader flag move together for
 * analysts and sector leaders: leadsSector() reads only the flag, so a
 * "Sector Leader" title without it could not submit pitches. Officers keep
 * their role when they lead a sector.
 */
export function membershipChange(
  m: MembershipFields,
  change: Partial<MembershipFields>
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...change };
  if (change.role !== undefined) {
    if (change.role === "sector_leader" && !m.is_sector_leader) {
      body.is_sector_leader = true;
    } else if (
      m.role === "sector_leader" &&
      m.is_sector_leader &&
      (change.role === "analyst" || change.role === "viewer")
    ) {
      body.is_sector_leader = false;
    }
  }
  if (change.is_sector_leader !== undefined) {
    if (change.is_sector_leader && m.role === "analyst") {
      body.role = "sector_leader";
    } else if (!change.is_sector_leader && m.role === "sector_leader") {
      body.role = "analyst";
    }
  }
  return body;
}

/** PATCH one membership, with the row busy and any error shown meanwhile. */
function useMembershipPatch(fund: string) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(
    m: MembershipFields,
    change: Partial<MembershipFields>
  ) {
    setBusyId(m.id);
    setError(null);
    const res = await fetch(`/api/${fund}/members/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(membershipChange(m, change)),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Update failed.");
      return;
    }
    router.refresh();
  }

  return { patch, busyId, error };
}

/** The inline controls for one membership, shared by the list and the page. */
function RoleSelect({
  m,
  onChange,
  className = selectClass,
  id,
}: {
  m: MembershipFields;
  onChange: (change: Partial<MembershipFields>) => void;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={m.role}
      onChange={(e) => onChange({ role: e.target.value as MembershipRole })}
      className={className}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {r.replace("_", " ")}
        </option>
      ))}
    </select>
  );
}

function SectorSelect({
  m,
  sectors,
  onChange,
  className = selectClass,
  id,
}: {
  m: MembershipFields;
  sectors: Pick<Sector, "id" | "name">[];
  onChange: (change: Partial<MembershipFields>) => void;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={m.sector_id ?? ""}
      onChange={(e) => onChange({ sector_id: e.target.value || null })}
      className={className}
    >
      <option value="">—</option>
      {sectors.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function StatusSelect({
  m,
  onChange,
  className = selectClass,
  id,
}: {
  m: MembershipFields;
  onChange: (change: Partial<MembershipFields>) => void;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={m.status}
      onChange={(e) =>
        onChange({ status: e.target.value as MembershipStatus })
      }
      className={className}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

/** Leading means nothing without a sector, so the box waits for one. */
function leaderDisabled(m: MembershipFields): boolean {
  return !m.sector_id && !m.is_sector_leader;
}

export function MemberEditor({
  fund,
  members,
  sectors,
}: {
  fund: string;
  members: RosterRow[];
  sectors: Pick<Sector, "id" | "name">[];
}) {
  const { patch, busyId, error } = useMembershipPatch(fund);
  const [query, setQuery] = useState("");
  // #add-member and #roster-import sit below this table.
  useScrollToHash();

  // Sector sorts by the name the select shows, not the raw id.
  const sortColumns: Pick<
    SortableColumn<RosterRow>,
    "key" | "sortValue" | "defaultDir"
  >[] = useMemo(() => {
    const sectorName = new Map(sectors.map((x) => [x.id, x.name]));
    return [
      {
        key: "member",
        defaultDir: "asc",
        sortValue: (m: RosterRow) => m.profiles?.full_name ?? "",
      },
      { key: "role", defaultDir: "asc", sortValue: (m: RosterRow) => m.role },
      {
        key: "sector",
        defaultDir: "asc",
        sortValue: (m: RosterRow) =>
          m.sector_id ? sectorName.get(m.sector_id) ?? "" : "",
      },
      {
        key: "leader",
        sortValue: (m: RosterRow) => (m.is_sector_leader ? 1 : 0),
      },
      {
        key: "status",
        defaultDir: "asc",
        sortValue: (m: RosterRow) => m.status,
      },
    ];
  }, [sectors]);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? members.filter((m) =>
        [m.profiles?.full_name, m.profiles?.email].some((v) =>
          v?.toLowerCase().includes(needle)
        )
      )
    : members;

  const { sorted, sort, toggle } = useSortedRows(visible, sortColumns, {
    key: "member",
    dir: "asc",
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search members</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            className="w-full rounded-lg border border-input-border bg-input-bg py-2 pr-3 pl-9 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>
        {needle && (
          <p className="text-xs text-muted tabular-nums">
            {visible.length} of {members.length}
          </p>
        )}
      </div>
      <p className="text-xs text-muted">
        Changes save as you make them. Open a name for that member&apos;s
        page, with sign-in help and their history.{" "}
        {LEADER_HINT}
      </p>
      {error && <p className="text-sm text-loss">{error}</p>}
      <div className="glass-card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm" style={{ minWidth: 720 }}>
            <thead>
              <tr className="border-b border-card-border text-left text-xs text-muted">
                {HEADERS.map((head, i) => (
                  <th
                    key={head.key}
                    scope="col"
                    aria-sort={
                      sort?.key === head.key
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={`sticky top-0 z-20 bg-sticky-card py-2.5 font-medium ${
                      i === 0 ? "left-0 z-30 px-4" : "px-3"
                    } ${head.align === "center" ? "text-center" : "text-left"}`}
                  >
                    <SortButton
                      label={head.label}
                      active={sort?.key === head.key}
                      dir={sort?.dir ?? "asc"}
                      onClick={() => toggle(head.key)}
                    />
                  </th>
                ))}
                <th className="sticky top-0 z-20 bg-sticky-card px-3 py-2.5 text-right font-medium">
                  <span className="sr-only">Member page</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                    No members match.
                  </td>
                </tr>
              )}
              {sorted.map((m) => {
                const name = m.profiles?.full_name ?? "—";
                const href = `/${fund}/admin/members/${m.id}`;
                const onChange = (change: Partial<MembershipFields>) =>
                  patch(m, change);
                return (
                  <tr
                    key={m.id}
                    className={`border-b border-card-border/50 ${
                      busyId === m.id ? "opacity-50" : ""
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-sticky-card px-4 py-2.5">
                      <Link
                        href={href}
                        className="font-medium hover:text-accent-text hover:underline"
                      >
                        {name}
                      </Link>
                      <p className="text-xs text-muted">{m.profiles?.email}</p>
                      {m.profiles && !m.profiles.onboarded_at && (
                        <Badge
                          tone="warn"
                          className="mt-1"
                          title="Has not finished signing up. Their page can resend the invite."
                        >
                          not signed up yet
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <RoleSelect m={m} onChange={onChange} />
                    </td>
                    <td className="px-3 py-2.5">
                      <SectorSelect m={m} sectors={sectors} onChange={onChange} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={m.is_sector_leader}
                        disabled={leaderDisabled(m)}
                        title={
                          leaderDisabled(m) ? "Pick a sector first" : undefined
                        }
                        onChange={(e) =>
                          onChange({ is_sector_leader: e.target.checked })
                        }
                        aria-label={`${name} leads their sector`}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusSelect m={m} onChange={onChange} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={href}
                        aria-label={`Open ${name}`}
                        className="rounded-md px-2 py-1.5 text-xs font-medium text-accent-text transition-colors hover:bg-highlight"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * One membership's role, sector, leader flag and status, laid out as a small
 * form for the member's own page. Saves each change as it is made, like the
 * list.
 */
export function MembershipControls({
  fund,
  membership,
  sectors,
}: {
  fund: string;
  membership: MembershipFields;
  sectors: Pick<Sector, "id" | "name">[];
}) {
  const { patch, busyId, error } = useMembershipPatch(fund);
  const m = membership;
  const onChange = (change: Partial<MembershipFields>) => patch(m, change);
  const fieldClass =
    "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";
  const labelClass = "mb-1 block text-xs font-medium text-muted";

  return (
    <div className={`space-y-3 ${busyId ? "opacity-60" : ""}`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="member-role" className={labelClass}>
            Role
          </label>
          <RoleSelect
            id="member-role"
            m={m}
            onChange={onChange}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="member-sector" className={labelClass}>
            Sector
          </label>
          <SectorSelect
            id="member-sector"
            m={m}
            sectors={sectors}
            onChange={onChange}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="member-status" className={labelClass}>
            Status
          </label>
          <StatusSelect
            id="member-status"
            m={m}
            onChange={onChange}
            className={fieldClass}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={m.is_sector_leader}
          disabled={leaderDisabled(m)}
          onChange={(e) => onChange({ is_sector_leader: e.target.checked })}
        />
        Leads sector
        {leaderDisabled(m) && (
          <span className="text-xs text-muted">(pick a sector first)</span>
        )}
      </label>
      <p className="text-xs text-muted">{LEADER_HINT}</p>
      {error && <p className="text-sm text-loss">{error}</p>}
    </div>
  );
}

export function AddMemberForm({
  fund,
  sectors,
}: {
  fund: string;
  sectors: Pick<Sector, "id" | "name">[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    role: "analyst" as MembershipRole,
    sector_id: "",
    is_sector_leader: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inputClass =
    "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    const res = await fetch(`/api/${fund}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email,
        full_name: form.full_name,
        role: form.role,
        sector_id: form.sector_id || null,
        // The sector leader role always comes with the flag (see
        // membershipChange).
        is_sector_leader:
          form.is_sector_leader || form.role === "sector_leader",
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Could not add the member.");
      return;
    }
    setNotice(
      data.invited
        ? `Added ${form.full_name} and emailed an invite.`
        : `Added ${form.full_name} to the roster (they already had an account).`
    );
    setForm({ ...form, email: "", full_name: "" });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-5">
      <input
        type="email"
        required
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        className={inputClass}
        placeholder="email@uga.edu"
      />
      <input
        required
        value={form.full_name}
        onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        className={inputClass}
        placeholder="Full name"
      />
      <select
        value={form.role}
        onChange={(e) =>
          setForm({ ...form, role: e.target.value as MembershipRole })
        }
        className={inputClass}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r.replace("_", " ")}
          </option>
        ))}
      </select>
      <select
        value={form.sector_id}
        onChange={(e) => setForm({ ...form, sector_id: e.target.value })}
        className={inputClass}
      >
        <option value="">No sector</option>
        {sectors.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={saving}
        className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? "Adding…" : "Add member"}
      </button>
      <label className="flex items-center gap-2 text-sm sm:col-span-5">
        <input
          type="checkbox"
          checked={form.is_sector_leader || form.role === "sector_leader"}
          disabled={form.role === "sector_leader"}
          onChange={(e) =>
            setForm({ ...form, is_sector_leader: e.target.checked })
          }
        />
        Leads sector
      </label>
      {error && <p className="text-sm text-loss sm:col-span-5">{error}</p>}
      {notice && <p className="text-sm text-gain sm:col-span-5">{notice}</p>}
    </form>
  );
}
