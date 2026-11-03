"use client";

// A roster manager fills in someone's LinkedIn link for the alumni page,
// usually an alum who won't sign in again to do it themselves. Saves through
// PUT /api/[fund]/members/[id]/linkedin, which cleans up whatever is pasted
// (linkedin.com/in/name, a link with tracking on the end) before it's stored.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function LinkedInEditor({
  fund,
  membershipId,
  initial,
}: {
  fund: string;
  /** Any of their memberships in this fund. */
  membershipId: string;
  initial: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/${fund}/members/${membershipId}/linkedin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: value }),
      });
      const json: { error?: string; linkedin_url?: string | null } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: json.error ?? "The link could not be saved." });
      } else {
        const stored = json.linkedin_url ?? "";
        setValue(stored);
        setSaved(stored);
        setMessage({ ok: true, text: stored ? "Saved." : "Link removed." });
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "Network error. The link was not saved." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <label htmlFor="member-linkedin" className="block text-xs font-medium text-muted">
        LinkedIn
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="member-linkedin"
          type="text"
          inputMode="url"
          maxLength={500}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMessage(null);
          }}
          placeholder="linkedin.com/in/their-name"
          className="min-w-0 flex-1 rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
        />
        <Button type="submit" disabled={busy || value.trim() === saved}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className={`text-xs ${message ? (message.ok ? "text-gain" : "text-loss") : "text-muted"}`}>
        {message?.text ??
          "Shown on the alumni page. Members can also add their own on their profile."}
      </p>
    </form>
  );
}
