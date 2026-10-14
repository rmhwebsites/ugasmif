// Where "/" sends a signed-in account that can open no fund. It checks again
// on every visit, so once an officer adds the person, "Check again" (or any
// reload) carries them on to their fund instead of leaving them here.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccessibleFunds, getAuthState } from "@/lib/fund";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { LogoutButton } from "@/components/auth/LogoutButton";

export const metadata = { title: "No access" };

export default async function NoAccessPage() {
  const { user, profile } = await getAuthState();
  if (!user) redirect("/login");
  const funds = await getAccessibleFunds();
  if (funds.length > 0) redirect("/");

  const email = profile?.email ?? user.email ?? null;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8 text-center">
        <SmifLogo className="mx-auto mb-6 h-16 w-16" />
        <h1 className="mb-2 text-xl font-semibold">
          You&apos;re not in a fund yet
        </h1>
        <p className="text-sm text-muted">
          {email ? (
            <>
              You&apos;re signed in as{" "}
              <span className="font-medium text-foreground">{email}</span>,
              but this account isn&apos;t a member of either fund.
            </>
          ) : (
            <>This account isn&apos;t a member of either fund.</>
          )}
        </p>
        <p className="mt-2 mb-6 text-sm text-muted">
          Ask your fund&apos;s president, vice president or director of alumni
          relations to add you, then check again.
        </p>
        <div className="flex flex-col items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            Check again
          </Link>
          <LogoutButton variant="ghost">Not you? Sign out</LogoutButton>
        </div>
      </div>
    </main>
  );
}
