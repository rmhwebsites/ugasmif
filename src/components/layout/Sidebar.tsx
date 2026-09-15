"use client";

// Collapsible sidebar (spec 11.4). The fund header always states which hat
// the user wears: "Arch Bond Fund — Portfolio Manager" (spec Section 10).

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Briefcase,
  CalendarCheck,
  FileText,
  LayoutDashboard,
  LineChart,
  Megaphone,
  Menu,
  PieChart,
  Settings,
  ShieldCheck,
  Users,
  Vote,
  Wrench,
  X,
} from "lucide-react";
import { SmifLogo } from "@/components/icons/SmifLogo";
import type { FundSlug } from "@/types/domain";

interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

const ICONS = {
  dashboard: LayoutDashboard,
  holdings: Briefcase,
  sectors: PieChart,
  pitches: FileText,
  votes: Vote,
  trades: LineChart,
  performance: BarChart3,
  updates: Megaphone,
  team: Users,
  attendance: CalendarCheck,
  admin: Wrench,
  settings: Settings,
  shield: ShieldCheck,
};

export function Sidebar({
  fund,
  fundName,
  headerLine,
  showAdmin,
  showAppAdmin,
}: {
  fund: FundSlug;
  fundName: string;
  /** e.g. "Portfolio Manager" or "Analyst · Healthcare" */
  headerLine: string;
  showAdmin: boolean;
  showAppAdmin: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items: NavItem[] = [
    { href: `/${fund}`, label: "Dashboard", icon: "dashboard" },
    { href: `/${fund}/holdings`, label: "Holdings", icon: "holdings" },
    { href: `/${fund}/sectors`, label: "Sectors", icon: "sectors" },
    { href: `/${fund}/pitches`, label: "Pitches", icon: "pitches" },
    { href: `/${fund}/votes`, label: "Votes", icon: "votes" },
    { href: `/${fund}/trades`, label: "Trades", icon: "trades" },
    { href: `/${fund}/performance`, label: "Performance", icon: "performance" },
    { href: `/${fund}/updates`, label: "Updates", icon: "updates" },
    { href: `/${fund}/team`, label: "Team", icon: "team" },
    { href: `/${fund}/attendance`, label: "Attendance", icon: "attendance" },
  ];

  const adminItems: NavItem[] = showAdmin
    ? [{ href: `/${fund}/admin`, label: "Fund Admin", icon: "admin" }]
    : [];
  if (showAppAdmin) {
    adminItems.push({ href: "/admin", label: "App Admin", icon: "shield" });
  }

  function isActive(href: string): boolean {
    if (href === `/${fund}`) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="border-b border-card-border px-4 py-5">
        <Link href={`/${fund}`} className="flex items-center gap-3">
          <SmifLogo className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{fundName}</p>
            <p className="truncate text-xs text-accent">{headerLine}</p>
          </div>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive(item.href)
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-highlight hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}

        {adminItems.length > 0 && (
          <>
            <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Administration
            </p>
            {adminItems.map((item) => {
              const Icon = ICONS[item.icon];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive(item.href)
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-muted hover:bg-highlight hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </>
        )}
      </div>

      <div className="border-t border-card-border px-2 py-3">
        <Link
          href={`/${fund}/profile`}
          onClick={() => setOpen(false)}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
            isActive(`/${fund}/profile`)
              ? "bg-accent-soft font-medium text-accent"
              : "text-muted hover:bg-highlight hover:text-foreground"
          }`}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Profile
        </Link>
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-3 left-3 z-40 cursor-pointer rounded-lg border border-card-border bg-card-solid p-2 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

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
