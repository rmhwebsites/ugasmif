"use client";

// Inline roster editing (SPEC 11.3 /admin/members): role, sector, leader
// flag, status, title. Each change PATCHes immediately.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  Membership,
  MembershipRole,
  MembershipStatus,
  Profile,
  Sector,
} from "@/types/domain";

export interface RosterRow extends Membership {
  profiles: Pick<Profile, "id" | "full_name" | "email"> | null;
}

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

const selectClass =
  "rounded-lg border border-input-border bg-input-bg px-2 py-1 text-xs outline-none transition-colors focus:border-accent";

export function MemberEditor({
  fund,
  members,
  sectors,
}: {
  fund: string;
  members: RosterRow[];
  sectors: Pick<Sector, "id" | "name">[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/${fund}/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Update failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-loss">{error}</p>}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="sticky left-0 z-10 bg-sticky px-4 py-2.5 font-medium backdrop-blur-xl">
                  Member
                </th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Sector</th>
                <th className="px-3 py-2.5 text-center font-medium">Leader</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Account</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.id}
                  className={`border-b border-card-border/50 ${
                    busyId === m.id ? "opacity-50" : ""
                  }`}
                >
                  <td className="sticky left-0 z-10 bg-sticky px-4 py-2.5 backdrop-blur-xl">
                    <p className="font-medium">{m.profiles?.full_name ?? "—"}</p>
                    <p className="text-xs text-muted">{m.profiles?.email}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={m.role}
                      onChange={(e) => patch(m.id, { role: e.target.value })}
                      className={selectClass}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={m.sector_id ?? ""}
                      onChange={(e) =>
                        patch(m.id, { sector_id: e.target.value || null })
                      }
                      className={selectClass}
                    >
                      <option value="">—</option>
                      {sectors.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={m.is_sector_leader}
                      onChange={(e) =>
                        patch(m.id, { is_sector_leader: e.target.checked })
                      }
                      aria-label={`${m.profiles?.full_name ?? "Member"} leads their sector`}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={m.status}
                      onChange={(e) => patch(m.id, { status: e.target.value })}
                      className={selectClass}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {m.profiles && (
                      <Link
                        href={`/${fund}/admin/members/${m.profiles.id}`}
                        className="text-xs text-accent hover:underline"
                      >
                        Manage
                      </Link>
                    )}
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
        is_sector_leader: form.is_sector_leader,
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
        className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? "Adding…" : "Add member"}
      </button>
      <label className="flex items-center gap-2 text-sm sm:col-span-5">
        <input
          type="checkbox"
          checked={form.is_sector_leader}
          onChange={(e) =>
            setForm({ ...form, is_sector_leader: e.target.checked })
          }
        />
        Sector leader
      </label>
      {error && <p className="text-sm text-loss sm:col-span-5">{error}</p>}
      {notice && <p className="text-sm text-gain sm:col-span-5">{notice}</p>}
    </form>
  );
}
