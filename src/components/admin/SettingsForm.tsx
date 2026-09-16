"use client";

// Fund settings form (SPEC 11.3 /admin/settings).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { Fund } from "@/types/domain";

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";
const labelClass = "mb-1 block text-xs font-medium text-muted";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SettingsForm({ fund }: { fund: Fund }) {
  const router = useRouter();
  const [form, setForm] = useState({
    vote_pass_threshold_pct: String(fund.vote_pass_threshold_pct),
    vote_quorum_pct: fund.vote_quorum_pct === null ? "" : String(fund.vote_quorum_pct),
    vote_default_window_hours: String(fund.vote_default_window_hours),
    benchmark_symbol: fund.benchmark_symbol,
    benchmark_name: fund.benchmark_name,
    allowed_email_domains: fund.allowed_email_domains.join(", "),
    meeting_day: fund.meeting_day === null ? "" : String(fund.meeting_day),
    sector_can_vote_on_own_pitch:
      fund.settings.sector_can_vote_on_own_pitch !== false,
    alumni_can_view_current: fund.settings.alumni_can_view_current !== false,
    stale_mark_days: String(fund.settings.stale_mark_days ?? 7),
    reply_to_email: String(fund.settings.reply_to_email ?? ""),
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    const res = await fetch(`/api/${fund.slug}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vote_pass_threshold_pct: Number(form.vote_pass_threshold_pct),
        vote_quorum_pct:
          form.vote_quorum_pct.trim() === ""
            ? null
            : Number(form.vote_quorum_pct),
        vote_default_window_hours: Number(form.vote_default_window_hours),
        benchmark_symbol: form.benchmark_symbol.trim().toUpperCase(),
        benchmark_name: form.benchmark_name.trim(),
        allowed_email_domains: form.allowed_email_domains
          .split(",")
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean),
        meeting_day:
          form.meeting_day === "" ? null : Number(form.meeting_day),
        settings: {
          sector_can_vote_on_own_pitch: form.sector_can_vote_on_own_pitch,
          alumni_can_view_current: form.alumni_can_view_current,
          stale_mark_days: Number(form.stale_mark_days),
          reply_to_email: form.reply_to_email.trim(),
        },
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Save failed.");
      return;
    }
    setNotice("Settings saved.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className={labelClass}>Vote pass threshold (% of votes cast)</label>
        <input
          type="number"
          step="0.5"
          min="1"
          max="100"
          value={form.vote_pass_threshold_pct}
          onChange={(e) =>
            setForm({ ...form, vote_pass_threshold_pct: e.target.value })
          }
          className={inputClass}
          required
        />
      </div>
      <div>
        <label className={labelClass}>Quorum (% of eligible, blank = none)</label>
        <input
          type="number"
          step="1"
          min="1"
          max="100"
          value={form.vote_quorum_pct}
          onChange={(e) => setForm({ ...form, vote_quorum_pct: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Default vote window (hours)</label>
        <input
          type="number"
          min="1"
          max="336"
          value={form.vote_default_window_hours}
          onChange={(e) =>
            setForm({ ...form, vote_default_window_hours: e.target.value })
          }
          className={inputClass}
          required
        />
      </div>
      <div>
        <label className={labelClass}>Meeting day</label>
        <select
          value={form.meeting_day}
          onChange={(e) => setForm({ ...form, meeting_day: e.target.value })}
          className={inputClass}
        >
          <option value="">—</option>
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Benchmark symbol (Yahoo)</label>
        <input
          value={form.benchmark_symbol}
          onChange={(e) =>
            setForm({ ...form, benchmark_symbol: e.target.value })
          }
          className={inputClass}
          required
        />
      </div>
      <div>
        <label className={labelClass}>Benchmark display name</label>
        <input
          value={form.benchmark_name}
          onChange={(e) => setForm({ ...form, benchmark_name: e.target.value })}
          className={inputClass}
          required
        />
      </div>
      <div className="sm:col-span-2">
        <label className={labelClass}>
          Allowed email domains (comma-separated)
        </label>
        <input
          value={form.allowed_email_domains}
          onChange={(e) =>
            setForm({ ...form, allowed_email_domains: e.target.value })
          }
          className={inputClass}
          placeholder="uga.edu, rmh.productions"
          required
        />
      </div>
      <div>
        <label className={labelClass}>Stale mark threshold (days)</label>
        <input
          type="number"
          min="1"
          max="60"
          value={form.stale_mark_days}
          onChange={(e) => setForm({ ...form, stale_mark_days: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Reply-to email for app emails</label>
        <input
          type="email"
          value={form.reply_to_email}
          onChange={(e) => setForm({ ...form, reply_to_email: e.target.value })}
          className={inputClass}
          placeholder="president@uga.edu"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.sector_can_vote_on_own_pitch}
          onChange={(e) =>
            setForm({ ...form, sector_can_vote_on_own_pitch: e.target.checked })
          }
        />
        Pitching sector can vote on its own pitch
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.alumni_can_view_current}
          onChange={(e) =>
            setForm({ ...form, alumni_can_view_current: e.target.checked })
          }
        />
        Alumni can view the current dashboard
      </label>

      {error && <p className="text-sm text-loss sm:col-span-2">{error}</p>}
      {notice && <p className="text-sm text-gain sm:col-span-2">{notice}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
