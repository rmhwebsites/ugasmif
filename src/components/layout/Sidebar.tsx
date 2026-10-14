"use client";

// The fund's whole frame: who you are, which fund you are in, and every place
// you can go, grouped by what the work is for. The header always states which
// hat the user wears: "Arch Bond Fund · Portfolio Manager" (spec Section 10).
//
// Groups follow how the club runs: the portfolio itself, the research that
// feeds it (sector teams and their pitches, votes included), and the club
// around it (meetings, updates, people). Managing the fund sits apart, at the
// bottom, for the people who do it.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  CalendarDays,
  FileText,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PieChart,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { Avatar } from "@/components/ui/Avatar";
import { FundSwitcher } from "@/components/layout/FundSwitcher";
import { ThemeSelector } from "@/components/layout/ThemeSelector";
import { useMobileNav } from "@/components/layout/MobileNav";
import type { FundSlug } from "@/types/domain";

interface NavItem {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  /** Small count on the right, e.g. votes still waiting on you. */
  badge?: number;
  badgeLabel?: string;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export function Sidebar({
  fund,
  fundName,
  headerLine,
  accessible,
  userName,
  avatarUrl,
  votesWaiting,
  showAdmin,
  showAppAdmin,
}: {
  fund: FundSlug;
  fundName: string;
  /** e.g. "Portfolio Manager" or "Analyst · Healthcare" */
  headerLine: string;
  accessible: FundSlug[];
  userName: string;
  avatarUrl: string | null;
  /** Open votes this user can cast and has not yet. */
  votesWaiting: number;
  showAdmin: boolean;
  showAppAdmin: boolean;
}) {
  const pathname = usePathname();
  const { open, setOpen } = useMobileNav();

  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ href: `/${fund}`, label: "Dashboard", Icon: LayoutDashboard }],
    },
    {
      label: "Portfolio",
      items: [
        { href: `/${fund}/holdings`, label: "Holdings", Icon: Briefcase },
        { href: `/${fund}/performance`, label: "Performance", Icon: BarChart3 },
        { href: `/${fund}/trades`, label: "Trades", Icon: ArrowLeftRight },
      ],
    },
    {
      label: "Research",
      items: [
        {
          href: `/${fund}/pitches`,
          label: "Pitches",
          Icon: FileText,
          badge: votesWaiting,
          badgeLabel:
            votesWaiting === 1
              ? "1 vote waiting on you"
              : `${votesWaiting} votes waiting on you`,
        },
        { href: `/${fund}/sectors`, label: "Sectors", Icon: PieChart },
      ],
    },
    {
      label: "Club",
      items: [
        { href: `/${fund}/attendance`, label: "Meetings", Icon: CalendarDays },
        { href: `/${fund}/updates`, label: "Updates", Icon: Megaphone },
        { href: `/${fund}/team`, label: "Team", Icon: Users },
      ],
    },
  ];

  const manage: NavItem[] = [];
  if (showAdmin) {
    manage.push({ href: `/${fund}/admin`, label: "Fund admin", Icon: Wrench });
  }
  if (showAppAdmin) {
    manage.push({ href: "/admin", label: "App admin", Icon: ShieldCheck });
  }
  if (manage.length > 0) groups.push({ label: "Manage", items: manage });

  function isActive(href: string): boolean {
    if (href === `/${fund}`) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const nav = (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-3">
        <Link
          href={`/${fund}`}
          onClick={() => setOpen(false)}
          className="flex items-center gap-3"
        >
          <SmifLogo className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{fundName}</p>
            <p className="truncate text-xs text-accent">{headerLine}</p>
          </div>
        </Link>
        {accessible.length > 1 && (
          <FundSwitcher
            current={fund}
            accessible={accessible}
            className="mt-3"
          />
        )}
      </div>

      <nav aria-label="Fund" className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((group, gi) => (
          <div key={group.label ?? gi} className={gi === 0 ? "" : "mt-4"}>
            {group.label && (
              <p className="px-3 pb-1 text-xs font-medium text-muted">
                {group.label}
              </p>
            )}
            <ul>
              {group.items.map(({ href, label, Icon, badge, badgeLabel }) => {
                const active = isActive(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors lg:py-1.5 ${
                        active
                          ? "bg-accent-soft font-medium text-accent"
                          : "text-foreground/80 hover:bg-highlight hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      {badge ? (
                        <span
                          title={badgeLabel}
                          className="rounded-full bg-accent px-1.5 text-xs font-semibold leading-5 text-white tabular-nums"
                        >
                          {badge}
                          <span className="sr-only"> · {badgeLabel}</span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="bg-highlight px-2 py-3">
        <div className="flex items-center gap-1">
          <Link
            href={`/${fund}/profile`}
            onClick={() => setOpen(false)}
            aria-current={isActive(`/${fund}/profile`) ? "page" : undefined}
            className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
              isActive(`/${fund}/profile`)
                ? "bg-accent-soft"
                : "hover:bg-highlight"
            }`}
          >
            <Avatar src={avatarUrl} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {userName}
              </span>
              <span className="block text-xs text-muted">Your profile</span>
            </span>
          </Link>
          <LogoutButton
            variant="ghost"
            label="Sign out"
            className="h-9 w-9 shrink-0 px-0! py-0!"
          >
            <LogOut className="h-4 w-4 shrink-0" />
          </LogoutButton>
        </div>
        <div className="mt-2 px-1">
          <ThemeSelector />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 cursor-pointer text-muted"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            {nav}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-card-border bg-sidebar lg:block">
        {nav}
      </aside>
    </>
  );
}
