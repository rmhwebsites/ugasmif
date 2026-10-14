// Shown in place of a fund's pages to someone who is signed in and on
// another fund's roster, but not this one's: an old link, a bookmark, or a
// typed address. A bare 404 told them nothing and offered no way back; this
// says why and links to the fund(s) they are on.

import Link from "next/link";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { LogoutButton } from "@/components/auth/LogoutButton";
import type { Fund } from "@/types/domain";

export function NotOnRoster({
  fundName,
  funds,
}: {
  /** The fund they tried to open, e.g. "Arch". */
  fundName: string;
  /** The funds they can open, in display order. */
  funds: Pick<Fund, "slug" | "name">[];
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8 text-center">
        <SmifLogo className="mx-auto mb-6 h-16 w-16" />
        <h1 className="mb-2 text-xl font-semibold">
          You&apos;re not a member of {fundName}
        </h1>
        <p className="mb-6 text-sm text-muted">
          {fundName} pages are open to {fundName} members. If you&apos;ve
          just joined, ask one of its officers to add you.
        </p>
        <div className="flex flex-col items-center gap-2">
          {funds.map((f) => (
            <Link
              key={f.slug}
              href={`/${f.slug}`}
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              Go to {f.name}
            </Link>
          ))}
          <LogoutButton variant="ghost" />
        </div>
      </div>
    </main>
  );
}
