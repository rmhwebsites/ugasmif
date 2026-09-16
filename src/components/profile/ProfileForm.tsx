"use client";

// Profile self-service (SPEC 11.2): display name + avatar URL + email mute
// preferences save through PATCH /api/profile; the password change runs
// entirely in the browser against the current Supabase session
// (auth.updateUser), same flow as the auth landing pages.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";

export interface ProfileFormInitial {
  full_name: string;
  avatar_url: string | null;
  email_prefs: { mute_updates?: boolean; mute_reminders?: boolean };
}

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function ProfileForm({ initial }: { initial: ProfileFormInitial }) {
  const router = useRouter();

  // ── Details form ──────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState(initial.full_name);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatar_url ?? "");
  const [muteUpdates, setMuteUpdates] = useState(
    initial.email_prefs.mute_updates === true
  );
  const [muteReminders, setMuteReminders] = useState(
    initial.email_prefs.mute_reminders === true
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    if (fullName.trim().length === 0) {
      setSaveError("Your name can't be empty.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          avatar_url: avatarUrl.trim(),
          email_prefs: {
            mute_updates: muteUpdates,
            mute_reminders: muteReminders,
          },
        }),
      });
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error ?? "Your profile could not be saved.");
      } else {
        setSaved(true);
        router.refresh();
      }
    } catch {
      setSaveError("Network error — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Password form ─────────────────────────────────────────────────────────
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSaved(false);
    if (password.length < 8) {
      setPwError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setPwError("Passwords don't match.");
      return;
    }
    setPwSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setPwSaving(false);
    if (error) {
      setPwError(error.message);
      return;
    }
    setPassword("");
    setConfirm("");
    setPwSaved(true);
  }

  const avatarPreview = avatarUrl.trim();

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader title="Your details" />
        <form onSubmit={handleSave} className="space-y-4 p-4 sm:p-6">
          <div className="flex items-center gap-4">
            {avatarPreview ? (
              // Plain URL preview — no upload pipeline, by design.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarPreview}
                alt=""
                className="h-14 w-14 rounded-full border border-card-border object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-base font-semibold text-accent"
              >
                {initials(fullName)}
              </div>
            )}
            <p className="text-xs text-muted">
              Paste a link to a photo (a UGA directory photo or LinkedIn image
              URL works). Leave it blank to use your initials.
            </p>
          </div>

          <div>
            <label
              htmlFor="profile-name"
              className="mb-1 block text-xs font-medium text-muted"
            >
              Full name
            </label>
            <input
              id="profile-name"
              type="text"
              required
              maxLength={120}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="profile-avatar"
              className="mb-1 block text-xs font-medium text-muted"
            >
              Avatar URL
            </label>
            <input
              id="profile-avatar"
              type="url"
              placeholder="https://…"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              className={inputClass}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-muted">
              Email preferences
            </legend>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={muteUpdates}
                onChange={(e) => setMuteUpdates(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span>
                Mute update emails
                <span className="block text-xs text-muted">
                  Skip the email when officers post a fund update — you can
                  still read everything on the Updates page.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={muteReminders}
                onChange={(e) => setMuteReminders(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span>
                Mute vote reminder emails
                <span className="block text-xs text-muted">
                  Skip the nudge when a vote is closing and you haven&apos;t
                  cast a ballot yet.
                </span>
              </span>
            </label>
          </fieldset>

          {saveError && <p className="text-sm text-loss">{saveError}</p>}
          {saved && <p className="text-sm text-gain">Profile saved.</p>}

          <Button type="submit" disabled={saving}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Change password" />
        <form onSubmit={handlePassword} className="space-y-4 p-4 sm:p-6">
          <div>
            <label
              htmlFor="profile-new-password"
              className="mb-1 block text-xs font-medium text-muted"
            >
              New password
            </label>
            <input
              id="profile-new-password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="profile-confirm-password"
              className="mb-1 block text-xs font-medium text-muted"
            >
              Confirm new password
            </label>
            <input
              id="profile-confirm-password"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>

          {pwError && <p className="text-sm text-loss">{pwError}</p>}
          {pwSaved && (
            <p className="text-sm text-gain">
              Password updated — use it the next time you sign in.
            </p>
          )}

          <Button type="submit" variant="secondary" disabled={pwSaving}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {pwSaving ? "Updating…" : "Update password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
