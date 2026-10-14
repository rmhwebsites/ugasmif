"use client";

// Fund admin's tabs, in the same groups as the main sidebar so the two read
// as one map: the checklist first, then portfolio, research, club, and the
// set-up pages you open once a term. Groups are told apart by space alone.

import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS: { seg: string; label: string }[][] = [
  [{ seg: "", label: "Checklist" }],
  [
    { seg: "tickets", label: "Tickets" },
    { seg: "holdings", label: "Holdings" },
  ],
  [
    { seg: "pitches", label: "Pitches" },
    { seg: "sectors", label: "Sectors" },
  ],
  [
    { seg: "attendance", label: "Meetings" },
    { seg: "updates", label: "Updates" },
    { seg: "members", label: "Members" },
  ],
  [
    { seg: "year", label: "Year" },
    { seg: "settings", label: "Settings" },
    { seg: "audit", label: "Audit" },
  ],
];

export function AdminNav({ fund }: { fund: string }) {
  const pathname = usePathname();
  const base = `/${fund}/admin`;

  return (
    <nav
      aria-label="Fund admin"
      className="-mx-1 flex gap-x-5 overflow-x-auto px-1 pb-1"
    >
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex shrink-0 gap-1">
          {group.map(({ seg, label }) => {
            const href = seg ? `${base}/${seg}` : base;
            const active = seg
              ? pathname === href || pathname.startsWith(`${href}/`)
              : pathname === base;
            return (
              <Link
                key={label}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-muted hover:bg-highlight hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
