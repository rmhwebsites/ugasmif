"use client";

// Fund admin's tabs, in the same groups and under the same captions as the
// main sidebar so the two read as one map: the checklist first, then
// Portfolio, Research, Club, and the Setup pages you open once a term. The
// layout passes only the sections this person can use, so every tab opens.
//
// Wide screens show every tab, wrapping rather than scrolling so the current
// one is never off to the side. Phones get one "Fund admin" row with a
// picker showing where you are; tapping it lists every section by group.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import type { AdminSection } from "@/lib/permissions";
import { ADMIN_GROUPS } from "@/components/admin/adminSections";

export function AdminNav({
  fund,
  sections,
}: {
  fund: string;
  /** The sections this person may open, from adminSectionsFor(ctx). */
  sections: AdminSection[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/${fund}/admin`;
  const hrefFor = (seg: AdminSection) => (seg ? `${base}/${seg}` : base);
  const isActive = (seg: AdminSection) => {
    if (!seg) return pathname === base;
    const href = hrefFor(seg);
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const allowed = new Set(sections);
  const groups = ADMIN_GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((t) => allowed.has(t.seg)),
  })).filter((g) => g.tabs.length > 0);

  // Where you are, even if it is a page you reached by link and has no tab.
  const current = ADMIN_GROUPS.flatMap((g) => g.tabs).find((t) =>
    isActive(t.seg)
  );
  const currentHasTab = current ? allowed.has(current.seg) : false;

  return (
    <nav
      aria-label="Fund admin"
      className="border-b border-card-border pb-3"
    >
      <div className="flex items-center justify-between gap-3 sm:mb-2">
        <p className="flex shrink-0 items-center gap-1.5 text-sm font-semibold">
          <Wrench className="h-4 w-4 text-muted" aria-hidden="true" />
          Fund admin
        </p>

        {/* Phones: one picker that always shows the current section. Keyed
            on the path so it resets after each navigation. */}
        <label className="min-w-0 flex-1 sm:hidden">
          <span className="sr-only">Fund admin section</span>
          <select
            key={pathname}
            defaultValue={current?.seg ?? ""}
            onChange={(e) => router.push(hrefFor(e.target.value as AdminSection))}
            className="w-full cursor-pointer rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm font-medium outline-none focus:border-accent"
          >
            {current && !currentHasTab && (
              <option value={current.seg} disabled>
                {current.label}
              </option>
            )}
            {groups.map((g) =>
              g.caption ? (
                <optgroup key={g.caption} label={g.caption}>
                  {g.tabs.map((t) => (
                    <option key={t.seg} value={t.seg}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ) : (
                g.tabs.map((t) => (
                  <option key={t.seg} value={t.seg}>
                    {t.label}
                  </option>
                ))
              )
            )}
          </select>
        </label>
      </div>

      {/* Wider screens: every tab, grouped under its caption. */}
      <div className="hidden flex-wrap items-end gap-x-6 gap-y-3 sm:flex">
        {groups.map((g, gi) => (
          <div key={g.caption ?? gi} className="min-w-0">
            {g.caption && (
              <p className="px-3 pb-1 text-xs font-medium text-muted">
                {g.caption}
              </p>
            )}
            <div className="flex flex-wrap gap-1">
              {g.tabs.map(({ seg, label }) => {
                const active = isActive(seg);
                return (
                  <Link
                    key={seg || "checklist"}
                    href={hrefFor(seg)}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                      active
                        ? "bg-accent-soft font-medium text-accent-text"
                        : "text-muted hover:bg-highlight hover:text-foreground"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
