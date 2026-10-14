"use client";

// Two-segment Athena | Arch control (spec Section 10). Only segments the
// user can access are enabled; switching keeps you on the same view: the
// same page, with the filters and period that mean the same thing in both
// funds.

import { usePathname, useRouter } from "next/navigation";
import {
  ADMIN_CONTENT_PAGE,
  FUND_SHORT_NAMES,
} from "@/components/layout/fundNav";
import type { FundSlug } from "@/types/domain";

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

// Query parameters that mean the same thing in either fund: the attribution
// period, list filters (including the stale-price filters on Holdings and
// Manage holdings), date ranges, the academic year. Ids, symbols and sector
// slugs belong to one fund, so they stay behind.
const SHARED_PARAMS = [
  "attr",
  "range",
  "status",
  "q",
  "price",
  "stale",
  "action",
  "from",
  "to",
  "year",
  "entity",
];

// Shared names that mean something fund-specific on one page. On Manage
// tickets, ?action=sell pre-fills a sale of one holding (?holding=<id>), so
// without that holding it would open an empty sell form; on the audit log,
// ?action=<code> is a filter and carries over.
const PAGE_ONLY_PARAMS: Record<string, string[]> = {
  "admin/tickets": ["action"],
};

/** The deepest shared route this path sits under, or "" for the dashboard. */
export function sharedSubRoute(pathname: string): string {
  const sub = pathname.split("/").filter(Boolean).slice(1);
  for (let depth = sub.length; depth > 0; depth--) {
    const candidate = sub.slice(0, depth).join("/");
    if (SHARED_ROUTES.has(candidate)) return candidate;
  }
  return "";
}

/**
 * The address to open in `dest` for someone on `pathname` + `search`.
 * A Fund admin page is kept only when it is one of `destAdminSections` (the
 * sections this person can open in `dest`, "" for the checklist); otherwise
 * you land on the page it manages (Manage holdings → Holdings), since the
 * admin page itself would be a dead end. Query parameters carry over only
 * when you stay on the very same page.
 */
export function switchTarget(
  pathname: string,
  search: string,
  dest: FundSlug,
  destAdminSections: readonly string[]
): string {
  let sub = sharedSubRoute(pathname);
  if (sub === "admin" || sub.startsWith("admin/")) {
    const section = sub === "admin" ? "" : sub.slice("admin/".length);
    if (!destAdminSections.includes(section)) {
      sub = ADMIN_CONTENT_PAGE[sub] ?? "";
    }
  }
  const target = sub === "" ? `/${dest}` : `/${dest}/${sub}`;

  const samePage =
    pathname.split("/").filter(Boolean).slice(1).join("/") === sub;
  if (!samePage) return target;
  const from = new URLSearchParams(search);
  const kept = new URLSearchParams();
  const pageOnly = PAGE_ONLY_PARAMS[sub] ?? [];
  for (const key of SHARED_PARAMS) {
    if (pageOnly.includes(key)) continue;
    for (const value of from.getAll(key)) kept.append(key, value);
  }
  const query = kept.toString();
  return query ? `${target}?${query}` : target;
}

export function FundSwitcher({
  current,
  accessible,
  adminSections = {},
  className = "",
}: {
  current: FundSlug;
  accessible: FundSlug[];
  /** The Fund admin sections this user can open, per fund. */
  adminSections?: Partial<Record<FundSlug, string[]>>;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(slug: FundSlug) {
    if (slug === current || !accessible.includes(slug)) return;
    // Read at click time, so the switcher needs no Suspense boundary.
    const target = switchTarget(
      pathname,
      window.location.search,
      slug,
      adminSections[slug] ?? []
    );
    // The destination fund's layout records smif_fund via <FundCookie />.
    router.push(target);
  }

  return (
    <div
      role="group"
      aria-label="Fund"
      className={`flex rounded-lg bg-highlight p-0.5 ${className}`}
    >
      {(Object.keys(FUND_SHORT_NAMES) as FundSlug[]).map((slug) => {
        const enabled = accessible.includes(slug);
        const active = slug === current;
        const name = FUND_SHORT_NAMES[slug];
        return (
          <button
            key={slug}
            type="button"
            disabled={!enabled}
            onClick={() => switchTo(slug)}
            title={
              enabled
                ? `${name} ${slug === "athena" ? "Stock" : "Bond"} Fund`
                : `You are not a member of ${name}.`
            }
            aria-pressed={active}
            className={`flex-1 cursor-pointer rounded-md px-3 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 lg:py-1 ${
              active
                ? "bg-accent text-on-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
