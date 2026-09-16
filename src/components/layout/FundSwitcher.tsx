"use client";

// Two-segment Athena | Arch control (spec Section 10). Only segments the
// user can access are enabled; switching preserves the sub-route.

import { usePathname, useRouter } from "next/navigation";
import type { FundSlug } from "@/types/domain";

const FUND_LABELS: Record<FundSlug, string> = {
  athena: "Athena",
  arch: "Arch",
};

// Sub-routes that exist in both funds. Switching keeps the longest prefix of
// the current path that is made only of these, so /athena/holdings stays on
// holdings — but /athena/pitches/<id> lands on /arch/pitches rather than
// carrying an Athena pitch id into Arch, where it names nothing. Anything
// unrecognized falls back to the destination fund's dashboard.
const SHARED_ROUTES = new Set([
  "holdings",
  "sectors",
  "pitches",
  "pitches/new",
  "votes",
  "trades",
  "performance",
  "updates",
  "team",
  "attendance",
  "profile",
  "admin",
  "admin/attendance",
  "admin/audit",
  "admin/holdings",
  "admin/members",
  "admin/pitches",
  "admin/sectors",
  "admin/settings",
  "admin/tickets",
  "admin/updates",
  "admin/year",
]);

/** The deepest shared route this path sits under, or "" for the dashboard. */
export function sharedSubRoute(pathname: string): string {
  const sub = pathname.split("/").filter(Boolean).slice(1);
  for (let depth = sub.length; depth > 0; depth--) {
    const candidate = sub.slice(0, depth).join("/");
    if (SHARED_ROUTES.has(candidate)) return candidate;
  }
  return "";
}

export function FundSwitcher({
  current,
  accessible,
}: {
  current: FundSlug;
  accessible: FundSlug[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(slug: FundSlug) {
    if (slug === current || !accessible.includes(slug)) return;
    const sub = sharedSubRoute(pathname);
    const target = sub === "" ? `/${slug}` : `/${slug}/${sub}`;
    // The destination fund's layout records smif_fund via <FundCookie />.
    router.push(target);
  }

  return (
    <div className="flex rounded-lg border border-input-border bg-input-bg p-0.5">
      {(Object.keys(FUND_LABELS) as FundSlug[]).map((slug) => {
        const enabled = accessible.includes(slug);
        const active = slug === current;
        return (
          <button
            key={slug}
            type="button"
            disabled={!enabled}
            onClick={() => switchTo(slug)}
            title={
              enabled
                ? `${FUND_LABELS[slug]} ${slug === "athena" ? "Stock" : "Bond"} Fund`
                : `You are not on the ${FUND_LABELS[slug]} roster.`
            }
            className={`cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              active
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            {FUND_LABELS[slug]}
          </button>
        );
      })}
    </div>
  );
}
