"use client";

// The two officer password tools (SPEC Section 7). "Send reset link" emails
// the member directly; "Set temporary password" shows the password once.
// For someone who never finished signing up the first button reads "Resend
// invite": the same link lets them set a password, so it is the way to
// replace an invite that lapsed.

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function PasswordTools({
  userId,
  invite = false,
}: {
  userId: string;
  /** The member has not signed up yet: offer the link as a fresh invite. */
  invite?: boolean;
}) {
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reset" | "temp" | null>(null);

  async function sendReset() {
    setBusy("reset");
    setError(null);
    setNotice(null);
    setTempPassword(null);
    const res = await fetch("/api/auth/admin-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setBusy(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(
        data?.error ??
          (invite ? "Could not resend the invite." : "Could not send the reset link.")
      );
      return;
    }
    setNotice(
      invite
        ? "Invite resent. The member was emailed a link to set their password."
        : "Reset link emailed to the member."
    );
  }

  async function setTemp() {
    if (
      !window.confirm(
        "Set a temporary password? The member's current password stops working immediately."
      )
    ) {
      return;
    }
    setBusy("temp");
    setError(null);
    setNotice(null);
    const res = await fetch("/api/auth/set-temp-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setBusy(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Could not set a temporary password.");
      return;
    }
    setTempPassword(data.password);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={invite ? "primary" : "secondary"}
          onClick={sendReset}
          disabled={busy !== null}
        >
          {busy === "reset"
            ? "Sending…"
            : invite
            ? "Resend invite"
            : "Send reset link"}
        </Button>
        <Button variant="secondary" onClick={setTemp} disabled={busy !== null}>
          {busy === "temp" ? "Setting…" : "Set temporary password"}
        </Button>
      </div>

      {notice && <p className="text-sm text-gain">{notice}</p>}
      {error && <p className="text-sm text-loss">{error}</p>}

      {tempPassword && (
        <div className="rounded-lg border border-accent bg-accent-soft p-4">
          <p className="text-sm font-medium">
            Temporary password — shown once, copy it now
          </p>
          <p className="mt-2 font-mono text-lg tracking-wide">{tempPassword}</p>
          <p className="mt-2 text-xs text-muted">
            Give it to the member in person or over a channel you trust. They
            must choose a new password the next time they sign in. The member
            has been emailed that an officer reset their password (the email
            does not contain it).
          </p>
        </div>
      )}
    </div>
  );
}
