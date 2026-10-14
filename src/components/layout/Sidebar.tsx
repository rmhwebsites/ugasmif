"use client";

// The fund's whole frame: who you are, which fund you are in, and every place
// you can go, grouped by what the work is for. The header always states which
// hat the user wears: "Arch Bond Fund · Portfolio Manager" (spec Section 10).
//
// Groups follow how the club runs: the portfolio itself, the research that
// feeds it (sector teams and their pitches, votes included), and the club
// around it (meetings, updates, people). Managing the fund sits apart, at the
// bottom, for the people who do it. The items themselves come from fundNav.ts,
// which the phone top bar also reads, so the two always agree on names.
//
// On a phone the same frame opens as a drawer. It behaves as a dialog: focus
// moves in when it opens, Tab stays inside, Escape closes it, and focus goes
// back to the Menu button.

import { useEffect, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  CalendarDays,
  Crosshair,
  FileText,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PieChart,
  ShieldCheck,
  Target,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { Avatar } from "@/components/ui/Avatar";
import { FundSwitcher } from "@/components/layout/FundSwitcher";
import { ThemeSelector } from "@/components/layout/ThemeSelector";
import { useMobileNav } from "@/components/layout/MobileNav";
import {
  activeNavItem,
  fundNav,
  type FundNavOptions,
  type NavKey,
} from "@/components/layout/fundNav";
import type { FundSlug } from "@/types/domain";

const ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  holdings: Briefcase,
  performance: BarChart3,
  trades: ArrowLeftRight,
  mySector: Crosshair,
  pitches: FileText,
  sectors: PieChart,
  meetings: CalendarDays,
  updates: Megaphone,
  team: Users,
  fundAdmin: Wrench,
  sectorTargets: Target,
  appAdmin: ShieldCheck,
};

// Everything a Tab press can land on inside the drawer. Roving-tabindex
// groups (the theme picker) keep one stop, so tabindex=-1 is left out.
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"])';

export function Sidebar({
  nav: navOptions,
  fundName,
  headerLine,
  accessible,
  adminSections,
  userName,
  avatarUrl,
}: {
  nav: FundNavOptions;
  fundName: string;
  /** e.g. "Portfolio Manager" or "Analyst · Healthcare" */
  headerLine: string;
  accessible: FundSlug[];
  /** The Fund admin sections this user can open, per fund. */
  adminSections: Partial<Record<FundSlug, string[]>>;
  userName: string;
  avatarUrl: string | null;
}) {
  const fund = navOptions.fund;
  const pathname = usePathname();
  const { open, setOpen, toggleRef } = useMobileNav();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const groups = fundNav(navOptions);
  const activeHref = activeNavItem(groups, pathname)?.href ?? null;
  const profileHref = `/${fund}/profile`;
  const onProfile = pathname === profileHref;

  // Focus into the drawer when it opens, back to Menu when it closes.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      closeRef.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      toggleRef.current?.focus();
    }
  }, [open, toggleRef]);

  // Escape closes it wherever focus happens to be.
  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Tab and Shift+Tab wrap around inside the drawer instead of walking into
  // the page hidden behind it.
  function trapFocus(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab" || !drawerRef.current) return;
    const stops = [
      ...drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ];
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function renderNav(inDrawer: boolean) {
    return (
      <div className="flex h-full flex-col">
        {/* In the drawer the close button sits top-right, so the header
            leaves room for it. */}
        <div className={`px-4 pt-5 pb-3 ${inDrawer ? "pr-14" : ""}`}>
          <Link
            href={`/${fund}`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-3"
          >
            <SmifLogo className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{fundName}</p>
              <p className="truncate text-xs text-accent-text">{headerLine}</p>
            </div>
          </Link>
          {accessible.length > 1 && (
            <FundSwitcher
              current={fund}
              accessible={accessible}
              adminSections={adminSections}
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
                {group.items.map(
                  ({ key, href, label, detail, badge, badgeLabel }) => {
                    const active = href === activeHref;
                    const Icon = ICONS[key];
                    return (
                      <li key={key}>
                        <Link
                          href={href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          title={detail ? `${label}: ${detail}` : undefined}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors lg:py-1.5 ${
                            active
                              ? "bg-accent-soft font-medium text-accent-text"
                              : "text-foreground/80 hover:bg-highlight hover:text-foreground"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">
                            {label}
                            {detail && (
                              <span className="font-normal text-muted">
                                {" "}
                                · {detail}
                              </span>
                            )}
                          </span>
                          {badge ? (
                            <span
                              title={badgeLabel}
                              className="rounded-full bg-accent px-1.5 text-xs font-semibold leading-5 text-on-accent tabular-nums"
                            >
                              {badge}
                              <span className="sr-only"> · {badgeLabel}</span>
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  }
                )}
              </ul>
            </div>
          ))}
        </nav>

        <div className="bg-highlight px-2 py-3">
          <div className="flex items-center gap-2">
            <Link
              href={profileHref}
              onClick={() => setOpen(false)}
              aria-current={onProfile ? "page" : undefined}
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                onProfile ? "bg-accent-soft" : "hover:bg-highlight"
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
            {/* Desktop: an icon with a tooltip, set apart from the profile
                link. The drawer spells it out below instead, since a touch
                screen has no hover to show the tooltip. */}
            {!inDrawer && (
              <LogoutButton
                variant="ghost"
                label="Sign out"
                className="h-9 w-9 shrink-0 px-0! py-0!"
              >
                <LogOut className="h-4 w-4 shrink-0" />
              </LogoutButton>
            )}
          </div>
          <div className="mt-2 px-1">
            <ThemeSelector />
          </div>
          {inDrawer && (
            <LogoutButton
              variant="ghost"
              className="mt-2 min-h-10 w-full justify-start! px-3!"
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
              Sign out
            </LogoutButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onKeyDown={trapFocus}
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-sidebar shadow-xl"
          >
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 cursor-pointer rounded-lg p-2.5 text-muted transition-colors hover:bg-highlight hover:text-foreground"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {renderNav(true)}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-card-border bg-sidebar lg:block">
        {renderNav(false)}
      </aside>
    </>
  );
}
