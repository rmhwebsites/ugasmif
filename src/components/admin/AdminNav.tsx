"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { seg: "", label: "Checklist" },
  { seg: "tickets", label: "Tickets" },
  { seg: "holdings", label: "Holdings" },
  { seg: "pitches", label: "Pitches" },
  { seg: "sectors", label: "Sectors" },
  { seg: "members", label: "Members" },
  { seg: "year", label: "Year" },
  { seg: "settings", label: "Settings" },
  { seg: "updates", label: "Updates" },
  { seg: "attendance", label: "Attendance" },
  { seg: "audit", label: "Audit" },
];

export function AdminNav({ fund }: { fund: string }) {
  const pathname = usePathname();
  const base = `/${fund}/admin`;

  return (
    <nav className="flex gap-1 overflow-x-auto pb-1">
      {TABS.map(({ seg, label }) => {
        const href = seg ? `${base}/${seg}` : base;
        const active = seg
          ? pathname === href || pathname.startsWith(`${href}/`)
          : pathname === base;
        return (
          <Link
            key={label}
            href={href}
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
    </nav>
  );
}
