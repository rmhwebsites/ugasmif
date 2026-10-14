"use client";

// Post / pin / delete fund updates (SPEC 11.3 /admin/updates): one card to
// post a new update, one listing what is posted with its pin and delete
// controls, so each job has its own heading to find.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatDate } from "@/lib/format";
import type { FundUpdate } from "@/types/domain";

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export function UpdateEditor({
  fund,
  updates,
}: {
  fund: string;
  updates: FundUpdate[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    body_md: "",
    pinned: false,
    email_members: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const res = await fetch(`/api/${fund}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Could not post the update.");
      return;
    }
    setNotice(
      form.email_members ? "Posted and emailed to members." : "Posted."
    );
    setForm({ title: "", body_md: "", pinned: false, email_members: false });
    router.refresh();
  }

  async function togglePin(u: FundUpdate) {
    await fetch(`/api/${fund}/updates/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !u.pinned }),
    });
    router.refresh();
  }

  async function remove(u: FundUpdate) {
    if (!window.confirm(`Delete "${u.title}"?`)) return;
    await fetch(`/api/${fund}/updates/${u.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader title="Post an update" />
        <form onSubmit={handleSubmit} className="space-y-3 p-4 sm:p-6">
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={inputClass}
            placeholder="Update title"
          />
          <textarea
            required
            rows={6}
            value={form.body_md}
            onChange={(e) => setForm({ ...form, body_md: e.target.value })}
            className={inputClass}
            placeholder={"Markdown supported: **bold**, *italics*, - lists, ## headings"}
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
              />
              Pin to the top
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.email_members}
                onChange={(e) =>
                  setForm({ ...form, email_members: e.target.checked })
                }
              />
              Email members (respects their mute setting)
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Posting…" : "Post update"}
            </Button>
          </div>
          {error && <p className="text-sm text-loss">{error}</p>}
          {notice && <p className="text-sm text-gain">{notice}</p>}
        </form>
      </Card>

      {/* "Manage updates" on the Updates page lands here, on the pin and
          delete controls. */}
      <div id="posted" className="scroll-mt-20 lg:scroll-mt-6">
        <Card>
          <CardHeader title="Posted updates" />
          <div className="p-4 sm:p-6">
            {updates.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing posted yet. The first update shows up on every
                member&apos;s dashboard.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {updates.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-highlight px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{u.title}</p>
                      <p className="text-xs text-muted">
                        {formatDate(u.published_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {u.pinned && <Badge tone="accent">Pinned</Badge>}
                      <button
                        type="button"
                        onClick={() => togglePin(u)}
                        className="cursor-pointer text-xs text-accent-text hover:underline"
                      >
                        {u.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(u)}
                        className="cursor-pointer text-xs text-muted hover:text-loss hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
