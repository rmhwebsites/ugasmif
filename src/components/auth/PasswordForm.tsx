"use client";

// Shared "choose a new password" form for invite landing, recovery landing,
// and the forced change screen. Handles the hash-fragment token flow too
// (Supabase default templates put tokens in the URL hash; the browser client
// picks them up automatically on load).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export function PasswordForm({
  title,
  subtitle,
  submitLabel,
  clearMustChange = false,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  clearMustChange?: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(data.session !== null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(session !== null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });
    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }
    if (clearMustChange) {
      // Server route clears the flag with the service role (RLS blocks the
      // user from editing it directly).
      await fetch("/api/auth/clear-must-change", { method: "POST" });
    }
    router.push("/");
    router.refresh();
  }

  if (hasSession === false) {
    return (
      <div className="text-center">
        <p className="text-sm text-loss">
          This link has expired or was already used.
        </p>
        <p className="mt-2 text-sm text-muted">
          Ask an officer to send a new one, or use “Forgot password” on the
          sign-in page.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1 className="mb-1 text-xl font-semibold">{title}</h1>
      <p className="mb-6 text-sm text-muted">{subtitle}</p>

      <label className="mb-1 block text-xs font-medium text-muted">
        New password
      </label>
      <input
        type="password"
        required
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mb-4 w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />

      <label className="mb-1 block text-xs font-medium text-muted">
        Confirm password
      </label>
      <input
        type="password"
        required
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="mb-4 w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />

      {error && <p className="mb-3 text-sm text-loss">{error}</p>}

      <Button type="submit" disabled={loading || hasSession !== true} className="w-full">
        {loading ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
