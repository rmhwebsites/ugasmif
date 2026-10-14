// The app-wide 404: addresses outside any fund, fund addresses that name no
// fund, and App admin for anyone who isn't an app admin. It sits outside the
// fund shell, so it carries its own way forward: "/" sends a signed-in member
// to their fund, and Sign out is here for someone signed in to the wrong
// account.

import Link from "next/link";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { getAuthState } from "@/lib/fund";

// Next uses this title only when the route's generateMetadata also calls
// notFound() (App admin does); a 404 thrown only while rendering keeps the
// title the route's metadata already resolved.
export const metadata = { title: "Page not found" };

export default async function NotFound() {
  const { user } = await getAuthState();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8 text-center">
        <SmifLogo className="mx-auto mb-6 h-16 w-16" />
        <h1 className="mb-2 text-xl font-semibold">Page not found</h1>
        <p className="mb-6 text-sm text-muted">
          This page doesn&apos;t exist, or it isn&apos;t open to your
          account.
        </p>
        <div className="flex flex-col items-center gap-2">
          <Link
            href={user ? "/" : "/login"}
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            {user ? "Go to my fund" : "Sign in"}
          </Link>
          {user && <LogoutButton variant="ghost" />}
        </div>
      </div>
    </main>
  );
}
