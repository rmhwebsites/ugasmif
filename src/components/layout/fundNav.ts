// Every place in a fund and its name, in one table. The sidebar builds its
// groups from it, the phone top bar names the current page from it, and the
// fund switcher and the fund's 404 page use its admin-to-page map, so a page
// is called the same thing wherever it shows up.
//
// Plain data with no hooks or server imports: the server layout reads the
// types and short names, and the client components read the rest.

import type { FundSlug } from "@/types/domain";

/** Short fund names for tight spots: the phone bar, tab titles, the switcher. */
export const FUND_SHORT_NAMES: Record<FundSlug, string> = {
  athena: "Athena",
  arch: "Arch",
};

export interface FundNavOptions {
  fund: FundSlug;
  /** The member's own sector team, for the "My sector" shortcut. */
  mySector: { slug: string; name: string } | null;
  /** Open votes this user can cast and has not yet. */
  votesWaiting: number;
  showAdmin: boolean;
  /**
   * The strategy-team leader's one page under Fund admin: Manage sectors,
   * opened at its targets form. Only for leaders who can't open the rest of
   * Fund admin.
   */
  showSectorTargets: boolean;
  showAppAdmin: boolean;
}

export type NavKey =
  | "dashboard"
  | "holdings"
  | "performance"
  | "trades"
  | "mySector"
  | "pitches"
  | "sectors"
  | "meetings"
  | "updates"
  | "team"
  | "fundAdmin"
  | "sectorTargets"
  | "appAdmin";

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  /** Muted text after the label, e.g. the sector's name on "My sector". */
  detail?: string;
  /** Small count on the right, e.g. votes still waiting on you. */
  badge?: number;
  badgeLabel?: string;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export function votesWaitingLabel(count: number): string {
  return count === 1 ? "1 vote waiting on you" : `${count} votes waiting on you`;
}

export function fundNav(o: FundNavOptions): NavGroup[] {
  const base = `/${o.fund}`;
  const research: NavItem[] = [];
  if (o.mySector) {
    research.push({
      key: "mySector",
      href: `${base}/sectors/${o.mySector.slug}`,
      label: "My sector",
      detail: o.mySector.name,
    });
  }
  research.push(
    {
      key: "pitches",
      href: `${base}/pitches`,
      label: "Pitches",
      badge: o.votesWaiting,
      badgeLabel: votesWaitingLabel(o.votesWaiting),
    },
    { key: "sectors", href: `${base}/sectors`, label: "Sectors" }
  );

  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ key: "dashboard", href: base, label: "Dashboard" }],
    },
    {
      label: "Portfolio",
      items: [
        { key: "holdings", href: `${base}/holdings`, label: "Holdings" },
        { key: "performance", href: `${base}/performance`, label: "Performance" },
        { key: "trades", href: `${base}/trades`, label: "Trades" },
      ],
    },
    { label: "Research", items: research },
    {
      label: "Club",
      items: [
        { key: "meetings", href: `${base}/attendance`, label: "Meetings" },
        { key: "updates", href: `${base}/updates`, label: "Updates" },
        { key: "team", href: `${base}/team`, label: "Team" },
      ],
    },
  ];

  const manage: NavItem[] = [];
  if (o.showAdmin) {
    manage.push({ key: "fundAdmin", href: `${base}/admin`, label: "Fund admin" });
  } else if (o.showSectorTargets) {
    manage.push({
      key: "sectorTargets",
      href: `${base}/admin/sectors#targets`,
      label: "Manage sectors",
    });
  }
  if (o.showAppAdmin) {
    manage.push({ key: "appAdmin", href: "/admin", label: "App admin" });
  }
  if (manage.length > 0) groups.push({ label: "Manage", items: manage });

  return groups;
}

/**
 * The item for the page you are on: the one whose address is the longest
 * prefix of the path, so a sector page lights up "My sector" rather than
 * "Sectors" as well. The dashboard matches only itself.
 */
export function activeNavItem(
  groups: NavGroup[],
  pathname: string
): NavItem | null {
  let best: NavItem | null = null;
  let bestLength = -1;
  for (const item of groups.flatMap((g) => g.items)) {
    const href = item.href.split("#")[0];
    const isDashboard = href.split("/").filter(Boolean).length === 1;
    const match = isDashboard
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
    if (match && href.length > bestLength) {
      best = item;
      bestLength = href.length;
    }
  }
  return best;
}

/**
 * The current page's name for the phone top bar: the sidebar's own label
 * (the sector's name on your sector's page), "Profile" for the profile, and
 * null on the dashboard or an address the sidebar doesn't know.
 */
export function currentPageName(o: FundNavOptions, pathname: string): string | null {
  if (pathname === `/${o.fund}/profile`) return "Profile";
  const item = activeNavItem(fundNav(o), pathname);
  if (!item || item.key === "dashboard") return null;
  return item.detail ?? item.label;
}

/**
 * Where each Fund admin page's content lives for members: Manage holdings
 * belongs with Holdings, Manage tickets with Trades. "" is the dashboard.
 * Used to land somewhere useful when an admin page isn't open to you.
 */
export const ADMIN_CONTENT_PAGE: Record<string, string> = {
  admin: "",
  "admin/tickets": "trades",
  "admin/holdings": "holdings",
  "admin/pitches": "pitches",
  "admin/sectors": "sectors",
  "admin/attendance": "attendance",
  "admin/updates": "updates",
  "admin/members": "team",
  "admin/year": "",
  "admin/settings": "",
  "admin/audit": "",
};

/** Sidebar names of the member pages, keyed by their first path segment. */
export const PAGE_NAMES: Record<string, string> = {
  "": "Dashboard",
  holdings: "Holdings",
  performance: "Performance",
  trades: "Trades",
  pitches: "Pitches",
  sectors: "Sectors",
  attendance: "Meetings",
  updates: "Updates",
  team: "Team",
  profile: "Profile",
};
