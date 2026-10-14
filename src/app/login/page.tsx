"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { Button } from "@/components/ui/Button";
import { safeNextPath } from "@/app/auth/next-path";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // /auth/confirm sends a used or lapsed email link here. The person may
  // never have had a password (an invite), so start on "send a new link".
  const linkExpired = searchParams.get("error") === "link-expired";
  const [forgotMode, setForgotMode] = useState(linkExpired);
  const [showExpired, setShowExpired] = useState(linkExpired);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "Wrong email or password."
          : signInError.message
      );
      return;
    }
    router.push(safeNextPath(searchParams.get("next")));
    router.refresh();
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/auth/reset` }
    );
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setNotice(
      showExpired
        ? "If that address is on the roster, a new link is on its way. Check your inbox."
        : "If that address is on the roster, a reset link is on its way. Check your inbox."
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <SmifLogo className="mx-auto mb-4 h-20 w-20" />
          <h1 className="text-2xl font-semibold">SMIF Hub</h1>
          <p className="mt-1 text-sm text-muted">
            UGA Student Managed Investment Fund
          </p>
        </div>

        {showExpired && (
          <div className="mb-5 rounded-lg bg-highlight px-3 py-2.5 text-sm">
            <p className="font-medium">
              That link has expired or was already used.
            </p>
            <p className="mt-1 text-muted">
              Links in SMIF Hub emails work once. Enter your UGA email and
              we&apos;ll send a new one, whether you were setting up your
              account or resetting your password.
            </p>
          </div>
        )}
        {forgotMode && !showExpired && (
          <p className="mb-4 text-sm text-muted">
            Enter your UGA email and we&apos;ll send a link to choose a new
            password.
          </p>
        )}

        <form onSubmit={forgotMode ? handleForgot : handleSignIn}>
          <label className="mb-1 block text-xs font-medium text-muted">
            UGA email
          </label>
          <input
            type="email"
            required
            autoFocus={linkExpired}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="you@uga.edu"
          />

          {!forgotMode && (
            <>
              <label className="mb-1 block text-xs font-medium text-muted">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mb-4 w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="••••••••"
              />
            </>
          )}

          {error && <p className="mb-3 text-sm text-loss">{error}</p>}
          {notice && <p className="mb-3 text-sm text-gain">{notice}</p>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading
              ? "One moment…"
              : forgotMode
              ? showExpired
                ? "Send a new link"
                : "Send reset link"
              : "Sign in"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setForgotMode(!forgotMode);
            setShowExpired(false);
            setError(null);
            setNotice(null);
          }}
          className="mt-4 block w-full cursor-pointer text-center text-sm text-muted hover:text-foreground"
        >
          {forgotMode ? "Back to sign in" : "Forgot password?"}
        </button>

        {forgotMode && (
          <p className="mt-4 text-center text-xs text-muted">
            No email after a few minutes? Ask a SMIF officer. They can resend
            your invite or set a temporary password for you.
          </p>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
