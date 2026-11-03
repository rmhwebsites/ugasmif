"use client";

// The search box on the Team page. Empty, it shows the page as it is:
// officers, then each sector's row of cards. Typing swaps that for one grid
// of everyone on this year's roster who matches, by name, role or sector.

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { MemberCard, type TeamMember } from "@/components/team/MemberCarousel";
import { matchesQuery } from "@/lib/search";

export interface SearchableMember extends TeamMember {
  /** The sector's name, or null for officers without one. */
  sector: string | null;
}

export function TeamSearch({
  members,
  yearLabel,
  children,
}: {
  members: SearchableMember[];
  yearLabel: string;
  /** The usual grouped view, shown while the box is empty. */
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const matches = searching
    ? members.filter((m) => matchesQuery(`${m.name} ${m.role} ${m.sector ?? ""}`, query))
    : [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
          <span className="sr-only">Search the {yearLabel} team</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, role or sector"
            className="w-full rounded-lg border border-input-border bg-input-bg py-2 pr-3 pl-9 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>
        {searching && (
          <p className="text-xs text-muted tabular-nums" aria-live="polite">
            {matches.length} of {members.length}
          </p>
        )}
      </div>

      {!searching ? (
        children
      ) : matches.length === 0 ? (
        <p className="glass-card p-6 text-center text-sm text-muted">
          No one on the {yearLabel} team matches.
        </p>
      ) : (
        <section className="glass-card p-4 sm:p-6" aria-label="Search results">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {matches.map((m) => (
              <li key={m.id}>
                <MemberCard
                  member={{ ...m, role: m.sector ? `${m.role} · ${m.sector}` : m.role }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
