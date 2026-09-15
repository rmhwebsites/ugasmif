"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { Button } from "@/components/ui/Button";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

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
    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") ? next : "/");
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
      "If that address is on the roster, a reset link is on its way. Check your inbox."
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

        <form onSubmit={forgotMode ? handleForgot : handleSignIn}>
          <label className="mb-1 block text-xs font-medium text-muted">
            UGA email
          </label>
          <input
            type="email"
            required
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
              ? "Send reset link"
              : "Sign in"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setForgotMode(!forgotMode);
            setError(null);
            setNotice(null);
          }}
          className="mt-4 block w-full cursor-pointer text-center text-sm text-muted hover:text-foreground"
        >
          {forgotMode ? "Back to sign in" : "Forgot password?"}
        </button>
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
