"use client";

// Cross-fund user flags + the environment health panel (SPEC 11.3 /admin).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import {
  SortButton,
  useSortedRows,
  type SortableColumn,
} from "@/components/ui/SortableTable";

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  is_app_admin: boolean;
  is_faculty_advisor: boolean;
  memberships: string[];
}

const USER_HEADERS: { key: string; label: string; align?: "center" }[] = [
  { key: "user", label: "User" },
  { key: "memberships", label: "Memberships" },
  { key: "appAdmin", label: "App admin", align: "center" },
  { key: "advisor", label: "Advisor", align: "center" },
];

const USER_SORT: Pick<
  SortableColumn<AdminUserRow>,
  "key" | "sortValue" | "defaultDir"
>[] = [
  { key: "user", defaultDir: "asc", sortValue: (u) => u.full_name },
  // By count: the question this column gets asked is who is on nothing and
  // who is on both funds.
  { key: "memberships", sortValue: (u) => u.memberships.length },
  { key: "appAdmin", sortValue: (u) => (u.is_app_admin ? 1 : 0) },
  { key: "advisor", sortValue: (u) => (u.is_faculty_advisor ? 1 : 0) },
];

export function UsersTable({
  users,
  currentUserId,
}: {
  users: AdminUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function setFlag(
    userId: string,
    flag: "is_app_admin" | "is_faculty_advisor",
    value: boolean
  ) {
    setBusyId(userId);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, [flag]: value }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Update failed.");
      return;
    }
    router.refresh();
  }

  const filtered = query.trim()
    ? users.filter(
        (u) =>
          u.full_name.toLowerCase().includes(query.toLowerCase()) ||
          u.email.toLowerCase().includes(query.toLowerCase())
      )
    : users;

  const { sorted, sort, toggle } = useSortedRows(filtered, USER_SORT, {
    key: "user",
    dir: "asc",
  });

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name or email"
        className="w-full max-w-xs rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {error && <p className="text-sm text-loss">{error}</p>}
      <div className="glass-card overflow-hidden">
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm" style={{ minWidth: 640 }}>
            <thead className="sticky top-0 bg-sticky backdrop-blur-xl">
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-wider text-muted">
                {USER_HEADERS.map((head, i) => (
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
                    className={`py-2.5 font-medium ${
                      i === 0 ? "sticky left-0 z-10 bg-sticky px-4 backdrop-blur-xl" : "px-3"
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
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr
                  key={u.id}
                  className={`border-b border-card-border/50 ${
                    busyId === u.id ? "opacity-50" : ""
                  }`}
                >
                  <td className="sticky left-0 z-10 bg-sticky px-4 py-2.5 backdrop-blur-xl">
                    <p className="font-medium">{u.full_name}</p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">
                    {u.memberships.length > 0
                      ? u.memberships.join(", ")
                      : "none"}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={u.is_app_admin}
                      disabled={u.id === currentUserId && u.is_app_admin}
                      title={
                        u.id === currentUserId && u.is_app_admin
                          ? "You can't remove your own admin flag."
                          : undefined
                      }
                      onChange={(e) =>
                        setFlag(u.id, "is_app_admin", e.target.checked)
                      }
                      aria-label={`${u.full_name} is an app admin`}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={u.is_faculty_advisor}
                      onChange={(e) =>
                        setFlag(u.id, "is_faculty_advisor", e.target.checked)
                      }
                      aria-label={`${u.full_name} is the faculty advisor`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

interface HealthResponse {
  checks: {
    yahoo: { ok: boolean; price?: number; stale?: boolean; error?: string };
    treasuryCurve: {
      ok: boolean;
      latestDate: string | null;
      ageDays: number | null;
    };
    backup: { ok: boolean; lastRun: { status: string; started_at: string } | null };
    resendConfigured: boolean;
    googleSheetsConfigured: boolean;
  };
}

function toRows(data: HealthResponse): HealthCheck[] {
  const { yahoo, treasuryCurve, backup, resendConfigured, googleSheetsConfigured } =
    data.checks;
  return [
    {
      name: "Yahoo Finance",
      ok: yahoo.ok,
      detail: yahoo.ok
        ? `SPY ${yahoo.price?.toFixed(2) ?? "—"}`
        : yahoo.error ?? "unreachable or serving stale prices",
    },
    {
      name: "Treasury curve",
      ok: treasuryCurve.ok,
      detail: treasuryCurve.latestDate
        ? `latest ${treasuryCurve.latestDate} (${treasuryCurve.ageDays}d old)`
        : "never fetched",
    },
    {
      name: "Nightly backup",
      ok: backup.ok,
      detail: backup.lastRun
        ? `${backup.lastRun.status} at ${formatDateTime(
            backup.lastRun.started_at
          )} ET`
        : "never run",
    },
    {
      name: "Resend (email)",
      ok: resendConfigured,
      detail: resendConfigured ? "configured" : "RESEND_API_KEY not set",
    },
    {
      name: "Google Sheets backup",
      ok: googleSheetsConfigured,
      detail: googleSheetsConfigured
        ? "configured"
        : "GOOGLE_* env vars not set",
    },
  ];
}

export function HealthPanel() {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((data: HealthResponse) => setChecks(toRows(data)))
      .catch(() => setError("Could not load environment health."));
  }, []);

  if (error) return <p className="text-sm text-loss">{error}</p>;
  if (!checks) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li
          key={c.name}
          className="flex items-center justify-between gap-2 rounded-lg bg-highlight px-3 py-2 text-sm"
        >
          <span>
            {c.name}
            {c.detail && (
              <span className="text-muted"> · {c.detail}</span>
            )}
          </span>
          <Badge tone={c.ok ? "gain" : "loss"}>{c.ok ? "ok" : "check"}</Badge>
        </li>
      ))}
    </ul>
  );
}
